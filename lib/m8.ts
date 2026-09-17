import {
  M8ContaPagar,
  M8Parcela,
} from "./types";

/* ============================================================
   CONFIGURAÇÃO BASE
============================================================ */

const baseUrl =
  process.env.M8_BASE_URL ||
  "https://api.integra.m8sistemas.com.br";

/* ============================================================
   VARIÁVEIS DE AMBIENTE
============================================================ */

function requiredEnv(
  name: string
): string {
  const value =
    process.env[name];

  if (!value) {
    throw new Error(
      `Variável de ambiente ${name} não configurada.`
    );
  }

  return value;
}

/* ============================================================
   AGUARDAR ENTRE TENTATIVAS
============================================================ */

function sleep(
  ms: number
): Promise<void> {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

/* ============================================================
   REQUEST GENÉRICO

   - Sem cache
   - Retry para consultas
   - Log de status HTTP
   - Não exibe token
   - Não exibe senha
============================================================ */

async function request<T>(
  url: string,
  init: RequestInit,
  tentativas = 2
): Promise<T> {
  let lastError: unknown;

  for (
    let tentativa = 1;
    tentativa <= tentativas;
    tentativa++
  ) {
    const inicio =
      Date.now();

    try {
      console.log("");
      console.log(
        "=========================================="
      );

      console.log(
        `[M8 REQUEST] ${init.method || "GET"}`
      );

      console.log(
        "[M8 REQUEST] URL:",
        url
      );

      console.log(
        `[M8 REQUEST] Tentativa ${tentativa}/${tentativas}`
      );

      const response =
        await fetch(
          url,
          {
            ...init,
            cache: "no-store",
          }
        );

      const tempo =
        Date.now() -
        inicio;

      const text =
        await response.text();

      let body: any =
        null;

      try {
        body =
          text
            ? JSON.parse(text)
            : null;
      } catch {
        body =
          text;
      }

      console.log(
        `[M8 RESPONSE] HTTP ${response.status}`
      );

      console.log(
        `[M8 RESPONSE] Tempo: ${tempo} ms`
      );

      if (!response.ok) {
        const detail =
          typeof body === "string"
            ? body
            : JSON.stringify(body);

        throw new Error(
          `HTTP ${response.status}: ${detail}`
        );
      }

      console.log(
        "=========================================="
      );

      return body as T;
    } catch (error) {
      lastError =
        error;

      console.error(
        `[M8 REQUEST] Erro na tentativa ${tentativa}:`,
        error instanceof Error
          ? error.message
          : error
      );

      if (
        tentativa <
        tentativas
      ) {
        console.log(
          "[M8 REQUEST] Nova tentativa em 500 ms..."
        );

        await sleep(500);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        "Falha na comunicação com o M8."
      );
}

/* ============================================================
   HEADERS AUTENTICADOS
============================================================ */

function authHeaders(
  token: string
): HeadersInit {
  return {
    Authorization:
      `Bearer ${token}`,

    Accept:
      "application/json",

    "Content-Type":
      "application/json",
  };
}

/* ============================================================
   ETAPA 1
   AUTENTICAÇÃO M8
============================================================ */

export async function autenticarM8(
  company: number
): Promise<string> {
  const payload = {
    tenant:
      requiredEnv(
        "M8_TENANT"
      ),

    username:
      requiredEnv(
        "M8_USERNAME"
      ),

    password:
      requiredEnv(
        "M8_PASSWORD"
      ),

    company,

    domain:
      requiredEnv(
        "M8_DOMAIN"
      ),
  };

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "[M8] ETAPA 1 - AUTENTICAÇÃO"
  );

  console.log(
    "[M8] Base URL:",
    baseUrl
  );

  console.log(
    "[M8] Tenant:",
    payload.tenant
  );

  console.log(
    "[M8] Username:",
    payload.username
  );

  console.log(
    "[M8] Company:",
    payload.company
  );

  console.log(
    "[M8] Domain:",
    payload.domain
  );

  console.log(
    "[M8] Password: ********"
  );

  console.log(
    "=========================================="
  );

  const auth =
    await request<{
      data?: {
        token?: string;
      };

      token?: string;

      errors?: unknown[];
    }>(
      `${baseUrl}/v1/auth/token`,

      {
        method:
          "POST",

        headers: {
          Accept:
            "application/json",

          "Content-Type":
            "application/json",
        },

        body:
          JSON.stringify(
            payload
          ),
      }
    );

  const token =
    auth?.data?.token ||
    auth?.token;

  if (!token) {
    console.error(
      "[M8] Autenticação retornou resposta sem token."
    );

    console.error(
      "[M8] Errors:",
      auth?.errors
    );

    throw new Error(
      "O M8 não retornou token na autenticação."
    );
  }

  console.log(
    "[M8] Autenticação realizada com sucesso."
  );

  return token;
}

/* ============================================================
   ETAPA 2
   LISTAR TODAS AS CONTAS A PAGAR

   GET
   /v1/financeiro/contapagar?PageSize=0&Page=0

   PageSize = 0
   Page     = 0
============================================================ */

export async function listarContasPagar(
  token: string,
  periodo: { inicio: string; fim: string }
): Promise<M8ContaPagar[]> {
  const params = new URLSearchParams({
    VencimentoInicial: `${periodo.inicio}T00:00:00`,
    VencimentoFinal: `${periodo.fim}T23:59:59.999`,
  });
  const url = `${baseUrl}/v1/financeiro/contapagar/consulta?${params.toString()}`;
  console.log("[M8] Consultando títulos por vencimento:", url);
  const response = await request<any>(url, { method: "GET", headers: authHeaders(token) });
  if (!Array.isArray(response?.data) || response?.errors?.length) {
    throw new Error("Consulta de títulos por vencimento retornou dados inválidos ou erros. A conciliação não pode continuar com uma lista incompleta.");
  }
  const titulos = new Map<number, M8ContaPagar>();
  for (const registro of response.data) {
    if (registro.adiantamento === true && Number(registro.tituloId) === 0) continue;
    const tituloId = Number(registro.tituloId ?? registro.id);
    if (!Number.isSafeInteger(tituloId) || tituloId <= 0) {
      throw new Error("Consulta por vencimento retornou registro sem título válido (não é adiantamento).");
    }
    const saldo = Number(registro.saldo ?? 0);
    if (!Number.isFinite(saldo)) throw new Error("Consulta por vencimento retornou saldo inválido.");
    const existente = titulos.get(tituloId);
    if (existente) {
      // Um título pode ter várias parcelas no período. Não perca um título
      // pendente quando a primeira parcela retornada já estiver paga.
      existente.saldo = (existente.saldo ?? 0) + Math.max(0, saldo);
      continue;
    }
    titulos.set(tituloId, {
      ...registro,
      id: tituloId,
      tituloId,
      fornecedorId: registro.fornecedorId ?? registro.pessoaId,
      fornecedorNome: registro.fornecedorNome ?? registro.pessoaNome,
      saldo: Math.max(0, saldo),
    });
  }
  console.log(`[M8] Consulta: ${response.data.length} registro(s), ${titulos.size} título(s) distintos.`);
  return Array.from(titulos.values());
}

export async function listarParcelas(
  token: string,
  tituloId: number
): Promise<M8Parcela[]> {
  if (
    !Number.isFinite(
      Number(
        tituloId
      )
    ) ||
    Number(
      tituloId
    ) <= 0
  ) {
    throw new Error(
      `tituloId inválido: ${tituloId}`
    );
  }

  const url =
    `${baseUrl}/v1/financeiro/contapagar/${tituloId}/parcela`;

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    `[M8] ETAPA 3 - PARCELAS DO TÍTULO ${tituloId}`
  );

  console.log(
    "[M8] URL:",
    url
  );

  console.log(
    "=========================================="
  );

  const inicio =
    Date.now();

  const response =
    await request<any>(
      url,

      {
        method:
          "GET",

        headers:
          authHeaders(
            token
          ),
      }
    );

  const tempo =
    Date.now() -
    inicio;

  console.log(
    `[M8] Tempo consulta parcelas: ${tempo} ms`
  );

  console.log(
    "[M8] response.data é array:",
    Array.isArray(
      response?.data
    )
  );

  const parcelas:
    M8Parcela[] =
    Array.isArray(
      response?.data
    )
      ? response.data
      : [];

  console.log(
    `[M8] Título ${tituloId}: ${parcelas.length} parcela(s) recebida(s).`
  );

  for (
    const parcela
    of parcelas
  ) {
    console.log(
      "[M8 PARCELA]",
      {
        id:
          parcela.id,

        tituloId:
          parcela.tituloId,

        numeroItem:
          parcela.numeroItem,

        vencimento:
          parcela.vencimento,

        valor:
          parcela.valor,

        saldo:
          parcela.saldo,

        pessoaNome:
          parcela.pessoaNome,

        favorecidoNome:
          parcela.favorecidoNome,

        complemento:
          parcela.complemento,

        meioPagamentoId:
          parcela.meioPagamentoId,

        meioPagamentoNome:
          parcela.meioPagamentoNome,
      }
    );
  }

  /* ==========================================================
     TESTE ESPECÍFICO DA ELGI
  ========================================================== */

  if (
    Number(
      tituloId
    ) === 43424
  ) {
    console.log("");
    console.log(
      "=========================================="
    );

    console.log(
      "[M8 TESTE] PROCURANDO PARCELA 60130"
    );

    const parcela60130 =
      parcelas.find(
        (parcela: any) =>
          String(
            parcela?.id ??
            ""
          ).trim() ===
          "60130"
      );

    if (parcela60130) {
      console.log(
        "[M8 TESTE] PARCELA 60130: ENCONTRADA"
      );

      console.log(
        JSON.stringify(
          parcela60130,
          null,
          2
        )
      );
    } else {
      console.log(
        "[M8 TESTE] PARCELA 60130: NÃO ENCONTRADA"
      );
    }

    console.log(
      "=========================================="
    );
  }

  return parcelas;
}

/* ============================================================
   PAYLOAD DA BAIXA
============================================================ */

export interface BaixaPayload {
  data:
    string;

  contaContabilId:
    number;

  historicoId:
    number;

  meioPagamentoId:
    number;

  valor:
    number;

  /*
   * OPCIONAL.
   *
   * Não devemos enviar chequeId = 0 quando a baixa
   * não estiver relacionada a um cheque.
   *
   * O M8 interpreta um número informado como uma referência
   * para financeiro_cheques.id.
   *
   * Portanto:
   *
   * - baixa sem cheque  -> propriedade não enviada
   * - baixa com cheque  -> enviar o ID real do cheque
   */
  chequeId?:
    number;

  valorJuros:
    number;

  valorMulta:
    number;

  valorDesconto:
    number;

  taxaOperadoraCartao:
    number;

  observacaoInterna:
    string;

  complemento:
    string;
}

/* ============================================================
   ETAPA 4
   EFETUAR BAIXA

   POST
   /v1/financeiro/contapagar/{tituloId}/baixa/parcela/{parcelaId}
============================================================ */

export async function baixarParcela(
  token: string,
  tituloId: number,
  parcelaId: number,
  payload: BaixaPayload
) {
  if (
    !Number.isFinite(
      Number(
        tituloId
      )
    ) ||
    Number(
      tituloId
    ) <= 0
  ) {
    throw new Error(
      `tituloId inválido para baixa: ${tituloId}`
    );
  }

  if (
    !Number.isFinite(
      Number(
        parcelaId
      )
    ) ||
    Number(
      parcelaId
    ) <= 0
  ) {
    throw new Error(
      `parcelaId inválido para baixa: ${parcelaId}`
    );
  }

  const url =
    `${baseUrl}/v1/financeiro/contapagar/${tituloId}/baixa/parcela/${parcelaId}`;

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "[M8] ETAPA 4 - EFETUAR BAIXA"
  );

  console.log(
    "[M8] Título:",
    tituloId
  );

  console.log(
    "[M8] Parcela:",
    parcelaId
  );

  console.log(
    "[M8] Data:",
    payload.data
  );

  console.log(
    "[M8] Valor:",
    payload.valor
  );

  console.log(
    "[M8] Conta contábil:",
    payload.contaContabilId
  );

  console.log(
    "[M8] Histórico:",
    payload.historicoId
  );

  console.log(
    "[M8] Meio de pagamento:",
    payload.meioPagamentoId
  );

  /*
   * Apenas para diagnóstico.
   * Não exibimos cheque quando ele não foi informado.
   */
  if (
    payload.chequeId !==
    undefined
  ) {
    console.log(
      "[M8] Cheque:",
      payload.chequeId
    );
  }

  console.log(
    "[M8] Observação interna:",
    payload.observacaoInterna
  );

  console.log(
    "[M8] Complemento:",
    payload.complemento
  );

  console.log(
    "=========================================="
  );

  const inicio =
    Date.now();

  /*
   * Sem retry automático na baixa.
   * Evita risco de processar a mesma baixa duas vezes.
   */
  const response =
    await request<any>(
      url,

      {
        method:
          "POST",

        headers:
          authHeaders(
            token
          ),

        body:
          JSON.stringify(
            payload
          ),
      },

      1
    );

  const tempo =
    Date.now() -
    inicio;

  console.log("");
  console.log(
    "[M8] Baixa finalizada."
  );

  console.log(
    "[M8] Tempo:",
    `${tempo} ms`
  );

  console.log(
    "[M8] Resposta:",
    JSON.stringify(
      response,
      null,
      2
    )
  );

  return response;
}
