import {
  autenticarM8,
} from "@/lib/m8";

/* ============================================================
   CONFIGURAÇÃO
============================================================ */

const BASE_URL =
  process.env.M8_BASE_URL ||
  "https://api.integra.m8sistemas.com.br";

/* ============================================================
   TIPOS
============================================================ */

interface PlanoContaM8 {
  id?: number | string;
  codigo?: string | number;
  nome?: string;

  [key: string]:
    any;
}

interface ContaContabilOption {
  id: number;
  codigo: string;
  nome: string;
}

/* ============================================================
   NORMALIZAR RETORNO DO M8

   O endpoint normalmente retorna os registros em "data".
   Mantemos algumas alternativas para deixar a leitura mais
   tolerante caso o envelope da API seja alterado.
============================================================ */

function extrairLista(
  body: any
): PlanoContaM8[] {
  if (
    Array.isArray(body)
  ) {
    return body;
  }

  if (
    Array.isArray(
      body?.data
    )
  ) {
    return body.data;
  }

  if (
    Array.isArray(
      body?.items
    )
  ) {
    return body.items;
  }

  if (
    Array.isArray(
      body?.content
    )
  ) {
    return body.content;
  }

  return [];
}

/* ============================================================
   GET
   /api/m8/planocontas?company=1
============================================================ */

export async function GET(
  request: Request
) {
  try {
    const url =
      new URL(
        request.url
      );

    const company =
      Number(
        url.searchParams.get(
          "company"
        )
      );

    if (
      !Number.isFinite(
        company
      ) ||
      company <= 0
    ) {
      return Response.json(
        {
          error:
            "Empresa M8 inválida.",
        },
        {
          status: 400,
        }
      );
    }

    /* ========================================================
       AUTENTICAR NO M8
    ======================================================== */

    const token =
      await autenticarM8(
        company
      );

    /* ========================================================
       CONSULTAR PLANO DE CONTAS
    ======================================================== */

    const endpoint =
      `${BASE_URL}/v1/contabil/planoconta?PageSize=0&page=0`;

    const response =
      await fetch(
        endpoint,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${token}`,

            Accept:
              "application/json",

            "Content-Type":
              "application/json",
          },

          cache:
            "no-store",
        }
      );

    const text =
      await response.text();

    let body:
      any = null;

    try {
      body =
        text
          ? JSON.parse(
              text
            )
          : null;
    } catch {
      body =
        text;
    }

    if (
      !response.ok
    ) {
      const detail =
        typeof body ===
        "string"
          ? body
          : JSON.stringify(
              body
            );

      throw new Error(
        `HTTP ${response.status}: ${detail}`
      );
    }

    /* ========================================================
       SIMPLIFICAR RETORNO

       O front-end precisa somente:
       - id
       - codigo
       - nome
    ======================================================== */

    const lista =
      extrairLista(
        body
      );

    const contas:
      ContaContabilOption[] =
      lista
        .map(
          (
            item
          ) => {
            const id =
              Number(
                item?.id
              );

            const codigo =
              String(
                item?.codigo ??
                ""
              ).trim();

            const nome =
              String(
                item?.nome ??
                ""
              ).trim();

            return {
              id,
              codigo,
              nome,
            };
          }
        )
        .filter(
          (item) =>
            Number.isFinite(
              item.id
            ) &&
            item.id > 0
        )
        .sort(
          (
            a,
            b
          ) => {
            const codigoA =
              a.codigo ||
              "";

            const codigoB =
              b.codigo ||
              "";

            const porCodigo =
              codigoA.localeCompare(
                codigoB,
                "pt-BR",
                {
                  numeric:
                    true,

                  sensitivity:
                    "base",
                }
              );

            if (
              porCodigo !==
              0
            ) {
              return porCodigo;
            }

            return a.nome.localeCompare(
              b.nome,
              "pt-BR",
              {
                sensitivity:
                  "base",
              }
            );
          }
        );

    console.log(
      `[M8] Plano de contas: ${contas.length} conta(s) carregada(s) para empresa ${company}.`
    );

    return Response.json(
      {
        company,

        total:
          contas.length,

        contas,
      },
      {
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  } catch (
    error
  ) {
    console.error(
      "[M8] Erro ao carregar plano de contas:",
      error
    );

    return Response.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Erro inesperado ao consultar o plano de contas.",
      },
      {
        status: 500,
      }
    );
  }
}
