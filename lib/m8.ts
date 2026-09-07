import { M8ContaPagar, M8Parcela } from "./types";

const baseUrl = process.env.M8_BASE_URL || "https://api.integra.m8sistemas.com.br";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ${name} não configurada.`);
  return value;
}

async function request<T>(url: string, init: RequestInit, tentativas = 2): Promise<T> {
  let lastError: unknown;
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      const response = await fetch(url, { ...init, cache: "no-store" });
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (!response.ok) {
        const detail = typeof body === "string" ? body : JSON.stringify(body);
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      return body as T;
    } catch (error) {
      lastError = error;
      if (tentativa < tentativas) await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Falha na comunicação com o M8.");
}

export async function autenticarM8(company: number): Promise<string> {
  const payload = {
    tenant: requiredEnv("M8_TENANT"),
    username: requiredEnv("M8_USERNAME"),
    password: requiredEnv("M8_PASSWORD"),
    company,
    domain: requiredEnv("M8_DOMAIN")
  };
  const auth = await request<{ data?: { token?: string }; token?: string }>(
    `${baseUrl}/v1/auth/token`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  );
  const token = auth?.data?.token || auth?.token;
  if (!token) throw new Error("O M8 não retornou data.token na autenticação.");
  return token;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" };
}

export async function listarContasPagar(token: string): Promise<M8ContaPagar[]> {
  const response = await request<{ data?: M8ContaPagar[]; errors?: unknown[] }>(
    `${baseUrl}/v1/financeiro/contapagar`,
    { method: "GET", headers: authHeaders(token) }
  );
  return Array.isArray(response?.data) ? response.data : [];
}

export async function listarParcelas(token: string, tituloId: number): Promise<M8Parcela[]> {
  const response = await request<{ data?: M8Parcela[]; errors?: unknown[] }>(
    `${baseUrl}/v1/financeiro/contapagar/${tituloId}/parcela`,
    { method: "GET", headers: authHeaders(token) }
  );
  return Array.isArray(response?.data) ? response.data : [];
}

export interface BaixaPayload {
  data: string;
  contaContabilId: number;
  historicoId: number;
  meioPagamentoId: number;
  valor: number;
  chequeId: number;
  valorJuros: number;
  valorMulta: number;
  valorDesconto: number;
  taxaOperadoraCartao: number;
  observacaoInterna: string;
  complemento: string;
}

export async function baixarParcela(
  token: string,
  tituloId: number,
  parcelaId: number,
  payload: BaixaPayload
) {
  return request<any>(
    `${baseUrl}/v1/financeiro/contapagar/${tituloId}/baixa/parcela/${parcelaId}`,
    { method: "POST", headers: authHeaders(token), body: JSON.stringify(payload) },
    1
  );
}
