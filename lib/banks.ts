import defaultBanks from "../data/bancos.json";
import { BankConfig, BankM8Config } from "./types";

export const BANK_M8_STORAGE_KEY = "conciliacao-m8-config-m8-v2";

/** O navegador pode sobrescrever somente os campos M8, nunca os layouts. */
export function loadBanks(saved?: string | null): BankConfig[] {
  let overrides: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(saved || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      overrides = parsed;
    }
  } catch {}

  return defaultBanks.map((bank) => {
    const m8: BankM8Config = { ...bank.m8 };
    const override = overrides[bank.id];
    if (override && typeof override === "object" && !Array.isArray(override)) {
      const values = { ...override } as Record<string, unknown>;
      // Corrige os padrões antigos sem substituir contas escolhidas pelo usuário.
      if (typeof values.contaContabilCodigo !== "string") {
        const legacyViacredi = bank.id === "viacredi" && values.contaContabilId === 100038;
        const legacySicredi = bank.id === "sicredi" && values.contaContabilId === 0;
        if (legacyViacredi || legacySicredi) {
          values.contaContabilId = bank.m8.contaContabilId;
          values.contaContabilCodigo = bank.m8.contaContabilCodigo;
          values.contaContabilNome = bank.m8.contaContabilNome;
        }
        if (bank.id === "sicredi") {
          if (values.historicoId === 0) values.historicoId = bank.m8.historicoId;
          if (values.meioPagamentoId === 0) values.meioPagamentoId = bank.m8.meioPagamentoId;
        }
      }
      for (const key of ["contaContabilId", "historicoId", "meioPagamentoId"] as const) {
        const value = values[key];
        if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
          m8[key] = value;
        }
      }
      if (m8.contaContabilId !== bank.m8.contaContabilId) {
        delete m8.contaContabilNome;
        delete m8.contaContabilCodigo;
      }
      for (const key of ["observacaoInterna", "complemento", "contaContabilCodigo", "contaContabilNome"] as const) {
        if (typeof values[key] === "string") m8[key] = values[key];
      }
    }
    return { ...bank, mapping: { ...bank.mapping }, m8 };
  });
}

export function serializeM8(banks: BankConfig[]): string {
  return JSON.stringify(Object.fromEntries(banks.map((bank) => [bank.id, bank.m8])));
}
