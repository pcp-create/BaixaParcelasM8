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
  assert.equal(match('2026-09-15', '2026-09-14').tipo, 'antecipada');
  assert.equal(match('2026-09-30', '2026-09-01').dias, -29);
  assert.equal(match('2026-10-01', '2026-09-30'), null);
  assert.equal(match('2027-09-15', '2026-09-14'), null);
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
      listarContasPagar: async () => options.titles ?? [{id:1, fornecedorNome:'FORNECEDOR EXEMPLO', complemento:'FORNECEDOR EXEMPLO', saldo:100}],
      listarParcelas: async (_, id) => { if(options.failId === id) throw new Error('HTTP 400'); return options.parcelsByTitle?.[id] ?? parcels; },
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
test('API libera data exata e próximo dia útil e exige revisão da antecipação', async () => {
  assert.equal((await reconcile([parcel('2026-09-17')])).status,'pronto');
  const adjusted = await reconcile([parcel('2026-09-12')],{...baseRow,dataPagamento:'2026-09-14'});
  assert.equal(adjusted.status,'pronto');
  assert.equal(adjusted.correspondenciaData.tipo,'dia_util');
  assert.equal((await reconcile([parcel('2026-09-18')])).status,'revisar');
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
  assert.equal((await reconcile([parcel('2026-09-17')],{...baseRow,valor:105,valorJuros:0})).status,'sugestao');
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
  assert.match(await (await route.POST(request({...row,valorJuros:4}))).text(),/juros, desconto ou valor principal alterados/);
  assert.equal(calls.length,1);
  assert.equal(authentications,1);
});

test('consulta preserva complemento do JSON da parcela até a comparação na conciliação', async (t) => {
  const { listarParcelas } = load('lib/m8.ts');
  const complemento = 'Pagamento fornecedor exemplo';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    data: [parcel('2026-09-17', { complemento })],
  }), {status: 200}));
  const parcelas = await listarParcelas('token-ficticio', 1);
  assert.equal(parcelas[0].complemento, complemento);
  const options = {titles: [{id: 1, fornecedorNome: 'OUTRA EMPRESA', saldo: 100}]};
  const result = await reconcile(parcelas, baseRow, options);
  assert.equal(result.status, 'pronto');
  assert.match(result.statusMensagem, /complemento da parcela/);
  assert.equal((await reconcile(parcelas.map(p => ({...p, complemento: undefined})), baseRow, options)).status, 'nao_encontrado');
});

test('busca no complemento da própria parcela quando o título não identifica o fornecedor', async () => {
  const options={titles:[{id:1,fornecedorNome:'OUTRA EMPRESA',saldo:100}]};
  const matched=await reconcile([parcel('2026-09-17',{complemento:'Pagamento fornecedor exemplo'})],baseRow,options);
  assert.equal(matched.status,'pronto');
  assert.match(matched.statusMensagem,/complemento da parcela/);
  assert.equal((await reconcile([parcel('2026-09-17',{complemento:'Pagamento fornecedor exemplo',valor:200}),parcel('2026-09-17',{id:12,complemento:'Sem identificação'})],baseRow,options)).status,'nao_encontrado');
  assert.equal((await reconcile([parcel('2026-09-15',{complemento:'Fornecedor exemplo'})],baseRow,options)).status,'revisar');
  assert.equal((await reconcile([parcel('2026-09-01',{complemento:'Fornecedor exemplo'})],baseRow,options)).status,'nao_encontrado');
});

test('busca por complemento da parcela mantém conflitos e erros de consulta', async () => {
  const options={titles:[{id:1,fornecedorNome:'OUTRA EMPRESA',saldo:100}]};
  assert.equal((await reconcile([parcel('2026-09-17',{complemento:'Fornecedor exemplo'}),parcel('2026-09-17',{id:12,complemento:'Fornecedor exemplo'})],baseRow,options)).status,'conflito');
  assert.equal((await reconcile([],baseRow,{...options,failId:1})).status,'erro');
  assert.equal((await reconcile([parcel('2026-09-17',{complemento:'PAGAMENTO PIX BANCO'})],{...baseRow,cliente:'PIX BANCO'},options)).status,'nao_encontrado');
});

const {selectValueSuggestion} = load('lib/value-suggestions.ts');
test('sugere duas parcelas, calcula juros/desconto e aguarda seleção explícita', async () => {
  const row={...baseRow,valor:105};
  const result=await reconcile([parcel('2026-09-17'),parcel('2026-09-15',{id:12,valor:120,saldo:120})],row);
  assert.equal(result.status,'sugestao');
  assert.equal(result.parcelaId,undefined);
  assert.equal(result.sugestoesValor.length,2);
  assert.deepEqual(result.sugestoesValor.map(s=>[s.juros,s.desconto]),[[5,0],[0,15]]);
  const selected=selectValueSuggestion({...row,...result},result.sugestoesValor[1],1,'sicredi');
  assert.equal(selected.status,'pronto');
  assert.equal(selected.parcelaId,12);
  assert.equal(selected.valorJuros,0);
  assert.equal(selected.valorDesconto,15);
  assert.equal(selected.descontoConfirmado,15);
  assert.equal(adjustments.amountForMatching(selected),120);
  assert.equal(dates.validDateReview(selected,1,'sicredi'),true);
  assert.equal(adjustments.applyAdjustment(selected,1),selected);
});
test('valor exato tem prioridade e sugestões não incluem baixadas, parciais ou datas incompatíveis', async () => {
  const exact=await reconcile([parcel('2026-09-17'),parcel('2026-09-17',{id:12,valor:120,saldo:120})]);
  assert.equal(exact.status,'pronto');
  assert.equal(exact.sugestoesValor,undefined);
  const none=await reconcile([
    parcel('2026-09-17',{valor:120,saldo:0}),
    parcel('2026-09-17',{id:12,valor:120,saldo:60}),
    parcel('2026-09-01',{id:13,valor:120,saldo:120}),
  ]);
  assert.equal(none.status,'nao_encontrado');
});
test('seleção envia principal, juros ou desconto no POST e mantém o total pago', async () => {
  const calls=[];
  const route=load('app/api/m8/baixar/route.ts',{'@/lib/matching-dates':dates,'@/lib/amount-adjustment':adjustments,'@/lib/m8':{
    autenticarM8:async()=> 'mock',baixarParcela:async(...args)=>{calls.push(args);return {ok:true};},
  }});
  for(const principal of [100,120]) {
    const row={...baseRow,valor:105};
    const result=await reconcile([parcel('2026-09-17',{valor:principal,saldo:principal})],row);
    const selected=selectValueSuggestion({...row,...result},result.sugestoesValor[0],1,'sicredi');
    const request=(r)=>new Request('http://localhost/api/m8/baixar',{method:'POST',body:JSON.stringify({company:1,bankId:'sicredi',rows:[r],config:{contaContabilId:14700,historicoId:2,meioPagamentoId:4,observacaoInterna:'',complemento:''}})});
    assert.match(await (await route.POST(request({...row,...result}))).text(),/alterados|não aprovada/);
    assert.match(await (await route.POST(request(selected))).text(),/"status":"baixada"/);
    const payload=calls.at(-1)[3];
    assert.equal(payload.valor,principal);
    assert.equal(payload.valor + payload.valorJuros - payload.valorDesconto,105);
    assert.equal(payload.valorJuros,principal===100?5:0);
    assert.equal(payload.valorDesconto,principal===120?15:0);
    const before=calls.length;
    assert.match(await (await route.POST(request({...selected,valorDesconto:16}))).text(),/alterados/);
    assert.equal(calls.length,before);
  }
});

const {selectionOwner,selectSuggestionInRows,clearValueSelection} = load('lib/value-suggestions.ts');
test('reserva a parcela em uma linha, bloqueia outra e libera ao remover a seleção', async () => {
  const result=await reconcile([parcel('2026-09-17')],{...baseRow,valor:105});
  const first={...baseRow,...result,valor:105};
  const second={...first,rowId:'row-2',numeroLinha:3};
  const option=result.sugestoesValor[0];
  let rows=selectSuggestionInRows([first,second],first.rowId,option,1,'sicredi');
  assert.equal(rows[0].status,'pronto');
  assert.equal(selectionOwner(rows,second.rowId,1,11).rowId,first.rowId);
  assert.equal(selectSuggestionInRows(rows,second.rowId,option,1,'sicredi'),rows);
  rows=rows.map(row=>row.rowId===first.rowId?clearValueSelection(row):row);
  assert.equal(rows[0].status,'sugestao');
  assert.equal(rows[0].tituloId,undefined);
  assert.equal(rows[0].parcelaId,undefined);
  assert.equal(rows[0].valorJuros,0);
  assert.equal(rows[0].valorDesconto,0);
  assert.equal(rows[0].jurosConfirmados,undefined);
  assert.equal(rows[0].revisaoData,undefined);
  assert.equal(rows[0].sugestoesValor.length,1);
  rows=selectSuggestionInRows(rows,second.rowId,option,1,'sicredi');
  assert.equal(rows[1].status,'pronto');
  assert.equal(rows[1].valorJuros,5);
  const paid={...rows[1],status:'baixada'};
  assert.equal(clearValueSelection(paid),paid);
  assert.equal(selectionOwner([rows[0],paid],first.rowId,1,11).rowId,second.rowId);
});
test('trocar opção libera a parcela anterior sem bloquear a própria seleção', async () => {
  const result=await reconcile([parcel('2026-09-17'),parcel('2026-09-17',{id:12,valor:120,saldo:120})],{...baseRow,valor:105});
  let rows=[{...baseRow,...result,valor:105}];
  rows=selectSuggestionInRows(rows,baseRow.rowId,result.sugestoesValor[0],1,'sicredi');
  rows=selectSuggestionInRows(rows,baseRow.rowId,result.sugestoesValor[1],1,'sicredi');
  assert.equal(rows[0].parcelaId,12);
  assert.equal(rows[0].valorDesconto,15);
  assert.equal(selectionOwner(rows,'another',1,11),undefined);
});
test('API rejeita lote com parcela duplicada antes de autenticar ou baixar', async () => {
  let authenticated=0, lowered=0;
  const route=load('app/api/m8/baixar/route.ts',{'@/lib/matching-dates':dates,'@/lib/amount-adjustment':adjustments,'@/lib/m8':{
    autenticarM8:async()=>{authenticated++;return 'mock';},baixarParcela:async()=>{lowered++;return {ok:true};},
  }});
  const row=reviewedRow();
  const response=await route.POST(new Request('http://localhost/api/m8/baixar',{method:'POST',body:JSON.stringify({company:1,bankId:'sicredi',rows:[row,{...row,rowId:'row-2',numeroLinha:3}],config:{contaContabilId:14700,historicoId:2,meioPagamentoId:4}})}));
  assert.match(await response.text(),/selecionada nas linhas 2 e 3/);
  assert.equal(authenticated,0);
  assert.equal(lowered,0);
});

test('sugere parcela identificada apenas no complemento mesmo havendo outro título candidato', async () => {
  const row = {...baseRow, cliente:'DEB.PARC.BNDES AUTOMA', valor:11139.22, dataPagamento:'2026-09-15'};
  const result = await reconcile([], row, {
    titles:[{id:32545, fornecedorNome:'VIACREDI', complemento:'EMPRESTIMO BNDES',saldo:5291.87}, {id:1543, fornecedorNome:'VIACREDI', complemento:'',saldo:7081.35}],
    parcelsByTitle:{32545:[parcel('2026-09-15',{id:44865,valor:5291.87,saldo:5291.87})],1543:[parcel('2026-09-15',{id:2041,valor:7081.35,saldo:7081.35,complemento:'DEB.PARC.BNDES AUTOMA'}),parcel('2026-09-15',{id:2042,complemento:'OUTRO CLIENTE'})]},
  });
  assert.equal(result.status,'sugestao');
  assert.deepEqual(result.sugestoesValor.map(s=>s.parcela.id),[2041]);
  assert.equal(result.sugestoesValor[0].juros,4057.87);
});

test('antecipação no mês gera sugestão e baixa exige aprovação vinculada às datas', async () => {
  const result = await reconcile([parcel('2026-09-30')], {...baseRow,valor:105});
  assert.equal(result.status,'sugestao');
  assert.equal(result.sugestoesValor[0].data.tipo,'antecipada');
  const calls=[];
  const route=load('app/api/m8/baixar/route.ts',{'@/lib/matching-dates':dates,'@/lib/amount-adjustment':adjustments,'@/lib/m8':{
    autenticarM8:async()=> 'mock', baixarParcela:async(...args)=>{calls.push(args);return {ok:true};},
  }});
  const row={...reviewedRow(),parcelaM8:parcel('2026-09-30'),revisaoData:undefined};
  const request=r=>new Request('http://localhost/api/m8/baixar',{method:'POST',body:JSON.stringify({company:1,bankId:'sicredi',rows:[r],config:{contaContabilId:14700,historicoId:2,meioPagamentoId:4}})});
  assert.match(await (await route.POST(request(row))).text(),/correspondência não aprovada/);
  assert.equal(calls.length,0);
  row.revisaoData={...reviewedRow().revisaoData,vencimento:'2026-09-30'};
  assert.match(await (await route.POST(request(row))).text(),/"status":"baixada"/);
  assert.equal(calls.length,1);
  assert.equal(calls[0][3].data,'2026-09-17T12:00:00.000Z');
});

test('período cobre mês, antecipação, tolerância, feriados e extrato com vários meses', () => {
  const period = (payments, calendar=empty, tolerance=5) => dates.consultationPeriod(payments.map(dataPagamento=>({...baseRow,dataPagamento})),calendar,tolerance);
  assert.deepEqual(period(['2026-09-15']),{inicio:'2026-09-01',fim:'2026-09-30'});
  assert.deepEqual(period(['2026-09-01']),{inicio:'2026-08-27',fim:'2026-09-30'});
  assert.deepEqual(period(['2026-09-01'],{recurring:[],dates:['2026-08-31']},0),{inicio:'2026-08-29',fim:'2026-09-30'});
  assert.deepEqual(period(['2026-12-15','2027-01-02']),{inicio:'2026-12-01',fim:'2027-01-31'});
  assert.equal(period(['inválida']),null);
  assert.equal(dates.consultationPeriod([{...baseRow,tipo:'C'}],empty,5),null);
});

test('consulta de títulos envia período no endpoint documentado e rejeita retorno incompleto', async t => {
  const {listarContasPagar} = load('lib/m8.ts');
  let payload = {data:[{id:1543,saldo:7081.35,complemento:'BNDES'}],errors:[]};
  t.mock.method(globalThis,'fetch',async url=>{
    const parsed=new URL(url);
    assert.equal(parsed.pathname,'/v1/financeiro/contapagar/consulta');
    assert.equal(parsed.searchParams.get('VencimentoInicial'),'2026-09-01T00:00:00');
    assert.equal(parsed.searchParams.get('VencimentoFinal'),'2026-09-30T23:59:59.999');
    return new Response(JSON.stringify(payload),{status:200});
  });
  const periodo={inicio:'2026-09-01',fim:'2026-09-30'};
  assert.equal((await listarContasPagar('token-ficticio',periodo))[0].id,1543);
  payload={data:[],errors:[{message:'consulta incompleta'}]};
  await assert.rejects(()=>listarContasPagar('token-ficticio',periodo),/lista incompleta/);
});

test('sugestões exigem CLIENTE completo no complemento do título ou da própria parcela', async () => {
  const row={...baseRow,cliente:'PG.P/INTERNET - DISK AMP TENHA LOGISTICA LTD',valor:51};
  const options=complemento=>({titles:[{id:1,fornecedorNome:'DISK AMP TENHA',complemento,saldo:100}]});
  assert.equal((await reconcile([parcel('2026-09-17')],row,options('BNDES PRONAMPE'))).status,'nao_encontrado');
  assert.equal((await reconcile([parcel('2026-09-17')],row,options('DISK AMP TENHA LOGISTICA LTD'))).status,'nao_encontrado');
  const full='Observação: pg.p/internet - disk amp tenha logística ltd / pagamento';
  assert.equal((await reconcile([parcel('2026-09-17')],row,options(full))).status,'sugestao');
  const result=await reconcile([parcel('2026-09-17',{complemento:full}),parcel('2026-09-17',{id:12,complemento:'DISK AMP'})],row,options(''));
  assert.deepEqual(result.sugestoesValor.map(s=>s.parcela.id),[11]);
  assert.equal((await reconcile([parcel('2026-09-17')],row,options(row.cliente+'A'))).status,'nao_encontrado');
  // A regra nova não altera a conciliação com valor exato pelo fornecedor.
  assert.equal((await reconcile([parcel('2026-09-17',{valor:51,saldo:51})],row,options(''))).status,'pronto');
});

test('usa tituloId da consulta na URL de parcelas e no resultado da conciliação', async t => {
  const {listarContasPagar,listarParcelas}=load('lib/m8.ts');
  const paths=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const pathname=new URL(url).pathname;
    paths.push(pathname);
    if(pathname.endsWith('/consulta')) return new Response(JSON.stringify({data:[{
      id:99999,tituloId:1543,pessoaNome:'OUTRA EMPRESA',saldo:0,
    },{id:99998,tituloId:1543,saldo:100},{id:null,tituloId:0,adiantamento:true}]}));
    assert.equal(pathname,'/v1/financeiro/contapagar/1543/parcela');
    return new Response(JSON.stringify({data:[parcel('2026-09-17',{
      id:2041,tituloId:1543,complemento:'FORNECEDOR EXEMPLO',
    })]}));
  });
  const titles=await listarContasPagar('token-ficticio',{inicio:'2026-09-01',fim:'2026-09-30'});
  assert.equal(titles[0].id,1543);
  const parcels=await listarParcelas('token-ficticio',titles[0].id);
  const result=await reconcile(parcels,baseRow,{titles});
  assert.equal(result.status,'pronto');
  assert.equal(result.tituloId,1543);
  assert.equal(result.parcelaId,2041);
  assert.equal(paths.length,2);
  assert.equal(titles.length,1);
  assert.equal(titles[0].fornecedorNome,'OUTRA EMPRESA');
  assert.equal(titles[0].saldo,100);
  assert.equal(titles[0].complemento,undefined);
});

test('conflito permite escolha manual de parcela aberta e mantém reserva por linha', async () => {
  const result=await reconcile([parcel('2026-09-17'),parcel('2026-09-15',{id:12}),parcel('2026-09-17',{id:13,saldo:0}),parcel('2026-09-17',{id:14,saldo:50})]);
  assert.equal(result.status,'conflito');
  assert.deepEqual(result.sugestoesValor.map(s=>s.parcela.id),[11,12]);
  const {selectSuggestionInRows,clearValueSelection}=load('lib/value-suggestions.ts');
  const row={...baseRow,...result};
  const selected=selectValueSuggestion(row,result.sugestoesValor[1],1,'sicredi');
  assert.equal(selected.status,'pronto');
  assert.equal(selected.parcelaId,12);
  assert.equal(selected.valorJuros,0);
  assert.equal(selected.valorDesconto,0);
  assert.equal(dates.validDateReview(selected,1,'sicredi'),true);
  const other={...row,rowId:'other'};
  const rows=[selected,other];
  assert.equal(selectSuggestionInRows(rows,'other',result.sugestoesValor[1],1,'sicredi'),rows);
  const cleared=clearValueSelection(selected);
  assert.equal(cleared.parcelaId,undefined);
  assert.equal(selectSuggestionInRows([cleared,other],'other',result.sugestoesValor[1],1,'sicredi')[1].status,'pronto');
});
