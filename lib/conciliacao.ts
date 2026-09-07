import { M8ContaPagar, M8Parcela, NormalizedCsvRow } from "./types";

const normalizeText = (value?: string) =>
  (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const normalizeDoc = (value?: string) => (value || "").trim().replace(/^0+/, "") || "0";
const sameMoney = (a?: number | null, b?: number | null) =>
  a != null && b != null && Math.abs(Number(a) - Number(b)) <= 0.01;
const isoDay = (value?: string) => (value || "").slice(0, 10);

export function titulosPorDocumento(row: NormalizedCsvRow, titulos: M8ContaPagar[]) {
  const doc = normalizeDoc(row.documento);
  return titulos.filter((t) => normalizeDoc(String(t.documento ?? "")) === doc);
}

export function escolherParcela(
  row: NormalizedCsvRow,
  titulo: M8ContaPagar,
  parcelas: M8Parcela[]
): { parcela?: M8Parcela; motivo?: string } {
  const abertas = parcelas.filter((p) => Number(p.saldo ?? p.valor ?? 0) > 0.009);
  const porValor = row.valor == null ? abertas : abertas.filter((p) => sameMoney(row.valor, Number(p.saldo ?? p.valor ?? 0)));
  const porVencimento = row.dataVencimento
    ? porValor.filter((p) => isoDay(p.vencimento) === row.dataVencimento)
    : porValor;

  const tituloNome = normalizeText(titulo.fornecedorNome || titulo.pessoaCompraNome);
  const cliente = normalizeText(row.cliente);
  let candidatos = porVencimento;
  if (cliente && tituloNome && cliente !== tituloNome) {
    // Não elimina automaticamente: nomes bancários podem variar; apenas o conjunto já precisa coincidir em doc+valor+vencimento.
  }

  if (candidatos.length === 1) return { parcela: candidatos[0] };
  if (candidatos.length === 0) return { motivo: "Nenhuma parcela em aberto coincide com valor e vencimento do CSV." };
  return { motivo: `Foram encontradas ${candidatos.length} parcelas possíveis para o mesmo título.` };
}
