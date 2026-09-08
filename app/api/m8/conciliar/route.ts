import {
  autenticarM8,
  listarContasPagar,
  listarParcelas,
} from "@/lib/m8";

import {
  M8ContaPagar,
  M8Parcela,
  NormalizedCsvRow,
} from "@/lib/types";

/* ============================================================
   NORMALIZAÇÃO DE TEXTO
============================================================ */

function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   PREFIXO DO FORNECEDOR
============================================================ */

function extrairPrefixo(valor: unknown): string {
  let texto = normalizarTexto(valor);

  texto = texto.replace(
    /^\d+\s*-\s*/,
    ""
  );

  return (
    texto
      .split(/\s+/)
      .filter(Boolean)[0] || ""
  );
}

/* ============================================================
   CLIENTE CONTÉM PREFIXO
============================================================ */

function clienteContemPrefixo(
  cliente: string,
  prefixo: string
): boolean {
  if (!prefixo) return false;

  return normalizarTexto(
    cliente
  ).includes(
    normalizarTexto(prefixo)
  );
}

/* ============================================================
   NORMALIZAÇÃO DE VALOR
============================================================ */

function normalizarValor(valor: unknown): number {
  if (typeof valor === "number") {
    return valor;
  }

  const texto = String(valor ?? "")
    .trim()
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "");

  if (!texto) return 0;

  if (texto.includes(",")) {
    return (
      Number(
        texto
          .replace(/\./g, "")
          .replace(",", ".")
      ) || 0
    );
  }

  return Number(texto) || 0;
}

function mesmoValor(
  a: unknown,
  b: unknown
): boolean {
  return (
    Math.abs(
      normalizarValor(a) -
        normalizarValor(b)
    ) <= 0.01
  );
}

/* ============================================================
   NORMALIZAÇÃO DE DATA
============================================================ */

function normalizarData(valor: unknown): string {
  const texto = String(
    valor ?? ""
  ).trim();

  if (!texto) return "";

  const br =
    /^(\d{2})\/(\d{2})\/(\d{4})/.exec(
      texto
    );

  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})/.exec(
      texto
    );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return texto;
}

/* ============================================================
   TÍTULOS CANDIDATOS
============================================================ */

function encontrarTitulosCandidatos(
  row: NormalizedCsvRow,
  titulos: M8ContaPagar[]
) {
  return titulos.filter(
    (titulo) => {
      const valorOk =
        mesmoValor(
          titulo.valor,
          row.valor
        );

      const prefixo =
        extrairPrefixo(
          titulo.fornecedorNome
        );

      const clienteOk =
        clienteContemPrefixo(
          row.cliente,
          prefixo
        );

      return valorOk && clienteOk;
    }
  );
}

/* ============================================================
   PARCELAS CANDIDATAS
============================================================ */

function encontrarParcelasCandidatas(
  row: NormalizedCsvRow,
  parcelas: M8Parcela[]
) {
  return parcelas.filter(
    (parcela) => {
      const dataOk =
        normalizarData(
          parcela.vencimento
        ) ===
        normalizarData(
          row.dataPagamento
        );

      const valorOk =
        mesmoValor(
          parcela.valor,
          row.valor
        );

      const prefixo =
        extrairPrefixo(
          parcela.pessoaNome
        );

      const clienteOk =
        clienteContemPrefixo(
          row.cliente,
          prefixo
        );

      return (
        dataOk &&
        valorOk &&
        clienteOk
      );
    }
  );
}

/* ============================================================
   STREAM
============================================================ */

/*
 * O padding ajuda a evitar que servidores/proxies
 * mantenham pequenos chunks em buffer e entreguem
 * tudo somente no final.
 */
const STREAM_PADDING =
  " ".repeat(2048);

function criarEvento(
  dados: any
): string {
  return (
    JSON.stringify(dados) +
    "\n" +
    STREAM_PADDING +
    "\n"
  );
}

/* ============================================================
   POST
============================================================ */

export async function POST(
  request: Request
) {
  const encoder =
    new TextEncoder();

  const stream =
    new ReadableStream({
      async start(controller) {
        function enviar(
          dados: any
        ) {
          controller.enqueue(
            encoder.encode(
              criarEvento(dados)
            )
          );
        }

        try {
          const body =
            await request.json();

          const company =
            Number(body?.company);

          const rows =
            body?.rows as NormalizedCsvRow[];

          if (
            !Number.isFinite(company) ||
            company <= 0
          ) {
            throw new Error(
              "Empresa M8 inválida."
            );
          }

          if (
            !Array.isArray(rows) ||
            !rows.length
          ) {
            throw new Error(
              "Nenhum registro recebido para conciliação."
            );
          }

          /* ==================================================
             INÍCIO
          ================================================== */

          enviar({
            type: "start",
            operation:
              "conciliacao",
            current: 0,
            total: rows.length,
            label:
              "Autenticando no M8...",
          });

          /* ==================================================
             AUTENTICAÇÃO
          ================================================== */

          const token =
            await autenticarM8(
              company
            );

          enviar({
            type: "status",
            operation:
              "conciliacao",
            current: 0,
            total: rows.length,
            label:
              "Consultando Contas a Pagar do M8...",
          });

          /* ==================================================
             CONTAS A PAGAR
          ================================================== */

          const titulos =
            await listarContasPagar(
              token
            );

          enviar({
            type: "status",
            operation:
              "conciliacao",
            current: 0,
            total: rows.length,
            label:
              `${titulos.length} título(s) carregado(s). Iniciando análise dos registros...`,
          });

          /* ==================================================
             CACHE DAS PARCELAS
          ================================================== */

          const parcelasCache =
            new Map<
              number,
              M8Parcela[]
            >();

          /* ==================================================
             PROCESSAMENTO
          ================================================== */

          for (
            let index = 0;
            index < rows.length;
            index++
          ) {
            const row =
              rows[index];

            const atual =
              index + 1;

            enviar({
              type: "status",
              operation:
                "conciliacao",
              current: index,
              total: rows.length,
              label:
                `Analisando ${row.cliente || `linha ${row.numeroLinha}`}`,
            });

            const titulosMesmoValor =
              titulos.filter(
                (titulo) =>
                  mesmoValor(
                    titulo.valor,
                    row.valor
                  )
              );

            const titulosCandidatos =
              encontrarTitulosCandidatos(
                row,
                titulos
              );

            /* =================================================
               NENHUM TÍTULO
            ================================================= */

            if (
              titulosCandidatos.length ===
              0
            ) {
              enviar({
                type:
                  "progress",
                operation:
                  "conciliacao",
                current:
                  atual,
                total:
                  rows.length,
                label:
                  row.cliente,

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "nao_encontrado",

                  statusMensagem:
                    `Nenhum título encontrado por Valor + Cliente. ${titulosMesmoValor.length} título(s) encontrado(s) somente pelo valor.`,
                },
              });

              continue;
            }

            /* =================================================
               PARCELAS
            ================================================= */

            const correspondencias:
              Array<{
                titulo: M8ContaPagar;
                parcela: M8Parcela;
              }> = [];

            for (
              const titulo
              of titulosCandidatos
            ) {
              let parcelas =
                parcelasCache.get(
                  titulo.id
                );

              if (!parcelas) {
                parcelas =
                  await listarParcelas(
                    token,
                    titulo.id
                  );

                parcelasCache.set(
                  titulo.id,
                  parcelas
                );
              }

              const encontradas =
                encontrarParcelasCandidatas(
                  row,
                  parcelas
                );

              for (
                const parcela
                of encontradas
              ) {
                correspondencias.push({
                  titulo,
                  parcela,
                });
              }
            }

            /* =================================================
               UMA CORRESPONDÊNCIA
            ================================================= */

            if (
              correspondencias.length ===
              1
            ) {
              const match =
                correspondencias[0];

              enviar({
                type:
                  "progress",
                operation:
                  "conciliacao",
                current:
                  atual,
                total:
                  rows.length,
                label:
                  row.cliente,

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "pronto",

                  statusMensagem:
                    "Título e parcela encontrados no M8.",

                  tituloId:
                    match.titulo.id,

                  parcelaId:
                    match.parcela.id,

                  fornecedorNome:
                    match.titulo
                      .fornecedorNome,

                  parcelaValor:
                    match.parcela
                      .valor,

                  parcelaSaldo:
                    match.parcela
                      .saldo,

                  /*
                   * Payload completo para
                   * os detalhes da tela.
                   */
                  tituloM8:
                    match.titulo,

                  parcelaM8:
                    match.parcela,
                },
              });

              continue;
            }

            /* =================================================
               CONFLITO
            ================================================= */

            if (
              correspondencias.length >
              1
            ) {
              enviar({
                type:
                  "progress",
                operation:
                  "conciliacao",
                current:
                  atual,
                total:
                  rows.length,
                label:
                  row.cliente,

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "conflito",

                  statusMensagem:
                    `${correspondencias.length} parcelas compatíveis foram encontradas. Necessária revisão manual.`,
                },
              });

              continue;
            }

            /* =================================================
               TÍTULO EXISTE, PARCELA NÃO
            ================================================= */

            enviar({
              type:
                "progress",
              operation:
                "conciliacao",
              current:
                atual,
              total:
                rows.length,
              label:
                row.cliente,

              result: {
                rowId:
                  row.rowId,

                status:
                  "nao_encontrado",

                statusMensagem:
                  `${titulosCandidatos.length} título(s) encontrado(s), porém nenhuma parcela correspondeu à Data de Pagamento + Valor + Cliente.`,
              },
            });
          }

          /* ==================================================
             FINAL
          ================================================== */

          enviar({
            type: "done",
            operation:
              "conciliacao",
            current:
              rows.length,
            total:
              rows.length,
            label:
              "Conciliação concluída.",
          });
        } catch (error) {
          enviar({
            type: "error",
            operation:
              "conciliacao",
            error:
              error instanceof Error
                ? error.message
                : "Erro inesperado durante a conciliação.",
          });
        } finally {
          controller.close();
        }
      },
    });

  return new Response(
    stream,
    {
      headers: {
        "Content-Type":
          "application/x-ndjson; charset=utf-8",

        "Cache-Control":
          "no-cache, no-store, must-revalidate, no-transform",

        "X-Accel-Buffering":
          "no",

        "Content-Encoding":
          "identity",

        Connection:
          "keep-alive",
      },
    }
  );
}