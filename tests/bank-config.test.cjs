const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const ts = require("typescript");

// Executa os módulos TypeScript usando a dependência já presente no projeto.
function loadTs(relativePath) {
  const filename = path.resolve(__dirname, "..", relativePath);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(compiled.outputText, filename);
  return loaded.exports;
}

const { parseCsv, normalizeRows } = loadTs("lib/csv.ts");
const { loadBanks, serializeM8 } = loadTs("lib/banks.ts");

test("Viacredi importa por posição e mantém Tipo separado do vencimento", () => {
  const bank = loadBanks()[0];
  // Cabeçalhos numéricos fora de ordem não devem reordenar as colunas.
  const parsed = parseCsv('\uFEFF9;8;7;6;5\r\n16/09/2026;"Fornecedor; SA";00042;"1.234,56";d\r\n\r\n17/09/2026;Cliente;00043;50,00;c\r\n');
  const rows = normalizeRows(parsed.rows, bank);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].numeroLinha, 2);
  assert.equal(rows[0].cliente, "Fornecedor; SA");
  assert.equal(rows[0].dataPagamento, "2026-09-16");
  assert.equal(rows[0].documento, "00042");
  assert.equal(rows[0].valor, 1234.56);
  assert.equal(rows[0].dataVencimento, "");
  assert.equal(rows[0].tipo, "D");
  assert.equal(rows[0].status, "aguardando");
  assert.equal(rows[1].numeroLinha, 4);
  assert.equal(rows[1].tipo, "C");
  assert.equal(rows[1].status, "credito");
});

test("primeira linha de dados definida no arquivo é respeitada", () => {
  const bank = { ...loadBanks()[0], linhaInicio: 3 };
  const parsed = parseCsv("Data;Cliente;Documento;Valor;Tipo\nignorar;ignorar;0;0;D\n16/09/2026;Fornecedor;42;10,00;D");
  const rows = normalizeRows(parsed.rows, bank);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].numeroLinha, 3);
  assert.equal(rows[0].documento, "42");
});

test("padrões do M8 são os solicitados para o Viacredi", () => {
  assert.deepEqual(loadBanks()[0].m8, {
    contaContabilId: 1033,
    contaContabilCodigo: "100038",
    contaContabilNome: "ViaCredi Alto Vale - RJ IND.",
    historicoId: 2,
    meioPagamentoId: 4,
    observacaoInterna: "Baixa automática via conciliação bancária",
    complemento: "Banco Viacredi",
  });
});

test("persistência permite alterações M8 sem sobrescrever banco ou layout", () => {
  const original = loadBanks()[0];
  const banks = loadBanks(JSON.stringify({
    viacredi: { historicoId: 8, contaContabilId: 42, complemento: "Personalizado", nome: "Alterado", linhaInicio: 9, mapping: { valor: 1 } },
    "banco-injetado": { historicoId: 9 },
  }));
  assert.equal(banks.length, loadBanks().length);
  assert.equal(banks[0].nome, original.nome);
  assert.equal(banks[0].linhaInicio, 2);
  assert.deepEqual(banks[0].mapping, original.mapping);
  assert.equal(banks[0].m8.historicoId, 8);
  assert.equal(banks[0].m8.contaContabilId, 42);
  assert.equal(banks[0].m8.contaContabilNome, undefined);
  assert.equal(banks[0].m8.complemento, "Personalizado");
  assert.deepEqual(loadBanks(serializeM8(banks)), banks);
  const saved = JSON.parse(serializeM8(banks));
  assert.equal(saved.viacredi.mapping, undefined);
});

test("armazenamento inválido ou antigo não substitui os padrões", () => {
  for (const saved of ["{", "null", "[]", JSON.stringify([{ id: "viacredi", mapping: { valor: 1 } }]), '{"viacredi":{"historicoId":-1,"meioPagamentoId":"erro"}}']) {
    assert.deepEqual(loadBanks(saved), loadBanks());
  }
});

const XLSX = require("xlsx");
const { parseSicrediSpreadsheet } = loadTs("lib/spreadsheet.ts");
const sicredi = loadBanks().find((bank) => bank.id === "sicredi");

test("Sicredi importa apenas linhas 11 e 12 e ignora saldos e lançamentos futuros", () => {
  // Estrutura do extrato fornecido, com dados fictícios.
  const lines = Array.from({ length: 32 }, () => []);
  lines[1] = ["Associado:", "Empresa exemplo"];
  lines[6] = ["Dados referentes ao período de 10/09/2026 a 10/09/2026."];
  lines[8] = ["Data", "Descrição", "Documento", "Valor (R$)", "Saldo (R$)"];
  lines[9] = ["", "Saldo Anterior", "", "", 1000];
  lines[10] = ["10/09/2026", "Pagamento exemplo", " ", -100, 900];
  lines[11] = ["10/09/2026", "Tarifa exemplo", " ", -20, 880];
  lines[13] = ["Saldo da Conta em 16/09/2026"];
  lines[22] = ["Vencimento do cheque especial", "", "28/09/2026"];
  lines[28] = ["Lançamentos Futuros (Próximos 30 dias)"];
  lines[29] = ["Data", "Descrição", "Valor (R$)"];
  lines[30] = ["10/10/2026", "Tarifa futura", -20];
  const parsed = parseSicrediSpreadsheet(spreadsheetFile(lines));
  assert.equal(parsed.firstDataRow, 11);
  assert.deepEqual(parsed.rows.map((row) => row.numeroLinha), [11, 12]);
  const rows = normalizeRows(parsed.rows, sicredi);
  assert.deepEqual(rows.map((row) => [row.tipo, row.valor, row.documento]), [["D", 100, ""], ["D", 20, ""]]);
});

test("Sicredi interrompe em lançamentos futuros mesmo sem resumo de saldo", () => {
  const parsed = parseSicrediSpreadsheet(spreadsheetFile([
    ["10/09/2026", "Pagamento", "42", -100],
    ["Lançamentos Futuros (Próximos 30 dias)"],
    ["10/10/2026", "Pagamento futuro", "43", -200],
  ]));
  assert.deepEqual(parsed.rows.map((row) => row.numeroLinha), [1]);
});

function spreadsheetFile(lines, { bookType = "biff8", date1904 = false } = {}) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(lines), "Extrato");
  book.Workbook = { WBProps: { date1904 } };
  return XLSX.write(book, { type: "array", bookType });
}

for (const start of [4, 11, 15]) {
  test(`Sicredi detecta a primeira data na linha ${start} em XLS binário`, () => {
    const lines = Array.from({ length: start - 1 }, () => []);
    lines[0] = ["Extrato Sicredi"];
    lines[1] = [100038]; // Número de conta não deve ser interpretado como data.
    lines.push(["16/09/2026", "Fornecedor", "000123", -1234.56]);
    lines.push(["17/09/2026", "Cliente", "000124", 50]);
    lines.push(["Saldo final", "", "", 123]);
    const parsed = parseSicrediSpreadsheet(spreadsheetFile(lines));
    const rows = normalizeRows(parsed.rows, sicredi);
    assert.equal(parsed.firstDataRow, start);
    assert.equal(parsed.skippedRows, 1);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].numeroLinha, start);
    assert.equal(rows[0].dataPagamento, "2026-09-16");
    assert.equal(rows[0].documento, "000123");
    assert.equal(rows[0].tipo, "D");
    assert.equal(rows[0].valor, 1234.56);
    assert.equal(rows[0].status, "aguardando");
    assert.equal(rows[1].tipo, "C");
    assert.equal(rows[1].status, "credito");
  });
}

test("Sicredi lê datas numéricas do Excel em XLS e XLSX, incluindo época 1904", () => {
  for (const bookType of ["biff8", "xlsx"]) {
    for (const date1904 of [false, true]) {
      const parsed = parseSicrediSpreadsheet(spreadsheetFile([
        ["Data", "Fornecedor", "Documento", "Valor"],
        [{ t: "n", v: 46281 - (date1904 ? 1462 : 0), z: "dd/mm/yyyy" }, "Fornecedor", { t: "n", v: 42, z: "00000" }, -10],
      ], { bookType, date1904 }));
      const rows = normalizeRows(parsed.rows, sicredi);
      assert.equal(rows[0].dataPagamento, "2026-09-16");
      assert.equal(rows[0].documento, "00042");
    }
  }
});

test("Sicredi valida datas e moeda brasileira em texto sem perder o sinal", () => {
  const parsed = parseSicrediSpreadsheet(spreadsheetFile([
    ["31/02/2026", "Data inválida", "", 1],
    ["Período 01/09/2026 a 30/09/2026"],
    ["16/09/2026", "Fornecedor", "42", "R$ -1.234,56"],
    ["17/09/2026", "Fornecedor", "43", "(50,25)"],
    ["18/09/2026", "Cliente", "44", "1.234,56"],
    ["19/09/2026", "Fornecedor", "45", "50,25-"],
  ]));
  assert.equal(parsed.firstDataRow, 3);
  const rows = normalizeRows(parsed.rows, sicredi);
  assert.deepEqual(rows.map((r) => [r.tipo, r.valor]), [["D", 1234.56], ["D", 50.25], ["C", 1234.56], ["D", 50.25]]);
});

test("Sicredi rejeita arquivo sem data ou valor inválido e sinaliza valor zero", () => {
  assert.throws(() => parseSicrediSpreadsheet(spreadsheetFile([["Sem data"], ["31/02/2026"]])), /Nenhuma data válida/);
  assert.throws(() => parseSicrediSpreadsheet(spreadsheetFile([["16/09/2026", "Fornecedor", "42", "inválido"]])), /Valor inválido na linha 1/);
  const parsed = parseSicrediSpreadsheet(spreadsheetFile([["16/09/2026", "Fornecedor", "42", 0]]));
  const [row] = normalizeRows(parsed.rows, sicredi);
  assert.equal(row.status, "erro");
  assert.equal(row.tipo, "");
});

test("corrige IDs antigos salvos e aplica os padrões M8 do Sicredi", () => {
  const banks = loadBanks(JSON.stringify({
    viacredi: { contaContabilId: 100038, historicoId: 7, complemento: "Personalizado" },
    sicredi: { contaContabilId: 0, historicoId: 0, meioPagamentoId: 0 },
  }));
  assert.equal(banks[0].m8.contaContabilId, 1033);
  assert.equal(banks[0].m8.contaContabilCodigo, "100038");
  assert.equal(banks[0].m8.historicoId, 7);
  assert.equal(banks[0].m8.complemento, "Personalizado");
  const m8 = banks.find((bank) => bank.id === "sicredi").m8;
  assert.equal(m8.contaContabilId, 14700);
  assert.equal(m8.contaContabilCodigo, "103066");
  assert.equal(m8.contaContabilNome, "Sicredi - RJ");
  assert.equal(m8.historicoId, 2);
  assert.equal(m8.meioPagamentoId, 4);
});

test("preserva ID, código e nome de uma conta selecionada pelo usuário", () => {
  const banks = loadBanks(JSON.stringify({ sicredi: {
    contaContabilId: 42, contaContabilCodigo: "100099", contaContabilNome: "Outra conta", historicoId: 8, meioPagamentoId: 9,
  }}));
  assert.deepEqual(loadBanks(serializeM8(banks)), banks);
  const m8 = banks.find((bank) => bank.id === "sicredi").m8;
  assert.equal(m8.contaContabilId, 42);
  assert.equal(m8.contaContabilCodigo, "100099");
  assert.equal(m8.contaContabilNome, "Outra conta");
  assert.equal(m8.historicoId, 8);
  assert.equal(m8.meioPagamentoId, 9);
});

test("não restaura uma conta removida explicitamente na nova configuração", () => {
  const banks = loadBanks(JSON.stringify({ sicredi: { contaContabilId: 0, contaContabilCodigo: "", historicoId: 0 } }));
  const m8 = banks.find((bank) => bank.id === "sicredi").m8;
  assert.equal(m8.contaContabilId, 0);
  assert.equal(m8.contaContabilCodigo, "");
  assert.equal(m8.historicoId, 0);
});
