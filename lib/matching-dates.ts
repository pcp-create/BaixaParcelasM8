import calendars from "../data/calendarios.json";
import banks from "../data/bancos.json";
import { NormalizedCsvRow } from "./types";

export type DateMatch = NonNullable<NormalizedCsvRow["correspondenciaData"]>;
export type Calendar = { recurring: string[]; dates: string[] };
const DAY = 86400000;

/** Datas civis em UTC, sem deslocamentos por horário de verão ou fuso. */
export function civilDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
  const parts = br ? [Number(br[3]), Number(br[2]), Number(br[1])] : iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function calendarForCompany(company: number): Calendar {
  const entry = (calendars.empresas as Record<string, { feriadosRecorrentes: string[]; feriadosPorData: string[] }>)[String(company)];
  return {
    recurring: [...calendars.nacionaisRecorrentes, ...(entry?.feriadosRecorrentes ?? [])],
    dates: [...calendars.nacionaisPorData, ...calendars.estaduaisPorData, ...(entry?.feriadosPorData ?? [])],
  };
}

export function toleranceForBank(bankId: unknown): number {
  return banks.find((bank) => bank.id === bankId)?.toleranciaDiasConciliacao ?? 0;
}

function nonBusinessDay(date: string, calendar: Calendar): boolean {
  const weekday = new Date(date + "T00:00:00Z").getUTCDay();
  return weekday === 0 || weekday === 6 || calendar.recurring.includes(date.slice(5)) || calendar.dates.includes(date);
}

export function matchDates(due: unknown, paid: unknown, calendar: Calendar, tolerance: number): DateMatch | null {
  const vencimento = civilDate(due);
  const pagamento = civilDate(paid);
  if (!vencimento || !pagamento) return null;
  const dias = (Date.parse(pagamento) - Date.parse(vencimento)) / DAY;
  if (dias < 0) return null;
  const base = { vencimento, pagamento, dias };
  if (dias === 0) return { ...base, tipo: "exata", motivo: "Pagamento na data do vencimento." };
  if (nonBusinessDay(vencimento, calendar)) {
    let next = vencimento;
    // Limite defensivo para um calendário incorreto com todos os dias bloqueados.
    for (let i = 0; i < 366; i++) {
      next = new Date(Date.parse(next) + DAY).toISOString().slice(0, 10);
      if (!nonBusinessDay(next, calendar)) {
        if (next === pagamento) return { ...base, tipo: "dia_util", motivo: `Vencimento ${vencimento} em fim de semana/feriado; ajustado para o próximo dia útil ${pagamento}.` };
        break;
      }
    }
  }
  if (dias <= tolerance) return { ...base, tipo: "proximidade", motivo: `Pagamento ${dias} dia(s) após o vencimento ${vencimento}. Possível correspondência — revisar.` };
  return null;
}

/** A aprovação é vinculada à parcela, empresa, banco, valor e datas revisados. */
export function validDateReview(row: NormalizedCsvRow, company: number, bankId: string): boolean {
  const review = row.revisaoData;
  return Boolean(review && review.aprovadaEm && review.company === company && review.bankId === bankId &&
    review.tituloId === row.tituloId && review.parcelaId === row.parcelaId && review.valor === row.valor &&
    review.pagamento === civilDate(row.dataPagamento) && review.vencimento === civilDate(row.parcelaM8?.vencimento));
}
