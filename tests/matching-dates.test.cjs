const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const m = new Module(filename, module);
  m.filename = filename; m.paths = module.paths;
  const original = m.require.bind(m);
  m.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : original(id);
  m._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions:{ module:ts.ModuleKind.CommonJS, esModuleInterop:true, target:ts.ScriptTarget.ES2020 }}).outputText, filename);
  return m.exports;
}
const adjustments = load('lib/amount-adjustment.ts');
const dates = load('lib/matching-dates.ts');
const empty = { recurring: [], dates: [] };
const match = (due, paid, calendar = empty, days = 5) => dates.matchDates(due, paid, calendar, days);

test('datas exatas, inválidas, antecipadas e limites da tolerância', () => {
  assert.equal(match('2026-09-15', '2026-09-15').tipo, 'exata');
  assert.equal(match('2026-09-15', '2026-09-20').tipo, 'proximidade');
  assert.equal(match('2026-09-15', '2026-09-21'), null);
  assert.equal(match('2026-09-15', '2026-09-14'), null);
  assert.equal(match('', ''), null);
  assert.equal(match('2026-02-30', '2026-03-02'), null);
  assert.equal(match('2026-09-15', '2026-09-16', empty, 0), null);
  assert.equal(dates.civilDate('15/09/2026'), '2026-09-15');
  assert.equal(dates.civilDate('2026-09-15T23:00:00-03:00'), '2026-09-15');
});
test('fim de semana e feriados consecutivos ajustam somente ao próximo dia útil', () => {
  assert.equal(match('2026-09-12','2026-09-14').tipo, 'dia_util');
  const calendar = { recurring: [], dates: ['2026-09-14','2026-09-15'] };
  assert.equal(match('2026-09-13','2026-09-16',calendar).tipo, 'dia_util');
  assert.equal(match('2026-09-13','2026-09-17',calendar).tipo, 'proximidade');
  assert.equal(match('2026-09-13','2026-09-14',calendar).tipo, 'proximidade');
  assert.equal(match('2026-12-31','2027-01-01',empty).tipo, 'proximidade');
  assert.equal(match('2028-02-29','2028-03-01',empty).dias, 1);
});
test('calendário é específico da empresa e respeita feriados nacionais', () => {
  assert.equal(match('2026-04-15','2026-04-16',dates.calendarForCompany(1)).tipo, 'dia_util');
  assert.equal(match('2026-04-15','2026-04-16',dates.calendarForCompany(2)).tipo, 'proximidade');
  assert.equal(match('2026-05-10','2026-05-12',dates.calendarForCompany(2)).tipo, 'dia_util');
  assert.equal(match('2026-11-25','2026-11-26',dates.calendarForCompany(2)).tipo, 'dia_util');
  assert.equal(match('2026-12-04','2026-12-07',dates.calendarForCompany(27404)).tipo, 'dia_util');
  assert.equal(match('2026-09-06','2026-09-08',dates.calendarForCompany(1)).tipo, 'dia_util');
  assert.equal(dates.toleranceForBank('viacredi'), 5);
  assert.equal(dates.toleranceForBank('sicredi'), 5);
});
const baseRow = { rowId: 'row-1', numeroLinha: 2, cliente: 'FORNECEDOR EXEMPLO', dataPagamento: '2026-09-17', valor: 100, tipo: 'D', documento:'42', status:'aguardando' };
async function reconcile(parcels, row = baseRow, options = {}) {
  const route = load('app/api/m8/conciliar/route.ts', {
    '@/lib/matching-dates': dates,
    '@/lib/amount-adjustment': adjustments,
    '@/lib/m8': {
      autenticarM8: async () => 'mock',
      listarContasPagar: async () => options.titles ?? [{id:1, fornecedorNome:'FORNECEDOR EXEMPLO', saldo:100}],
      listarParcelas: async (_, id) => { if(options.failId === id) throw new Error('HTTP 400'); return parcels; },
    },
  });
  const response = await route.POST(new Request('http://localhost/api/m8/conciliar', {method:'POST', body:JSON.stringify({company:1, bankId:'sicredi', rows:[row], modoConciliacao:'todos'})}));
  const events = (await response.text()).split('\n').filter(s=>s.trim()).map(s=>JSON.parse(s));
  return events.find(e=>e.result?.rowId === row.rowId)?.result;
}
const parcel = (vencimento, more = {}) => ({id:11, valor:100, saldo:100, vencimento,...more});
test('API mantém valor e fornecedor obrigatórios e classifica proximidade para revisão', async () => {
  const result = await reconcile([parcel('2026-09-15')]);
  assert.equal(result.status,'revisar');
  assert.equal(result.correspondenciaData.dias,2);
  assert.equal(result.parcelaId,11);
  assert.equal((await reconcile([parcel('2026-09-15',{valor:200})])).status,'nao_encontrado');
  assert.equal((await reconcile([parcel('2026-09-15')], {...baseRow,cliente:'OUTRO CLIENTE'})).status,'nao_encontrado');
});
test('API libera data exata e próximo dia útil, mas não antecipação', async () => {
  assert.equal((await reconcile([parcel('2026-09-17')])).status,'pronto');
  const adjusted = await reconcile([parcel('2026-09-12')],{...baseRow,dataPagamento:'2026-09-14'});
  assert.equal(adjusted.status,'pronto');
  assert.equal(adjusted.correspondenciaData.tipo,'dia_util');
  assert.equal((await reconcile([parcel('2026-09-18')])).status,'nao_encontrado');
});
test('API mantém conflito entre correspondência exata e próxima', async () => {
  assert.equal((await reconcile([parcel('2026-09-17'),parcel('2026-09-15',{id:12})])).status,'conflito');
});
test('API preserva baixa parcial e já baixada e não libera consulta incompleta', async () => {
  assert.equal((await reconcile([parcel('2026-09-15',{saldo:50})])).status,'parcialmente_baixada');
  assert.equal((await reconcile([parcel('2026-09-15',{saldo:0})])).status,'ja_baixada');
  assert.equal((await reconcile([parcel('2026-09-17')],baseRow,{titles:[{id:1,fornecedorNome:'FORNECEDOR EXEMPLO',saldo:100},{id:2,fornecedorNome:'FORNECEDOR EXEMPLO',saldo:100}],failId:2})).status,'erro');
});
function reviewedRow() {
  const row = {...baseRow, status:'pronto', valorJuros:0, jurosConfirmados:0, tituloId:1, parcelaId:11, parcelaM8:parcel('2026-09-15')};
  row.revisaoData = {aprovadaEm:'2026-09-18T12:00:00Z',company:1,bankId:'sicredi',tituloId:1,parcelaId:11,vencimento:'2026-09-15',pagamento:row.dataPagamento,valor:100};
  return row;
}
test('aprovação fica vinculada aos dados e não vale em outro contexto', () => {
  const row=reviewedRow();
  assert.equal(dates.validDateReview(row,1,'sicredi'),true);
  for(const changed of [{...row,valor:101},{...row,parcelaId:12},{...row,dataPagamento:'2026-09-18'},{...row,revisaoData:undefined}]) assert.equal(dates.validDateReview(changed,1,'sicredi'),false);
  assert.equal(dates.validDateReview(row,2,'sicredi'),false);
  assert.equal(dates.validDateReview(row,1,'viacredi'),false);
});
test('API de baixa bloqueia proximidade sem aprovação antes de autenticar', async () => {
  let authenticated = 0;
  const route=load('app/api/m8/baixar/route.ts',{'@/lib/matching-dates':dates,'@/lib/amount-adjustment':adjustments,'@/lib/m8':{autenticarM8:async()=>{authenticated++;throw new Error('Não deve autenticar');},baixarParcela:async()=>{throw new Error('Não deve baixar');}}});
  const row={...reviewedRow(),revisaoData:undefined};
  const response=await route.POST(new Request('http://localhost/api/m8/baixar',{method:'POST',body:JSON.stringify({company:1,bankId:'sicredi',rows:[row],config:{contaContabilId:14700,historicoId:2,meioPagamentoId:4}})}));
  assert.match(await response.text(),/correspondência não aprovada/);
  assert.equal(authenticated,0);
});

test('baixa aprovada usa a data real do pagamento e mantém ID e valor', async () => {
  const calls=[];
  const route=load('app/api/m8/baixar/route.ts',{'@/lib/matching-dates':dates,'@/lib/amount-adjustment':adjustments,'@/lib/m8':{
    autenticarM8:async()=> 'mock',
    baixarParcela:async(...args)=>{calls.push(args);return {ok:true};},
  }});
  const row=reviewedRow();
  const response=await route.POST(new Request('http://localhost/api/m8/baixar',{method:'POST',body:JSON.stringify({company:1,bankId:'sicredi',rows:[row],config:{contaContabilId:14700,historicoId:2,meioPagamentoId:4,observacaoInterna:'',complemento:''}})}));
  assert.match(await response.text(),/"status":"baixada"/);
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],1);
  assert.equal(calls[0][2],11);
  assert.equal(calls[0][3].data,'2026-09-17T12:00:00.000Z');
  assert.equal(calls[0][3].valor,100);
});

test('juros são subtraídos do extrato para localizar o principal', async () => {
  for (const [valor, valorJuros] of [[105,5],[120,20],[100,0]]) {
    const row = {...baseRow, valor, valorJuros};
    const result = await reconcile([parcel('2026-09-17')],row);
    assert.equal(result.status,'pronto');
    assert.equal(result.parcelaValor,100);
    assert.equal(row.valor,valor);
  }
  assert.equal((await reconcile([parcel('2026-09-17')],{...baseRow,valor:105,valorJuros:0})).status,'nao_encontrado');
});
test('juros aceitam vírgula, rejeitam negativos e ficam travados após conciliação', () => {
  assert.equal(adjustments.parseAdjustment('5,25'),5.25);
  assert.equal(adjustments.parseAdjustment('5.25'),5.25);
  assert.equal(adjustments.parseAdjustment(''),0);
  for(const input of ['-5', '-', 'abc','1,234','Infinity']) assert.equal(adjustments.parseAdjustment(input),null);
  assert.equal(adjustments.amountForMatching({valor:0.3,valorJuros:0.2}),0.1);
  for(const juros of [-1,10,11,null,0.001]) assert.equal(adjustments.amountForMatching({valor:10,valorJuros:juros}),null);
  const row = reviewedRow();
  assert.equal(adjustments.applyAdjustment(row,5),row);
  const edited = adjustments.applyAdjustment({...baseRow},5);
  assert.equal(edited.valorJuros,5);
  assert.equal(edited.valor,100);
});

test('baixa envia principal e juros separados e bloqueia juros modificados', async () => {
  const calls=[];
  let authentications=0;
  const route=load('app/api/m8/baixar/route.ts',{'@/lib/matching-dates':dates,'@/lib/amount-adjustment':adjustments,'@/lib/m8':{
    autenticarM8:async()=>{authentications++;return 'mock';},
    baixarParcela:async(...args)=>{calls.push(args);return {ok:true};},
  }});
  const result = await reconcile([parcel('2026-09-17')],{...baseRow,valor:105,valorJuros:5});
  assert.equal(result.jurosConfirmados,5);
  const row={...baseRow,valor:105,valorJuros:5,...result};
  const request=(r)=>new Request('http://localhost/api/m8/baixar',{method:'POST',body:JSON.stringify({company:1,bankId:'sicredi',rows:[r],config:{contaContabilId:14700,historicoId:2,meioPagamentoId:4,observacaoInterna:'',complemento:''}})});
  assert.match(await (await route.POST(request(row))).text(),/"status":"baixada"/);
  assert.equal(calls.length,1);
  assert.equal(calls[0][3].valor,100);
  assert.equal(calls[0][3].valorJuros,5);
  assert.equal(calls[0][3].valor + calls[0][3].valorJuros,105);
  assert.match(await (await route.POST(request({...row,valorJuros:4}))).text(),/juros ou valor principal alterados/);
  assert.equal(calls.length,1);
  assert.equal(authentications,1);
});
