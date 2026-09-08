import {
  autenticarM8,
  baixarParcela,
} from "@/lib/m8";

import {
  BankM8Config,
  NormalizedCsvRow,
} from "@/lib/types";

/* ============================================================
   DATA DO PAGAMENTO
============================================================ */

function dataPagamentoParaIso(
  valor: string
): string {
  if (!valor) {
    throw new Error(
      "Data de pagamento não informada."
    );
  }

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      valor
    );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}T12:00:00.000Z`;
  }

  const br =
    /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
      valor
    );

  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}T12:00:00.000Z`;
  }

  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    throw new Error(
      `Data de pagamento inválida: ${valor}`
    );
  }

  return data.toISOString();
}

/* ============================================================
   STREAM

   Padding utilizado para reduzir buffering
   de pequenos chunks.
============================================================ */

const STREAM_PADDING =
  " ".repeat(2048);

function criarEvento(
  dados: any
) {
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
              criarEvento(
                dados
              )
            )
          );
        }

        try {
          const body =
            await request.json();

          const company =
            Number(
              body?.company
            );

          const rows =
            body?.rows as NormalizedCsvRow[];

          const config =
            body?.config as BankM8Config;

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
              "Nenhuma parcela recebida para baixa."
            );
          }

          if (!config) {
            throw new Error(
              "Configuração M8 do banco não informada."
            );
          }

          if (
            Number(
              config.contaContabilId
            ) <= 0
          ) {
            throw new Error(
              "Conta Contábil não configurada."
            );
          }

          if (
            Number(
              config.historicoId
            ) <= 0
          ) {
            throw new Error(
              "Histórico não configurado."
            );
          }

          if (
            Number(
              config.meioPagamentoId
            ) <= 0
          ) {
            throw new Error(
              "Meio de Pagamento não configurado."
            );
          }

          /* ==================================================
             INÍCIO
          ================================================== */

          enviar({
            type: "start",
            operation:
              "baixa",
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
              "baixa",
            current: 0,
            total: rows.length,
            label:
              "Autenticação concluída. Iniciando baixas...",
          });

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
                "baixa",
              current:
                index,
              total:
                rows.length,
              label:
                `Baixando ${row.cliente || `parcela ${row.parcelaId}`}`,
            });

            try {
              if (
                !row.tituloId ||
                !row.parcelaId
              ) {
                throw new Error(
                  "Título ou parcela não informado."
                );
              }

              if (
                row.valor == null ||
                row.valor <= 0
              ) {
                throw new Error(
                  "Valor inválido para baixa."
                );
              }

              const payload = {
                data:
                  dataPagamentoParaIso(
                    row.dataPagamento
                  ),

                contaContabilId:
                  Number(
                    config.contaContabilId
                  ),

                historicoId:
                  Number(
                    config.historicoId
                  ),

                meioPagamentoId:
                  Number(
                    config.meioPagamentoId
                  ),

                valor:
                  Number(
                    row.valor
                  ),

                chequeId: 0,

                valorJuros: 0,

                valorMulta: 0,

                valorDesconto: 0,

                taxaOperadoraCartao:
                  0,

                observacaoInterna:
                  config.observacaoInterna ||
                  "Baixa automática via conciliação bancária",

                complemento:
                  config.complemento ||
                  "",
              };

              const retorno =
                await baixarParcela(
                  token,
                  row.tituloId,
                  row.parcelaId,
                  payload
                );

              enviar({
                type:
                  "progress",
                operation:
                  "baixa",
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
                    "baixada",

                  statusMensagem:
                    "Parcela baixada com sucesso no M8.",

                  baixaM8:
                    retorno,
                },
              });
            } catch (error) {
              const mensagem =
                error instanceof Error
                  ? error.message
                  : "Erro ao baixar parcela.";

              enviar({
                type:
                  "progress",
                operation:
                  "baixa",
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
                    "erro",

                  statusMensagem:
                    "Erro ao baixar parcela.",

                  apiError:
                    mensagem,
                },
              });
            }
          }

          enviar({
            type: "done",
            operation:
              "baixa",
            current:
              rows.length,
            total:
              rows.length,
            label:
              "Baixas concluídas.",
          });
        } catch (error) {
          enviar({
            type: "error",
            operation:
              "baixa",
            error:
              error instanceof Error
                ? error.message
                : "Erro inesperado durante a baixa.",
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