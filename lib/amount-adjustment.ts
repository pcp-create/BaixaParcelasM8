import { NormalizedCsvRow } from "./types";

export function parseAdjustment(text: string): number | null {
  const clean = text.trim();
  if (!clean) return 0;
  if (!/^\d+(?:[.,]\d{0,2})?$/.test(clean)) return null;
  const value = Number(clean.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function amountForMatching(row: Pick<NormalizedCsvRow, "valor" | "valorJuros">): number | null {
  const difference = row.valorJuros === undefined ? 0 : row.valorJuros;
  if (typeof row.valor !== "number" || !Number.isFinite(row.valor) ||
      typeof difference !== "number" || !Number.isFinite(difference) || difference < 0 || Math.abs(difference * 100 - Math.round(difference * 100)) > 0.000001) return null;
  const cents = Math.round(row.valor * 100) - Math.round(difference * 100);
  return cents > 0 ? cents / 100 : null;
}

export function applyAdjustment(row: NormalizedCsvRow, difference: number | null): NormalizedCsvRow {
  if (row.jurosConfirmados !== undefined) return row;
  return {
    ...row, valorJuros: difference, status: "aguardando",
    statusMensagem: "Juros alterados. Concilie para validar o valor principal.",
    tituloId: undefined, parcelaId: undefined, tituloM8: undefined, parcelaM8: undefined,
    parcelaValor: undefined, parcelaSaldo: undefined, fornecedorNome: undefined,
    correspondenciaData: undefined, revisaoData: undefined, baixaM8: undefined, apiError: undefined,
  };
}
