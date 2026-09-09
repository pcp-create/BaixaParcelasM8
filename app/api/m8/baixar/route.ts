import {
  autenticarM8,
  baixarParcela,
} from "@/lib/m8";

import {
  BankM8Config,
  NormalizedCsvRow,
} from "@/lib/types";

/* ============================================================
   CONFIGURAÇÕES
============================================================ */

/*
 * Padding utilizado para ajudar o navegador a receber
 * atualizações progressivas do processamento.
 */
const STREAM_PADDING = " ".repeat(2048);

/* ============================================================
   TIPO DE MOVIMENTO DO EXTRATO

   C = Crédito  -> nunca deve ser baixado no Contas a Pagar
   D = Débito   -> fluxo normal
============================================================ */

function ehCredito(
  row: NormalizedCsvRow
): boolean {
  return (
    String(row.tipo ?? "")
      .trim()
      .toUpperCase() === "C"
  );
}

/* ============================================================
   CRIAR EVENTO DO STREAM
============================================================ */

function criarEvento(dados: any): string {
  return (
    JSON.stringify(dados) +
    "\n" +
    STREAM_PADDING +
    "\n"
  );
}

/* ============================================================
   NORMALIZAR VALOR
============================================================ */

function normalizarValor(
  valor: unknown
): number {
  if (
    typeof valor === "number"
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
   * Formato brasileiro:
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

  return Number(texto) || 0;
}

/* ============================================================
   DATA DE PAGAMENTO DO CSV → ISO

   IMPORTANTE:

   A DATA UTILIZADA NA BAIXA É A DATA DE PAGAMENTO
   INFORMADA NO CSV DO EXTRATO BANCÁRIO.

   Exemplos aceitos:

   04/09/2026
   2026-09-04

   Resultado:

   2026-09-04T12:00:00.000Z

   Utilizamos 12:00 UTC para evitar alteração do dia
   devido a conversões de fuso horário.
============================================================ */

function dataPagamentoParaIso(
  valor: unknown
): string {
  const texto =
    String(valor ?? "").trim();

  if (!texto) {
    throw new Error(
      "Data de pagamento não informada no CSV."
    );
  }

  /* ----------------------------------------------------------
     FORMATO BRASILEIRO
     DD/MM/AAAA
  ---------------------------------------------------------- */

  const br =
    /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(
      texto
    );

  if (br) {
    const dia = br[1];
    const mes = br[2];
    const ano = br[3];

    return `${ano}-${mes}-${dia}T12:00:00.000Z`;
  }

  /* ----------------------------------------------------------
     FORMATO ISO
     AAAA-MM-DD
  ---------------------------------------------------------- */

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})/.exec(
      texto
    );

  if (iso) {
    const ano = iso[1];
    const mes = iso[2];
    const dia = iso[3];

    return `${ano}-${mes}-${dia}T12:00:00.000Z`;
  }

  throw new Error(
    `Data de pagamento inválida: ${texto}`
  );
}

/* ============================================================
   ACRESCENTAR TEXTO PRESERVANDO O EXISTENTE

   REGRA:

   Se já existir informação no M8:

   Migração da Empresa 3

   E na configuração do banco estiver:

   Baixa via conciliação bancária

   Resultado enviado:

   Migração da Empresa 3

   Baixa via conciliação bancária

   Ou seja:
   preserva o texto existente,
   adiciona uma linha em branco,
   depois acrescenta o texto configurado.
============================================================ */

function acrescentarTexto(
  existente: unknown,
  adicional: unknown
): string {
  const textoExistente =
    String(
      existente ?? ""
    ).trim();

  const textoAdicional =
    String(
      adicional ?? ""
    ).trim();

  /*
   * Existem os dois textos.
   */
  if (
    textoExistente &&
    textoAdicional
  ) {
    return (
      textoExistente +
      "\n\n" +
      textoAdicional
    );
  }

  /*
   * Existe somente um deles.
   */
  return (
    textoExistente ||
    textoAdicional ||
    ""
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
        /* ====================================================
           ENVIAR EVENTO
        ==================================================== */

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
             RECEBER PAYLOAD
          ================================================== */

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

          /* ==================================================
             VALIDAÇÕES GERAIS
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
              "Nenhuma parcela foi recebida para baixa."
            );
          }

          /* ==================================================
             SOMENTE CRÉDITOS

             Proteção de backend:
             se por algum motivo forem enviados somente créditos,
             não autentica, não valida configuração e não chama
             o endpoint de baixa do M8.
          ================================================== */

          const possuiDebito =
            rows.some(
              (row) =>
                !ehCredito(row)
            );

          if (!possuiDebito) {
            enviar({
              type:
                "start",

              operation:
                "baixa",

              current: 0,

              total:
                rows.length,

              label:
                "Nenhuma baixa necessária. Os registros recebidos são créditos.",
            });

            for (
              let index = 0;
              index < rows.length;
              index++
            ) {
              const row =
                rows[index];

              enviar({
                type:
                  "progress",

                operation:
                  "baixa",

                current:
                  index + 1,

                total:
                  rows.length,

                label:
                  "Crédito ignorado para baixa.",

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "credito",

                  statusMensagem:
                    "Crédito do extrato. Não é permitida baixa no Contas a Pagar.",

                  tituloId:
                    undefined,

                  parcelaId:
                    undefined,

                  apiError:
                    undefined,
                },
              });
            }

            enviar({
              type:
                "done",

              operation:
                "baixa",

              current:
                rows.length,

              total:
                rows.length,

              label:
                "Processamento concluído. Nenhum crédito foi enviado para baixa.",
            });

            return;
          }

          if (!config) {
            throw new Error(
              "Configuração do banco não informada."
            );
          }

          /* ==================================================
             VALIDAR CONTA CONTÁBIL
          ================================================== */

          const contaContabilId =
            Number(
              config.contaContabilId
            );

          if (
            !Number.isFinite(
              contaContabilId
            ) ||
            contaContabilId <= 0
          ) {
            throw new Error(
              "Conta Contábil inválida. Configure o banco antes de efetuar a baixa."
            );
          }

          /* ==================================================
             VALIDAR HISTÓRICO
          ================================================== */

          const historicoId =
            Number(
              config.historicoId
            );

          if (
            !Number.isFinite(
              historicoId
            ) ||
            historicoId <= 0
          ) {
            throw new Error(
              "Histórico inválido. Configure o banco antes de efetuar a baixa."
            );
          }

          /* ==================================================
             VALIDAR MEIO DE PAGAMENTO
          ================================================== */

          const meioPagamentoId =
            Number(
              config.meioPagamentoId
            );

          if (
            !Number.isFinite(
              meioPagamentoId
            ) ||
            meioPagamentoId <= 0
          ) {
            throw new Error(
              "Meio de Pagamento inválido. Configure o banco antes de efetuar a baixa."
            );
          }

          /* ==================================================
             INICIAR PROCESSAMENTO
          ================================================== */

          enviar({
            type:
              "start",

            operation:
              "baixa",

            current: 0,

            total:
              rows.length,

            label:
              "Autenticando no M8...",
          });

          /* ==================================================
             AUTENTICAÇÃO

             Fazemos apenas uma autenticação para todas
             as parcelas da operação.
          ================================================== */

          const token =
            await autenticarM8(
              company
            );

          enviar({
            type:
              "status",

            operation:
              "baixa",

            current: 0,

            total:
              rows.length,

            label:
              "Autenticação concluída. Iniciando baixas...",
          });

          /* ==================================================
             PROCESSAR PARCELAS
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
               CRÉDITO DO EXTRATO

               Segunda proteção: mesmo que um crédito seja
               enviado ao endpoint por engano, ele nunca chama
               baixarParcela().
            ================================================= */

            if (ehCredito(row)) {
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
                  "Crédito ignorado para baixa.",

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "credito",

                  statusMensagem:
                    "Crédito do extrato. Não é permitida baixa no Contas a Pagar.",

                  tituloId:
                    undefined,

                  parcelaId:
                    undefined,

                  apiError:
                    undefined,
                },
              });

              continue;
            }

            /* =================================================
               STATUS ATUAL
            ================================================= */

            enviar({
              type:
                "status",

              operation:
                "baixa",

              current:
                index,

              total:
                rows.length,

              label:
                `Baixando parcela ${row.parcelaId ?? "—"} do título ${row.tituloId ?? "—"}...`,
            });

            try {
              /* ===============================================
                 VALIDAR TÍTULO
              =============================================== */

              const tituloId =
                Number(
                  row.tituloId
                );

              if (
                !Number.isFinite(
                  tituloId
                ) ||
                tituloId <= 0
              ) {
                throw new Error(
                  "Título M8 inválido ou não informado."
                );
              }

              /* ===============================================
                 VALIDAR PARCELA
              =============================================== */

              const parcelaId =
                Number(
                  row.parcelaId
                );

              if (
                !Number.isFinite(
                  parcelaId
                ) ||
                parcelaId <= 0
              ) {
                throw new Error(
                  "Parcela M8 inválida ou não informada."
                );
              }

              /* ===============================================
                 VALIDAR VALOR
              =============================================== */

              const valor =
                normalizarValor(
                  row.valor
                );

              if (
                !Number.isFinite(
                  valor
                ) ||
                valor <= 0
              ) {
                throw new Error(
                  "Valor da baixa inválido."
                );
              }

              /* ===============================================
                 DATA DA BAIXA

                 Vem da Data de Pagamento do CSV.
              =============================================== */

              const dataBaixa =
                dataPagamentoParaIso(
                  row.dataPagamento
                );

              /* ===============================================
                 INFORMAÇÕES EXISTENTES NO M8

                 Primeiro procura na PARCELA.

                 Caso o campo não exista ou esteja vazio,
                 utiliza o valor existente no TÍTULO.

                 Isso evita perder informações já existentes.
              =============================================== */

              const observacaoExistente =
                row.parcelaM8
                  ?.observacaoInterna ??
                row.tituloM8
                  ?.observacaoInterna ??
                "";

              const complementoExistente =
                row.parcelaM8
                  ?.complemento ??
                row.tituloM8
                  ?.complemento ??
                "";

              /* ===============================================
                 OBSERVAÇÃO FINAL
              =============================================== */

              const observacaoInterna =
                acrescentarTexto(
                  observacaoExistente,
                  config.observacaoInterna
                );

              /* ===============================================
                 COMPLEMENTO FINAL
              =============================================== */

              const complemento =
                acrescentarTexto(
                  complementoExistente,
                  config.complemento
                );

              /* ===============================================
                 PAYLOAD DA BAIXA
              =============================================== */

              const payload = {
                /*
                 * Data de pagamento do CSV.
                 */
                data:
                  dataBaixa,

                /*
                 * Configuração do banco.
                 */
                contaContabilId,

                historicoId,

                meioPagamentoId,

                /*
                 * Valor da linha do CSV.
                 */
                valor,

                /*
                 * Mantemos os campos financeiros zerados
                 * quando não há juros, multa ou desconto.
                 */
                valorJuros:
                  0,

                valorMulta:
                  0,

                valorDesconto:
                  0,

                taxaOperadoraCartao:
                  0,

                /*
                 * Mantém o conteúdo existente do M8
                 * e acrescenta o configurado pelo usuário.
                 */
                observacaoInterna,

                complemento,
              };

              /* ===============================================
                 EFETUAR BAIXA NO M8
              =============================================== */

              const retorno =
                await baixarParcela(
                  token,
                  tituloId,
                  parcelaId,
                  payload
                );

              /* ===============================================
                 SUCESSO
              =============================================== */

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
                  `Parcela ${parcelaId} baixada com sucesso.`,

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "baixada",

                  statusMensagem:
                    "Parcela baixada com sucesso no M8.",

                  tituloId,

                  parcelaId,

                  baixaM8:
                    retorno,

                  apiError:
                    undefined,
                },
              });
            } catch (error) {
              /* ===============================================
                 ERRO INDIVIDUAL

                 Uma parcela com erro não interrompe
                 as demais parcelas.
              =============================================== */

              const mensagem =
                error instanceof Error
                  ? error.message
                  : "Erro inesperado ao baixar parcela.";

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
                  `Erro ao baixar parcela ${row.parcelaId ?? "—"}.`,

                result: {
                  rowId:
                    row.rowId,

                  status:
                    "erro",

                  statusMensagem:
                    "Erro ao baixar parcela no M8.",

                  tituloId:
                    row.tituloId,

                  parcelaId:
                    row.parcelaId,

                  apiError:
                    mensagem,
                },
              });
            }
          }

          /* ==================================================
             FINAL
          ================================================== */

          enviar({
            type:
              "done",

            operation:
              "baixa",

            current:
              rows.length,

            total:
              rows.length,

            label:
              "Processamento de baixa concluído.",
          });
        } catch (error) {
          /* ==================================================
             ERRO GERAL

             Erros como autenticação ou configuração inválida.
          ================================================== */

          enviar({
            type:
              "error",

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

  /* ==========================================================
     RESPONSE STREAM
  ========================================================== */

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