import { NormalizedCsvRow } from "./types";

/** Expande uma linha em baixas individuais sem aceitar diferenças ou rateios. */
export function expandPayments(input: NormalizedCsvRow[]): { rows: NormalizedCsvRow[]; parents: Map<string, NormalizedCsvRow> } {
  if (!Array.isArray(input)) throw new Error("Nenhuma parcela foi recebida para baixa.");
  const parents = new Map<string, NormalizedCsvRow>();
  const rows = input.flatMap((parent, index) => {
    if (parent.baixaIniciada) throw new Error(`Linha ${parent.numeroLinha}: baixa já iniciada. Confira o retorno no M8 antes de novo processamento.`);
    const selected = parent.parcelasSelecionadas;
    if (!selected || selected.length <= 1) return [parent];
    if (String(parent.tipo).trim().toUpperCase() !== "D" || parent.status !== "pronto" || typeof parent.valor !== "number" || !Number.isFinite(parent.valor) || parent.valor <= 0 ||
        (parent.valorJuros ?? 0) !== 0 || (parent.valorDesconto ?? 0) !== 0) {
      throw new Error(`Linha ${parent.numeroLinha}: seleção múltipla não está pronta para baixa.`);
    }
    let total = 0;
    const children = selected.map((p, childIndex) => {
      if (p.baixaIniciada || p.status !== "pronto" || p.parcelasSelecionadas?.length ||
          typeof p.valor !== "number" || !Number.isFinite(p.valor) || p.valor <= 0 ||
          Math.round(p.valor * 100) !== Math.round(Number(p.parcelaM8?.valor) * 100) ||
          (p.valorJuros ?? 0) !== 0 || (p.valorDesconto ?? 0) !== 0 ||
          p.dataPagamento !== parent.dataPagamento || p.tipo !== parent.tipo ||
          !Number.isFinite(Number(p.parcelaM8?.saldo)) || Number(p.parcelaM8?.saldo) < p.valor - 0.01) {
        throw new Error(`Linha ${parent.numeroLinha}: parcela da seleção múltipla inválida ou alterada.`);
      }
      total += Math.round(p.valor * 100);
      const rowId = `multi:${index}:${childIndex}:${parent.rowId}`;
      parents.set(rowId, parent);
      return { ...p, rowId, numeroLinha: parent.numeroLinha };
    });
    if (total !== Math.round(parent.valor * 100)) throw new Error(`Linha ${parent.numeroLinha}: soma das parcelas diferente do valor do extrato.`);
    return children;
  });
  return { rows, parents };
}

/** Mantém sucessos e erros separados; uma falha não apaga as baixas concluídas. */
export function mergePaymentResult(parent: NormalizedCsvRow, result: Partial<NormalizedCsvRow>): NormalizedCsvRow {
  const children = parent.parcelasSelecionadas!.map(p => p.tituloId === result.tituloId && p.parcelaId === result.parcelaId
    ? { ...p, ...result, rowId: p.rowId, baixaIniciada: true } : p);
  const done = children.filter(p => p.status === "baixada").length;
  const errors = children.filter(p => p.status === "erro").length;
  const finished = done + errors === children.length;
  return { ...parent, parcelasSelecionadas: children, baixaIniciada: true,
    status: finished ? (errors ? "erro" : "baixada") : "baixando",
    statusMensagem: `${done}/${children.length} parcelas baixadas${errors ? `; ${errors} com erro. Confira os retornos individuais antes de qualquer nova baixa.` : finished ? "." : "; processando..."}`,
    apiError: children.filter(p => p.apiError).map(p => `Parcela ${p.parcelaId}: ${p.apiError}`).join(" | ") || undefined,
  };
}
