import { NormalizedCsvRow, ValueSuggestion } from "./types";

export function selectionOwner(rows: NormalizedCsvRow[], rowId: string, tituloId: number, parcelaId: number): NormalizedCsvRow | undefined {
  return rows.find((row) => row.rowId !== rowId && (row.tituloId === tituloId && row.parcelaId === parcelaId || row.parcelasSelecionadas?.some(p => p.tituloId === tituloId && p.parcelaId === parcelaId)));
}

/** Usa o estado completo e atual para impedir escolhas simultâneas em duas linhas. */
export function selectSuggestionInRows(rows: NormalizedCsvRow[], rowId: string, suggestion: ValueSuggestion, company: number, bankId: string): NormalizedCsvRow[] {
  if (selectionOwner(rows, rowId, suggestion.titulo.id, suggestion.parcela.id)) return rows;
  return rows.map((row) => row.rowId === rowId ? selectValueSuggestion(row, suggestion, company, bankId) : row);
}

export function clearValueSelection(row: NormalizedCsvRow): NormalizedCsvRow {
  if (row.baixaIniciada || !["pronto", "revisar", "sugestao", "conflito"].includes(row.status)) return row;
  return {
    ...row,
    status: row.sugestoesValor?.length ? "sugestao" : "aguardando",
    statusMensagem: row.sugestoesValor?.length ? "Seleção removida. Escolha uma parcela para continuar." : "Seleção removida. Concilie novamente para continuar.",
    parcelasSelecionadas: undefined,
    tituloId: undefined, parcelaId: undefined, tituloM8: undefined, parcelaM8: undefined,
    fornecedorNome: undefined, parcelaValor: undefined, parcelaSaldo: undefined,
    valorJuros: 0, valorDesconto: 0, jurosConfirmados: undefined, descontoConfirmado: undefined,
    correspondenciaData: undefined, revisaoData: undefined, baixaM8: undefined, apiError: undefined,
  };
}

export function selectValueSuggestion(row: NormalizedCsvRow, suggestion: ValueSuggestion, company: number, bankId: string): NormalizedCsvRow {
  if (row.baixaIniciada || !["sugestao", "conflito", "pronto"].includes(row.status) || !row.sugestoesValor?.includes(suggestion) || row.valor == null) return row;
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


/** A seleção com várias parcelas só fica pronta quando fecha o valor em centavos. */
export function toggleSuggestionInRows(rows: NormalizedCsvRow[], rowId: string, suggestion: ValueSuggestion, company: number, bankId: string): NormalizedCsvRow[] {
  const row = rows.find(r => r.rowId === rowId);
  if (!row || row.baixaIniciada || !["sugestao", "conflito", "pronto"].includes(row.status) ||
      !row.sugestoesValor?.includes(suggestion) || row.valor == null) return rows;
  const key = (s: ValueSuggestion) => `${s.titulo.id}:${s.parcela.id}`;
  const selectedKeys = new Set(row.parcelasSelecionadas?.map(p => `${p.tituloId}:${p.parcelaId}`) ??
    (row.parcelaId ? [`${row.tituloId}:${row.parcelaId}`] : []));
  if (selectedKeys.has(key(suggestion))) selectedKeys.delete(key(suggestion));
  else {
    if (selectionOwner(rows, rowId, suggestion.titulo.id, suggestion.parcela.id)) return rows;
    selectedKeys.add(key(suggestion));
  }
  const selected = row.sugestoesValor.filter(s => selectedKeys.has(key(s)));
  const cleared = clearValueSelection(row);
  let next = cleared;
  if (selected.length === 1) {
    next = selectValueSuggestion(cleared, selected[0], company, bankId);
    next.parcelasSelecionadas = [{ ...next, parcelasSelecionadas: undefined, sugestoesValor: undefined }];
  } else if (selected.length > 1) {
    const children = selected.map(s => {
      const child = selectValueSuggestion({ ...cleared, valor: s.principal }, s, company, bankId);
      return { ...child, rowId: `${row.rowId}::${s.titulo.id}:${s.parcela.id}`, sugestoesValor: undefined, parcelasSelecionadas: undefined };
    });
    const total = children.reduce((sum, p) => sum + Math.round(p.valor! * 100), 0);
    const matches = total === Math.round(row.valor * 100);
    next = { ...cleared, parcelasSelecionadas: children, status: matches ? "pronto" : "sugestao",
      valorJuros: 0, valorDesconto: 0, jurosConfirmados: 0, descontoConfirmado: 0,
      statusMensagem: matches ? `${children.length} parcelas selecionadas. Soma igual ao extrato; prontas para baixa.` :
        `${children.length} parcelas selecionadas. A soma deve ser igual ao extrato para liberar a baixa.` };
  }
  return rows.map(r => r.rowId === rowId ? next : r);
}
