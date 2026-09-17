import { NormalizedCsvRow, ValueSuggestion } from "./types";

export function selectionOwner(rows: NormalizedCsvRow[], rowId: string, tituloId: number, parcelaId: number): NormalizedCsvRow | undefined {
  return rows.find((row) => row.rowId !== rowId && row.tituloId === tituloId && row.parcelaId === parcelaId);
}

/** Usa o estado completo e atual para impedir escolhas simultâneas em duas linhas. */
export function selectSuggestionInRows(rows: NormalizedCsvRow[], rowId: string, suggestion: ValueSuggestion, company: number, bankId: string): NormalizedCsvRow[] {
  if (selectionOwner(rows, rowId, suggestion.titulo.id, suggestion.parcela.id)) return rows;
  return rows.map((row) => row.rowId === rowId ? selectValueSuggestion(row, suggestion, company, bankId) : row);
}

export function clearValueSelection(row: NormalizedCsvRow): NormalizedCsvRow {
  if (!["pronto", "revisar"].includes(row.status)) return row;
  return {
    ...row,
    status: row.sugestoesValor?.length ? "sugestao" : "aguardando",
    statusMensagem: row.sugestoesValor?.length ? "Seleção removida. Escolha uma parcela para continuar." : "Seleção removida. Concilie novamente para continuar.",
    tituloId: undefined, parcelaId: undefined, tituloM8: undefined, parcelaM8: undefined,
    fornecedorNome: undefined, parcelaValor: undefined, parcelaSaldo: undefined,
    valorJuros: 0, valorDesconto: 0, jurosConfirmados: undefined, descontoConfirmado: undefined,
    correspondenciaData: undefined, revisaoData: undefined, baixaM8: undefined, apiError: undefined,
  };
}

export function selectValueSuggestion(row: NormalizedCsvRow, suggestion: ValueSuggestion, company: number, bankId: string): NormalizedCsvRow {
  if (!["sugestao", "conflito", "pronto"].includes(row.status) || !row.sugestoesValor?.includes(suggestion) || row.valor == null) return row;
  const { titulo, parcela, data, principal } = suggestion;
  const delta = Math.round(row.valor * 100) - Math.round(principal * 100);
  const juros = Math.max(delta, 0) / 100;
  const desconto = Math.max(-delta, 0) / 100;
  return {
    ...row, status: "pronto", tituloId: titulo.id, parcelaId: parcela.id,
    tituloM8: titulo, parcelaM8: parcela, fornecedorNome: titulo.fornecedorNome,
    parcelaValor: principal, parcelaSaldo: parcela.saldo,
    valorJuros: juros, jurosConfirmados: juros, valorDesconto: desconto, descontoConfirmado: desconto,
    correspondenciaData: data,
    revisaoData: { aprovadaEm: new Date().toISOString(), company, bankId, tituloId: titulo.id, parcelaId: parcela.id, vencimento: data.vencimento, pagamento: data.pagamento, valor: row.valor },
    statusMensagem: `Parcela selecionada manualmente. ${data.motivo} Juros: R$ ${juros.toFixed(2)}; desconto: R$ ${desconto.toFixed(2)}. Pronta para baixa.`,
    apiError: undefined,
  };
}
