import {
  M8ContaPagar,
  M8Parcela,
} from "./types";

/* ============================================================
   CONFIGURAÇÕES
============================================================ */

const baseUrl =
  process.env.M8_BASE_URL ||
  "https://api.integra.m8sistemas.com.br";

/* ============================================================
   VARIÁVEL DE AMBIENTE OBRIGATÓRIA
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
   PAUSA ENTRE TENTATIVAS
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
   REQUEST GENÉRICO M8

   - Sem cache
   - Retry
   - Captura status HTTP
   - Captura corpo de erro
   - Não imprime token
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
        `[M8 REQUEST] ${init.method || "GET"} ${url}`
      );

      console.log(
        `[M8 REQUEST] Tentativa ${tentativa}/${tentativas}`
      );

      const response =
        await fetch(
          url,
          {
            ...init,

            cache:
              "no-store",
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
        `[M8 RESPONSE] HTTP ${response.status} - ${tempo} ms`
      );

      /* ======================================================
         ERRO HTTP
      ====================================================== */

      if (!response.ok) {
        const detail =
          typeof body === "string"
            ? body
            : JSON.stringify(body);

        throw new Error(
          `HTTP ${response.status}: ${detail}`
        );
      }

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
   AUTENTICAR NO M8
============================================================ */

export async function autenticarM8(
  company: number
): Promise<string> {
  console.log("");
  console.log(
    "=========================================="
  );

  console.log(
    "[M8] ETAPA 1 - AUTENTICAÇÃO"
  );

  console.log(
    "[M8] Empresa:",
    company
  );

  console.log(
    "[M8] Base URL:",
    baseUrl
  );

  console.log(
    "=========================================="
  );

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

  /*
   * NÃO fazer console.log(payload)
   * porque contém a senha.
   */

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
      "[M8] Resposta da autenticação sem token:",
      {
        possuiData:
          Boolean(auth?.data),

        errors:
          auth?.errors,
      }
    );

    throw new Error(
      "O M8 não retornou data.token na autenticação."
    );
  }

  console.log(
    "[M8] Autenticação realizada com sucesso."
  );

  /*
   * NÃO imprimir o token.
   */

  return token;
}

/* ============================================================
   ETAPA 2
   LISTAR CONTAS A PAGAR

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
    "[M8] ETAPA 2 - LISTAR CONTAS A PAGAR"
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
    await request<{
      data?:
        M8ContaPagar[];

      errors?:
        unknown[];
    }>(
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

  /* ==========================================================
     VALIDAR RESPONSE.DATA
  ========================================================== */

  if (
    !Array.isArray(
      response?.data
    )
  ) {
    console.error(
      "[M8] O endpoint de Contas a Pagar não retornou data como array."
    );

    console.error(
      "[M8] Estrutura recebida:",
      {
        possuiData:
          response?.data !==
          undefined,

        tipoData:
          typeof response?.data,

        errors:
          response?.errors,
      }
    );

    return [];
  }

  const titulos =
    response.data;

  console.log("");
  console.log(
    "[M8] ETAPA 2 FINALIZADA"
  );

  console.log(
    "[M8] Quantidade de títulos recebidos:",
    titulos.length
  );

  console.log(
    "[M8] Tempo total:",
    `${tempo} ms`
  );

  if (
    response?.errors &&
    Array.isArray(
      response.errors
    ) &&
    response.errors.length >
      0
  ) {
    console.warn(
      "[M8] Errors retornados pelo endpoint:",
      response.errors
    );
  }

  /* ==========================================================
     DIAGNÓSTICO ESPECÍFICO

     TÍTULO:
     43424

     Fornecedor:
     ELGI
  ========================================================== */

  const titulo43424 =
    titulos.find(
      (titulo) =>
        Number(
          titulo.id
        ) === 43424
    );

  console.log("");
  console.log(
    "========== TESTE TÍTULO 43424 =========="
  );

  if (titulo43424) {
    console.log(
      "Título 43424: ENCONTRADO"
    );

    console.log(
      "ID:",
      titulo43424.id
    );

    console.log(
      "Empresa:",
      titulo43424.empresaId
    );

    console.log(
      "Fornecedor ID:",
      titulo43424.fornecedorId
    );

    console.log(
      "Fornecedor:",
      titulo43424.fornecedorNome
    );

    console.log(
      "Documento:",
      titulo43424.documento
    );

    console.log(
      "Valor:",
      titulo43424.valor
    );

    console.log(
      "Saldo:",
      titulo43424.saldo
    );
  } else {
    console.log(
      "Título 43424: NÃO ENCONTRADO"
    );

    console.log(
      "ATENÇÃO: o título não veio dentro de response.data."
    );
  }

  console.log(
    "========================================="
  );

  /* ==========================================================
     DIAGNÓSTICO PELO VALOR DA ELGI

     10739
  ========================================================== */

  const titulosValor10739 =
    titulos.filter(
      (titulo) => {
        const valor =
          Number(
            titulo.valor
          );

        return (
          Number.isFinite(
            valor
          ) &&
          Math.abs(
            valor -
              10739
          ) <= 0.01
        );
      }
    );

  console.log("");
  console.log(
    "[M8] Títulos com valor 10739:",
    titulosValor10739.length
  );

  if (
    titulosValor10739.length >
    0
  ) {
    console.log(
      "[M8] Títulos encontrados pelo valor:"
    );

    for (
      const titulo
      of titulosValor10739
    ) {
      console.log({
        id:
          titulo.id,

        fornecedorId:
          titulo.fornecedorId,

        fornecedorNome:
          titulo.fornecedorNome,

        documento:
          titulo.documento,

        valor:
          titulo.valor,

        saldo:
          titulo.saldo,
      });
    }
  }

  /* ==========================================================
     MOSTRAR PRIMEIRO E ÚLTIMO ID

     Ajuda a identificar se a API pode estar
     retornando uma faixa limitada.
  ========================================================== */

  if (
    titulos.length >
    0
  ) {
    console.log("");
    console.log(
      "[M8] Primeiro título recebido:",
      {
        id:
          titulos[0]?.id,

        fornecedor:
          titulos[0]
            ?.fornecedorNome,

        valor:
          titulos[0]
            ?.valor,
      }
    );

    console.log(
      "[M8] Último título recebido:",
      {
        id:
          titulos[
            titulos.length -
              1
          ]?.id,

        fornecedor:
          titulos[
            titulos.length -
              1
          ]?.fornecedorNome,

        valor:
          titulos[
            titulos.length -
              1
          ]?.valor,
      }
    );
  }

  console.log("");
  console.log(
    "[M8] Retornando títulos para a conciliação:",
    titulos.length
  );

  return titulos;
}

/* ============================================================
   ETAPA 3
   LISTAR PARCELAS DE UM TÍTULO

   GET
   /v1/financeiro/contapagar/{tituloId}/parcela
============================================================ */

export async function listarParcelas(
  token: string,
  tituloId: number
): Promise<M8Parcela[]> {
  if (
    !Number.isFinite(
      Number(tituloId)
    ) ||
    Number(tituloId) <= 0
  ) {
    throw new Error(
      `tituloId inválido: ${tituloId}`
    );
  }

  const url =
    `${baseUrl}/v1/financeiro/contapagar/${tituloId}/parcela`;

  console.log("");
  console.log(
    "------------------------------------------"
  );

  console.log(
    `[M8] ETAPA 3 - PARCELAS DO TÍTULO ${tituloId}`
  );

  console.log(
    "[M8] URL:",
    url
  );

  const inicio =
    Date.now();

  const response =
    await request<{
      data?:
        M8Parcela[];

      errors?:
        unknown[];
    }>(
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

  /* ==========================================================
     VALIDAR DATA
  ========================================================== */

  if (
    !Array.isArray(
      response?.data
    )
  ) {
    console.error(
      `[M8] Título ${tituloId}: response.data não é array.`
    );

    console.error(
      {
        errors:
          response?.errors,
      }
    );

    return [];
  }

  const parcelas =
    response.data;

  console.log(
    `[M8] Título ${tituloId}: ${parcelas.length} parcela(s) recebida(s).`
  );

  console.log(
    `[M8] Tempo: ${tempo} ms`
  );

  /* ==========================================================
     MOSTRAR PARCELAS RECEBIDAS
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
     DIAGNÓSTICO ESPECÍFICO DA ELGI

     tituloId 43424
     parcelaId 60130
  ========================================================== */

  if (
    Number(tituloId) ===
    43424
  ) {
    const parcela60130 =
      parcelas.find(
        (parcela) =>
          Number(
            parcela.id
          ) === 60130
      );

    console.log("");
    console.log(
      "========== TESTE PARCELA 60130 =========="
    );

    if (parcela60130) {
      console.log(
        "Parcela 60130: ENCONTRADA"
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
        "Parcela 60130: NÃO ENCONTRADA"
      );
    }

    console.log(
      "=========================================="
    );
  }

  console.log(
    "------------------------------------------"
  );

  return parcelas;
}

/* ============================================================
   PAYLOAD DA ETAPA 4
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
   BAIXAR PARCELA

   POST

   /v1/financeiro/contapagar/
   {tituloId}/baixa/parcela/{parcelaId}
============================================================ */

export async function baixarParcela(
  token: string,
  tituloId: number,
  parcelaId: number,
  payload: BaixaPayload
) {
  if (
    !Number.isFinite(
      Number(tituloId)
    ) ||
    Number(tituloId) <= 0
  ) {
    throw new Error(
      `tituloId inválido para baixa: ${tituloId}`
    );
  }

  if (
    !Number.isFinite(
      Number(parcelaId)
    ) ||
    Number(parcelaId) <= 0
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
    "[M8] ETAPA 4 - BAIXAR PARCELA"
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
    "[M8] Conta Contábil:",
    payload.contaContabilId
  );

  console.log(
    "[M8] Histórico:",
    payload.historicoId
  );

  console.log(
    "[M8] Meio Pagamento:",
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
   * Para baixa utilizamos somente
   * uma tentativa.
   *
   * Não fazemos retry automático
   * porque uma requisição financeira
   * pode ter sido processada pelo M8
   * mesmo se a resposta ao cliente
   * tiver falhado.
   *
   * Isso evita risco de baixa duplicada.
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

  console.log(
    "[M8] Baixa concluída."
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