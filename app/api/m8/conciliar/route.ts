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
   CONFIGURAÇÕES
============================================================ */

const TOLERANCIA_VALOR = 0.01;

/*
 * Ajuda a evitar buffering do stream
 * em alguns servidores / proxies.
 */
const STREAM_PADDING =
  " ".repeat(2048);

/* ============================================================
   NORMALIZAR TEXTO
============================================================ */

function normalizarTexto(
  valor: unknown
): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   EXTRAIR NOME DO FORNECEDOR

   Exemplo:

   21695 - ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD - 10560347000142

   Resultado:

   ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD - 10560347000142
============================================================ */

function removerCodigoFornecedor(
  valor: unknown
): string {
  return normalizarTexto(
    valor
  ).replace(
    /^\d+\s*-\s*/,
    ""
  );
}

/* ============================================================
   EXTRAIR PRIMEIRA PALAVRA

   ELGI COMPRESSORES...
   ↓
   ELGI
============================================================ */

function extrairPrefixoFornecedor(
  valor: unknown
): string {
  const texto =
    removerCodigoFornecedor(
      valor
    );

  return (
    texto
      .split(/\s+/)
      .filter(Boolean)[0] ||
    ""
  );
}

/* ============================================================
   VERIFICAR CLIENTE DO CSV
============================================================ */

function clienteCompativel(
  clienteCsv: string,
  fornecedorM8: unknown
): boolean {
  const cliente =
    normalizarTexto(
      clienteCsv
    );

  if (!cliente) {
    return false;
  }

  const prefixo =
    extrairPrefixoFornecedor(
      fornecedorM8
    );

  if (!prefixo) {
    return false;
  }

  return cliente.includes(
    prefixo
  );
}

/* ============================================================
   NORMALIZAR VALOR
============================================================ */

function normalizarValor(
  valor: unknown
): number {
  if (
    typeof valor ===
    "number"
  ) {
    return valor;
  }

  const texto =
    String(valor ?? "")
      .trim()
      .replace(
        /R\$\s*/gi,
        ""
      )
      .replace(/\s/g, "");

  if (!texto) {
    return 0;
  }

  /*
   * Formato brasileiro.
   *
   * 10.739,00
   */
  if (
    texto.includes(",")
  ) {
    return (
      Number(
        texto
          .replace(/\./g, "")
          .replace(",", ".")
      ) || 0
    );
  }

  return (
    Number(texto) || 0
  );
}

/* ============================================================
   COMPARAR VALORES
============================================================ */

function mesmoValor(
  a: unknown,
  b: unknown
): boolean {
  return (
    Math.abs(
      normalizarValor(a) -
        normalizarValor(b)
    ) <=
    TOLERANCIA_VALOR
  );
}

/* ============================================================
   NORMALIZAR DATA

   Aceita:

   04/09/2026

   2026-09-04

   2026-09-04T03:00:00

   Resultado:

   2026-09-04
============================================================ */

function normalizarData(
  valor: unknown
): string {
  const texto =
    String(valor ?? "")
      .trim();

  if (!texto) {
    return "";
  }

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
   ETAPA 2
   LOCALIZAR TÍTULOS PELO FORNECEDOR

   IMPORTANTE:

   NÃO COMPARAMOS MAIS O VALOR DO TÍTULO.

   titulo.valor pode ser a soma de várias parcelas.
============================================================ */

function encontrarTitulosDoFornecedor(
  row: NormalizedCsvRow,
  titulos: M8ContaPagar[]
): M8ContaPagar[] {
  return titulos.filter(
    (titulo) =>
      clienteCompativel(
        row.cliente,
        titulo.fornecedorNome
      )
  );
}

/* ============================================================
   ETAPA 3
   LOCALIZAR A PARCELA

   Aqui sim fazemos a comparação financeira.

   Regra:

   parcela.valor
      =
   CSV.valor

   parcela.vencimento
      =
   CSV.dataPagamento

   parcela.pessoaNome
      compatível com
   CSV.cliente
============================================================ */

function encontrarParcelasCompativeis(
  row: NormalizedCsvRow,
  parcelas: M8Parcela[]
): M8Parcela[] {
  return parcelas.filter(
    (parcela) => {
      /* -----------------------------------------------
         VALOR
      ------------------------------------------------ */

      const valorOk =
        mesmoValor(
          parcela.valor,
          row.valor
        );

      /* -----------------------------------------------
         DATA
      ------------------------------------------------ */

      const dataM8 =
        normalizarData(
          parcela.vencimento
        );

      const dataCsv =
        normalizarData(
          row.dataPagamento
        );

      const dataOk =
        dataM8 === dataCsv;

      /* -----------------------------------------------
         CLIENTE
      ------------------------------------------------ */

      const clienteOk =
        clienteCompativel(
          row.cliente,
          parcela.pessoaNome
        );

      return (
        valorOk &&
        dataOk &&
        clienteOk
      );
    }
  );
}

/* ============================================================
   SITUAÇÃO FINANCEIRA DA PARCELA
============================================================ */

type SituacaoParcela =
  | "aberta"
  | "baixada"
  | "parcial";

/*
 * Regras:
 *
 * saldo <= 0
 *      → baixada
 *
 * 0 < saldo < valor
 *      → parcial
 *
 * saldo aproximadamente igual ao valor
 *      → aberta
 */
function situacaoParcela(
  parcela: M8Parcela
): SituacaoParcela {
  const valor =
    normalizarValor(
      parcela.valor
    );

  const saldo =
    normalizarValor(
      parcela.saldo
    );

  /* -----------------------------------------------
     JÁ BAIXADA
  ------------------------------------------------ */

  if (
    saldo <=
    TOLERANCIA_VALOR
  ) {
    return "baixada";
  }

  /* -----------------------------------------------
     PARCIALMENTE BAIXADA
  ------------------------------------------------ */

  if (
    saldo <
    valor -
      TOLERANCIA_VALOR
  ) {
    return "parcial";
  }

  /* -----------------------------------------------
     EM ABERTO
  ------------------------------------------------ */

  return "aberta";
}

/* ============================================================
   STREAM
============================================================ */

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
      async start(
        controller
      ) {
        function enviar(
          dados: any
        ) {
          controller.enqueue(
            encoder.encode(
              criarEvento(
                dados
              )
            )
          );
        }

        try {
          /* ==================================================
             RECEBER DADOS
          ================================================== */

          const body =
            await request.json();

          const company =
            Number(
              body?.company
            );

          const rows =
            body?.rows as NormalizedCsvRow[];

          /* ==================================================
             VALIDAR
          ================================================== */

          if (
            !Number.isFinite(
              company
            ) ||
            company <= 0
          ) {
            throw new Error(
              "Empresa M8 inválida."
            );
          }

          if (
            !Array.isArray(
              rows
            ) ||
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
            type:
              "start",

            operation:
              "conciliacao",

            current: 0,

            total:
              rows.length,

            label:
              "Autenticando no M8...",
          });

          /* ==================================================
             ETAPA 1
             AUTENTICAÇÃO
          ================================================== */

          const token =
            await autenticarM8(
              company
            );

          enviar({
            type:
              "status",

            operation:
              "conciliacao",

            current: 0,

            total:
              rows.length,

            label:
              "Consultando todos os títulos de Contas a Pagar...",
          });

          /* ==================================================
             ETAPA 2
             TODOS OS TÍTULOS

             NÃO FILTRAR SOMENTE PENDENTES.

             Precisamos também localizar parcelas
             que eventualmente já foram baixadas.
          ================================================== */

          const titulos =
            await listarContasPagar(
              token
            );

          enviar({
            type:
              "status",

            operation:
              "conciliacao",

            current: 0,

            total:
              rows.length,

            label:
              `${titulos.length} título(s) carregado(s). Analisando fornecedores...`,
          });

          /* ==================================================
             CACHE DE PARCELAS

             Evita consultar o mesmo título várias vezes.
          ================================================== */

          const parcelasCache =
            new Map<
              number,
              M8Parcela[]
            >();

          /* ==================================================
             PROCESSAR LINHAS CSV
          ================================================== */

          for (
            let index = 0;
            index <
            rows.length;
            index++
          ) {
            const row =
              rows[index];

            const atual =
              index + 1;

            /* =================================================
               STATUS DO PROCESSAMENTO
            ================================================= */

            enviar({
              type:
                "status",

              operation:
                "conciliacao",

              current:
                index,

              total:
                rows.length,

              label:
                `Analisando ${row.cliente || `linha ${row.numeroLinha}`}`,
            });

            /* =================================================
               ETAPA 2
               LOCALIZAR TÍTULOS PELO FORNECEDOR

               IMPORTANTE:

               Valor do título NÃO é usado.
            ================================================= */

            const titulosFornecedor =
              encontrarTitulosDoFornecedor(
                row,
                titulos
              );

            /* =================================================
               NENHUM TÍTULO DO FORNECEDOR
            ================================================= */

            if (
              titulosFornecedor.length ===
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
                    "Nenhum título deste fornecedor foi localizado no M8.",
                },
              });

              continue;
            }

            /* =================================================
               ETAPA 3
               CONSULTAR AS PARCELAS DOS TÍTULOS
            ================================================= */

            const correspondencias:
              Array<{
                titulo: M8ContaPagar;
                parcela: M8Parcela;
              }> = [];

            for (
              const titulo
              of titulosFornecedor
            ) {
              let parcelas =
                parcelasCache.get(
                  titulo.id
                );

              /* -----------------------------------------------
                 CONSULTAR SOMENTE UMA VEZ
              ------------------------------------------------ */

              if (!parcelas) {
                try {
                  parcelas =
                    await listarParcelas(
                      token,
                      titulo.id
                    );

                  parcelasCache.set(
                    titulo.id,
                    parcelas
                  );
                } catch (error) {
                  /*
                   * Uma falha em um título específico
                   * não interrompe toda a conciliação.
                   */

                  console.error(
                    `[CONCILIACAO] Erro ao consultar parcelas do título ${titulo.id}:`,
                    error
                  );

                  parcelas =
                    [];

                  parcelasCache.set(
                    titulo.id,
                    []
                  );
                }
              }

              /* -----------------------------------------------
                 PARCELAS COMPATÍVEIS
              ------------------------------------------------ */

              const parcelasCompativeis =
                encontrarParcelasCompativeis(
                  row,
                  parcelas
                );

              for (
                const parcela
                of parcelasCompativeis
              ) {
                correspondencias.push(
                  {
                    titulo,
                    parcela,
                  }
                );
              }
            }

            /* =================================================
               NENHUMA PARCELA
            ================================================= */

            if (
              correspondencias.length ===
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
                    `${titulosFornecedor.length} título(s) do fornecedor localizado(s), porém nenhuma parcela correspondeu a Valor + Data de Pagamento + Cliente.`,
                },
              });

              continue;
            }

            /* =================================================
               MAIS DE UMA PARCELA COMPATÍVEL

               Não podemos escolher automaticamente.
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
                    `${correspondencias.length} parcelas correspondem a Valor + Data de Pagamento + Cliente. Necessária revisão manual.`,
                },
              });

              continue;
            }

            /* =================================================
               UMA ÚNICA PARCELA
            ================================================= */

            const match =
              correspondencias[0];

            const titulo =
              match.titulo;

            const parcela =
              match.parcela;

            const situacao =
              situacaoParcela(
                parcela
              );

            /* =================================================
               JÁ BAIXADA
            ================================================= */

            if (
              situacao ===
              "baixada"
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
                    "ja_baixada",

                  statusMensagem:
                    "Título e parcela encontrados. Esta parcela já está baixada no M8.",

                  tituloId:
                    titulo.id,

                  parcelaId:
                    parcela.id,

                  fornecedorNome:
                    titulo.fornecedorNome,

                  parcelaValor:
                    parcela.valor,

                  parcelaSaldo:
                    parcela.saldo,

                  tituloM8:
                    titulo,

                  parcelaM8:
                    parcela,
                },
              });

              continue;
            }

            /* =================================================
               PARCIALMENTE BAIXADA
            ================================================= */

            if (
              situacao ===
              "parcial"
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
                    "parcialmente_baixada",

                  statusMensagem:
                    `Título e parcela encontrados, porém a parcela possui baixa parcial. Valor: ${normalizarValor(
                      parcela.valor
                    ).toFixed(
                      2
                    )} | Saldo: ${normalizarValor(
                      parcela.saldo
                    ).toFixed(
                      2
                    )}. Revisão necessária.`,

                  tituloId:
                    titulo.id,

                  parcelaId:
                    parcela.id,

                  fornecedorNome:
                    titulo.fornecedorNome,

                  parcelaValor:
                    parcela.valor,

                  parcelaSaldo:
                    parcela.saldo,

                  tituloM8:
                    titulo,

                  parcelaM8:
                    parcela,
                },
              });

              continue;
            }

            /* =================================================
               PARCELA EM ABERTO
               PRONTA PARA BAIXA
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
                  "pronto",

                statusMensagem:
                  "Título e parcela encontrados. Parcela disponível para baixa.",

                tituloId:
                  titulo.id,

                parcelaId:
                  parcela.id,

                fornecedorNome:
                  titulo.fornecedorNome,

                parcelaValor:
                  parcela.valor,

                parcelaSaldo:
                  parcela.saldo,

                tituloM8:
                  titulo,

                parcelaM8:
                  parcela,
              },
            });
          }

          /* ==================================================
             FINAL
          ================================================== */

          enviar({
            type:
              "done",

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
            type:
              "error",

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