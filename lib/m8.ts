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
   /v1/financeiro/contapagar
============================================================ */

export async function listarContasPagar(
  token: string
): Promise<M8ContaPagar[]> {
  const url =
    `${baseUrl}/v1/financeiro/contapagar`;

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "[M8] ETAPA 2 - CONTAS A PAGAR"
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

  console.log("");
  console.log(
    "[M8] Resposta recebida."
  );

  console.log(
    "[M8] Tempo total:",
    `${tempo} ms`
  );

  /* ==========================================================
     DIAGNÓSTICO DA ESTRUTURA
  ========================================================== */

  console.log(
    "[M8] Tipo da resposta:",
    typeof response
  );

  console.log(
    "[M8] Chaves da resposta:",
    response &&
    typeof response === "object"
      ? Object.keys(response)
      : []
  );

  console.log(
    "[M8] response.data é array:",
    Array.isArray(
      response?.data
    )
  );

  /* ==========================================================
     EXTRAIR DATA
  ========================================================== */

  const titulos:
    M8ContaPagar[] =
    Array.isArray(
      response?.data
    )
      ? response.data
      : [];

  console.log("");
  console.log(
    "[M8] TOTAL DE TÍTULOS RECEBIDOS:",
    titulos.length
  );

  /* ==========================================================
     ERRORS
  ========================================================== */

  if (
    Array.isArray(
      response?.errors
    ) &&
    response.errors.length >
      0
  ) {
    console.warn(
      "[M8] Errors retornados:",
      response.errors
    );
  }

  /* ==========================================================
     DIAGNÓSTICO 1
     PROCURAR TÍTULO 43424
  ========================================================== */

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "[M8 TESTE] PROCURANDO TÍTULO 43424"
  );

  const titulo43424 =
    titulos.find(
      (titulo: any) =>
        String(
          titulo?.id ?? ""
        ).trim() ===
        "43424"
    );

  if (titulo43424) {
    console.log(
      "[M8 TESTE] TÍTULO 43424: ENCONTRADO"
    );

    console.log(
      JSON.stringify(
        titulo43424,
        null,
        2
      )
    );
  } else {
    console.log(
      "[M8 TESTE] TÍTULO 43424: NÃO ENCONTRADO"
    );
  }

  console.log(
    "=========================================="
  );

  /* ==========================================================
     DIAGNÓSTICO 2
     PROCURAR QUALQUER REGISTRO CONTENDO ELGI
  ========================================================== */

  const titulosElgi =
    titulos.filter(
      (titulo: any) => {
        try {
          return JSON.stringify(
            titulo
          )
            .toUpperCase()
            .includes(
              "ELGI"
            );
        } catch {
          return false;
        }
      }
    );

  console.log("");
  console.log(
    "[M8 TESTE] REGISTROS CONTENDO 'ELGI':",
    titulosElgi.length
  );

  if (
    titulosElgi.length >
    0
  ) {
    for (
      const titulo
      of titulosElgi
    ) {
      console.log(
        "[M8 ELGI]",
        JSON.stringify(
          titulo,
          null,
          2
        )
      );
    }
  }

  /* ==========================================================
     DIAGNÓSTICO 3
     PROCURAR VALOR 10739
  ========================================================== */

  const titulosValor10739 =
    titulos.filter(
      (titulo: any) => {
        const valor =
          Number(
            titulo?.valor
          );

        const saldo =
          Number(
            titulo?.saldo
          );

        const valorOk =
          Number.isFinite(
            valor
          ) &&
          Math.abs(
            valor -
              10739
          ) <= 0.01;

        const saldoOk =
          Number.isFinite(
            saldo
          ) &&
          Math.abs(
            saldo -
              10739
          ) <= 0.01;

        return (
          valorOk ||
          saldoOk
        );
      }
    );

  console.log("");
  console.log(
    "[M8 TESTE] REGISTROS COM VALOR OU SALDO 10739:",
    titulosValor10739.length
  );

  if (
    titulosValor10739.length >
    0
  ) {
    for (
      const titulo
      of titulosValor10739
    ) {
      console.log(
        "[M8 VALOR 10739]",
        JSON.stringify(
          titulo,
          null,
          2
        )
      );
    }
  }

  /* ==========================================================
     DIAGNÓSTICO 4
     PRIMEIROS 5 REGISTROS
  ========================================================== */

  console.log("");
  console.log(
    "[M8 TESTE] PRIMEIROS 5 TÍTULOS:"
  );

  titulos
    .slice(
      0,
      5
    )
    .forEach(
      (
        titulo: any,
        index: number
      ) => {
        console.log(
          `[M8 ${index + 1}]`,
          {
            id:
              titulo?.id,

            fornecedorId:
              titulo?.fornecedorId,

            fornecedorNome:
              titulo?.fornecedorNome,

            documento:
              titulo?.documento,

            valor:
              titulo?.valor,

            saldo:
              titulo?.saldo,
          }
        );
      }
    );

  /* ==========================================================
     DIAGNÓSTICO 5
     ÚLTIMOS 5 REGISTROS
  ========================================================== */

  console.log("");
  console.log(
    "[M8 TESTE] ÚLTIMOS 5 TÍTULOS:"
  );

  titulos
    .slice(
      -5
    )
    .forEach(
      (
        titulo: any,
        index: number
      ) => {
        console.log(
          `[M8 FIM ${index + 1}]`,
          {
            id:
              titulo?.id,

            fornecedorId:
              titulo?.fornecedorId,

            fornecedorNome:
              titulo?.fornecedorNome,

            documento:
              titulo?.documento,

            valor:
              titulo?.valor,

            saldo:
              titulo?.saldo,
          }
        );
      }
    );

  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "[M8] ETAPA 2 FINALIZADA"
  );

  console.log(
    "[M8] Retornando para conciliação:",
    titulos.length,
    "título(s)"
  );

  console.log(
    "=========================================="
  );

  return titulos;
}

/* ============================================================
   ETAPA 3
   LISTAR PARCELAS DO TÍTULO

   GET
   /v1/financeiro/contapagar/{tituloId}/parcela
============================================================ */

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

  /* ==========================================================
     MOSTRAR PARCELAS
  ========================================================== */

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

        meioPagamentoId:
          parcela.meioPagamentoId,

        meioPagamentoNome:
          parcela.meioPagamentoNome,
      }
    );
  }

  /* ==========================================================
     TESTE ESPECÍFICO
     PARCELA 60130
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

  chequeId:
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

  console.log(
    "=========================================="
  );

  const inicio =
    Date.now();

  /*
   * IMPORTANTE:
   *
   * Não usamos retry automático na baixa.
   *
   * Se o M8 processar a baixa e ocorrer
   * falha apenas na resposta HTTP,
   * um retry poderia gerar risco de
   * processamento duplicado.
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