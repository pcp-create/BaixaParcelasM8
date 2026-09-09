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
 * Padding ajuda a evitar buffering do stream
 * em alguns servidores/proxies.
 */
const STREAM_PADDING = " ".repeat(2048);

/*
 * Palavras genéricas que não devem ser utilizadas
 * como referência para localizar fornecedor.
 *
 * Isso é especialmente importante para o campo complemento.
 *
 * Exemplo:
 *
 * CSV:
 * PG.P/INTERNET - ELGI COMPRESSORES DO BRASIL
 *
 * complemento:
 * PAGAMENTO ELGI COMPRESSORES
 *
 * Queremos encontrar ELGI e não PAGAMENTO.
 */
const PALAVRAS_IGNORADAS = new Set([
  "PG",
  "P",
  "PAGAMENTO",
  "PAG",
  "INTERNET",
  "DEBITO",
  "DÉBITO",
  "CREDITO",
  "CRÉDITO",
  "PIX",
  "TED",
  "DOC",
  "TRANSFERENCIA",
  "TRANSFERÊNCIA",
  "BANCO",
  "LTDA",
  "LTD",
  "ME",
  "EPP",
  "SA",
  "S",
  "A",
  "DO",
  "DA",
  "DOS",
  "DAS",
  "DE",
  "E",
  "PARA",
  "POR",
]);

/* ============================================================
   TIPOS
============================================================ */

type ModoConciliacao =
  | "pendentes"
  | "todos";

/* ============================================================
   TIPO DE MOVIMENTO DO EXTRATO

   C = Crédito  -> não concilia e não baixa
   D = Débito   -> fluxo normal de Contas a Pagar
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
   NORMALIZAR TEXTO
============================================================ */

function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   REMOVER CÓDIGO DO FORNECEDOR

   Exemplo:

   21695 - ELGI COMPRESSORES DO BRASIL...

   Resultado:

   ELGI COMPRESSORES DO BRASIL...
============================================================ */

function removerCodigoFornecedor(valor: unknown): string {
  return normalizarTexto(valor).replace(/^\d+\s+/, "").trim();
}

/* ============================================================
   PRIMEIRA PALAVRA DO FORNECEDOR

   Mantemos esta regra porque ela já funcionava bem
   para fornecedorNome.

   Exemplo:

   ELGI COMPRESSORES DO BRASIL
   ↓
   ELGI
============================================================ */

function extrairPrefixoFornecedor(valor: unknown): string {
  const texto = removerCodigoFornecedor(valor);

  return texto.split(/\s+/).filter(Boolean)[0] || "";
}

/* ============================================================
   PALAVRAS RELEVANTES DO CSV

   Exemplo:

   PG.P/INTERNET - ELGI COMPRESSORES DO BRASIL.

   Resultado aproximado:

   ELGI
   COMPRESSORES
   BRASIL

   Palavras genéricas são descartadas.
============================================================ */

function palavrasRelevantesCsv(clienteCsv: string): string[] {
  const texto = normalizarTexto(clienteCsv);

  if (!texto) {
    return [];
  }

  return texto
    .split(/\s+/)
    .map((palavra) => palavra.trim())
    .filter(Boolean)
    .filter((palavra) => palavra.length >= 3)
    .filter((palavra) => !PALAVRAS_IGNORADAS.has(palavra));
}

/* ============================================================
   COMPATIBILIDADE COM fornecedorNome

   Mantém a regra que já tínhamos:

   primeira palavra relevante do fornecedor M8
   precisa aparecer no cliente do CSV.
============================================================ */

function clienteCompativelFornecedor(
  clienteCsv: string,
  fornecedorM8: unknown
): boolean {
  const cliente = normalizarTexto(clienteCsv);

  if (!cliente) {
    return false;
  }

  const prefixo = extrairPrefixoFornecedor(fornecedorM8);

  if (!prefixo) {
    return false;
  }

  return cliente.includes(prefixo);
}

/* ============================================================
   COMPATIBILIDADE COM complemento

   Aqui não podemos pegar simplesmente a primeira palavra
   do complemento.

   Exemplo:

   complemento:
   PAGAMENTO ELGI COMPRESSORES

   primeira palavra = PAGAMENTO

   Isso não serviria.

   Então pegamos as palavras relevantes do CSV e verificamos
   se alguma delas existe no complemento.

   Exemplo:

   CSV:
   PG.P/INTERNET - ELGI COMPRESSORES DO BRASIL

   complemento:
   PAGAMENTO ELGI COMPRESSORES

   ELGI → encontrado
============================================================ */

function clienteCompativelComplemento(
  clienteCsv: string,
  complementoM8: unknown
): boolean {
  const complemento = normalizarTexto(complementoM8);

  if (!complemento) {
    return false;
  }

  const palavrasCsv = palavrasRelevantesCsv(clienteCsv);

  if (!palavrasCsv.length) {
    return false;
  }

  return palavrasCsv.some((palavra) =>
    complemento.includes(palavra)
  );
}

/* ============================================================
   TÍTULO COMPATÍVEL

   NOVA REGRA:

   fornecedorNome
   OU
   complemento

   Se encontrar em qualquer um dos dois,
   o título entra como candidato.
============================================================ */

function tituloCompativelComCliente(
  row: NormalizedCsvRow,
  titulo: M8ContaPagar
): boolean {
  const encontrouFornecedor =
    clienteCompativelFornecedor(
      row.cliente,
      titulo.fornecedorNome
    );

  const encontrouComplemento =
    clienteCompativelComplemento(
      row.cliente,
      titulo.complemento
    );

  return encontrouFornecedor || encontrouComplemento;
}

/* ============================================================
   NORMALIZAR VALOR
============================================================ */

function normalizarValor(valor: unknown): number {
  if (typeof valor === "number") {
    return valor;
  }

  const texto = String(valor ?? "")
    .trim()
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "");

  if (!texto) {
    return 0;
  }

  /*
   * Formato brasileiro:
   *
   * 10.739,00
   */
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

/* ============================================================
   COMPARAR VALORES
============================================================ */

function mesmoValor(a: unknown, b: unknown): boolean {
  return (
    Math.abs(normalizarValor(a) - normalizarValor(b)) <=
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

function normalizarData(valor: unknown): string {
  const texto = String(valor ?? "").trim();

  if (!texto) {
    return "";
  }

  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto);

  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return texto;
}

/* ============================================================
   TÍTULO PENDENTE

   Não dependemos do texto de "status" do M8.

   A regra utilizada é:

   saldo > 0

   Isso também inclui títulos parcialmente pagos,
   porque ainda possuem saldo pendente.
============================================================ */

function tituloEstaPendente(titulo: M8ContaPagar): boolean {
  const saldo = normalizarValor(titulo.saldo);

  return saldo > TOLERANCIA_VALOR;
}

/* ============================================================
   FILTRAR TÍTULOS PELO MODO DE CONCILIAÇÃO
============================================================ */

function filtrarTitulosPorModo(
  titulos: M8ContaPagar[],
  modo: ModoConciliacao
): M8ContaPagar[] {
  if (modo === "todos") {
    return titulos;
  }

  return titulos.filter(tituloEstaPendente);
}

/* ============================================================
   LOCALIZAR TÍTULOS DO FORNECEDOR

   IMPORTANTE:

   NÃO COMPARAMOS O VALOR DO TÍTULO.

   titulo.valor pode representar a soma
   de várias parcelas.
============================================================ */

function encontrarTitulosDoFornecedor(
  row: NormalizedCsvRow,
  titulos: M8ContaPagar[]
): M8ContaPagar[] {
  return titulos.filter((titulo) =>
    tituloCompativelComCliente(row, titulo)
  );
}

/* ============================================================
   PARCELA COMPATÍVEL

   A comparação financeira acontece aqui.

   parcela.valor
        =
   CSV.valor

   parcela.vencimento
        =
   CSV.dataPagamento

   parcela.pessoaNome
        compatível com
   CSV.cliente

   OBSERVAÇÃO:

   Mantemos a comparação de cliente da parcela como já estava
   funcionando. A ampliação fornecedorNome/complemento ocorre
   na localização dos títulos candidatos.
============================================================ */

function encontrarParcelasCompativeis(
  row: NormalizedCsvRow,
  parcelas: M8Parcela[]
): M8Parcela[] {
  return parcelas.filter((parcela) => {
    /*
     * O fornecedor / favorecido já foi validado
     * anteriormente na seleção do título candidato,
     * utilizando:
     *
     * fornecedorNome
     * OU
     * complemento
     *
     * Portanto, aqui não voltamos a exigir que
     * parcela.pessoaNome seja igual ao cliente do CSV.
     *
     * Isso é necessário para casos em que o pagamento
     * ocorre para securitizadora, banco, intermediador,
     * boleto registrado etc.
     */

    const valorOk =
      mesmoValor(
        parcela.valor,
        row.valor
      );

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

    return (
      valorOk &&
      dataOk
    );
  });
}

/* ============================================================
   SITUAÇÃO FINANCEIRA DA PARCELA
============================================================ */

type SituacaoParcela =
  | "aberta"
  | "baixada"
  | "parcial";

function situacaoParcela(parcela: M8Parcela): SituacaoParcela {
  const valor = normalizarValor(parcela.valor);
  const saldo = normalizarValor(parcela.saldo);

  /*
   * Saldo zerado.
   */
  if (saldo <= TOLERANCIA_VALOR) {
    return "baixada";
  }

  /*
   * Saldo menor que valor original.
   */
  if (saldo < valor - TOLERANCIA_VALOR) {
    return "parcial";
  }

  return "aberta";
}

/* ============================================================
   STREAM
============================================================ */

function criarEvento(dados: any): string {
  return JSON.stringify(dados) + "\n" + STREAM_PADDING + "\n";
}

/* ============================================================
   POST
============================================================ */

export async function POST(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function enviar(dados: any) {
        controller.enqueue(
          encoder.encode(
            criarEvento(dados)
          )
        );
      }

      try {
        /* ====================================================
           RECEBER DADOS
        ==================================================== */

        const body = await request.json();

        const company = Number(body?.company);

        const rows = body?.rows as NormalizedCsvRow[];

        const modoConciliacao: ModoConciliacao =
          body?.modoConciliacao === "todos"
            ? "todos"
            : "pendentes";

        /* ====================================================
           VALIDAR
        ==================================================== */

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

        /* ====================================================
           SOMENTE CRÉDITOS

           Se o arquivo possuir apenas movimentos C, não há
           necessidade de autenticar nem consultar o M8.
        ==================================================== */

        const possuiDebito =
          rows.some(
            (row) =>
              !ehCredito(row)
          );

        if (!possuiDebito) {
          enviar({
            type: "start",
            operation: "conciliacao",
            current: 0,
            total: rows.length,
            label:
              "Arquivo contém somente créditos. Nenhuma consulta ao M8 será necessária.",
          });

          for (
            let index = 0;
            index < rows.length;
            index++
          ) {
            const row =
              rows[index];

            enviar({
              type: "progress",
              operation: "conciliacao",
              current: index + 1,
              total: rows.length,
              label:
                row.cliente ||
                `linha ${row.numeroLinha}`,

              result: {
                rowId: row.rowId,
                status: "credito",
                statusMensagem:
                  "Crédito identificado no extrato. Não necessita conciliação ou baixa no Contas a Pagar.",

                tituloId:
                  undefined,

                parcelaId:
                  undefined,

                tituloM8:
                  undefined,

                parcelaM8:
                  undefined,

                baixaM8:
                  undefined,

                fornecedorNome:
                  undefined,

                parcelaValor:
                  undefined,

                parcelaSaldo:
                  undefined,

                apiError:
                  undefined,
              },
            });
          }

          enviar({
            type: "done",
            operation: "conciliacao",
            current: rows.length,
            total: rows.length,
            label:
              "Conciliação concluída. Os registros são créditos e não necessitam consulta ao M8.",
          });

          return;
        }

        /* ====================================================
           INÍCIO
        ==================================================== */

        enviar({
          type: "start",
          operation: "conciliacao",
          current: 0,
          total: rows.length,
          label: "Autenticando no M8...",
        });

        /* ====================================================
           AUTENTICAÇÃO
        ==================================================== */

        const token = await autenticarM8(company);

        enviar({
          type: "status",
          operation: "conciliacao",
          current: 0,
          total: rows.length,
          label:
            modoConciliacao === "pendentes"
              ? "Consultando títulos pendentes de Contas a Pagar..."
              : "Consultando todos os títulos de Contas a Pagar...",
        });

        /* ====================================================
           CARREGAR CONTAS A PAGAR
        ==================================================== */

        const todosTitulos = await listarContasPagar(token);

        /* ====================================================
           FILTRO LOCAL POR MODO

           O endpoint continua carregando a lista retornada
           pelo M8.

           Depois filtramos:

           pendentes → saldo > 0
           todos     → sem filtro

           Dessa forma não dependemos do texto do status.
        ==================================================== */

        const titulos = filtrarTitulosPorModo(
          todosTitulos,
          modoConciliacao
        );

        enviar({
          type: "status",
          operation: "conciliacao",
          current: 0,
          total: rows.length,
          label:
            modoConciliacao === "pendentes"
              ? `${titulos.length} título(s) pendente(s) de ${todosTitulos.length} título(s) carregado(s).`
              : `${titulos.length} título(s) carregado(s) para verificação completa.`,
        });

        /* ====================================================
           CACHE DE PARCELAS

           Evita consultar o mesmo título várias vezes.
        ==================================================== */

        const parcelasCache = new Map<
          number,
          M8Parcela[]
        >();

        /* ====================================================
           PROCESSAR CSV
        ==================================================== */

        for (
          let index = 0;
          index < rows.length;
          index++
        ) {
          const row = rows[index];

          const atual = index + 1;

          /* ==================================================
             CRÉDITO DO EXTRATO

             C não participa da conciliação de Contas a Pagar.
             Não procura título e não consulta parcelas.
          ================================================== */

          if (ehCredito(row)) {
            enviar({
              type: "progress",
              operation: "conciliacao",
              current: atual,
              total: rows.length,
              label:
                row.cliente ||
                `linha ${row.numeroLinha}`,

              result: {
                rowId: row.rowId,

                status:
                  "credito",

                statusMensagem:
                  "Crédito identificado no extrato. Não necessita conciliação ou baixa no Contas a Pagar.",

                tituloId:
                  undefined,

                parcelaId:
                  undefined,

                tituloM8:
                  undefined,

                parcelaM8:
                  undefined,

                baixaM8:
                  undefined,

                fornecedorNome:
                  undefined,

                parcelaValor:
                  undefined,

                parcelaSaldo:
                  undefined,

                apiError:
                  undefined,
              },
            });

            continue;
          }

          enviar({
            type: "status",
            operation: "conciliacao",
            current: index,
            total: rows.length,
            label: `Analisando ${
              row.cliente ||
              `linha ${row.numeroLinha}`
            }`,
          });

          /* ==================================================
             LOCALIZAR TÍTULOS

             fornecedorNome
             OU
             complemento

             Valor do título NÃO participa.
          ================================================== */

          const titulosFornecedor =
            encontrarTitulosDoFornecedor(
              row,
              titulos
            );

          /* ==================================================
             NENHUM TÍTULO
          ================================================== */

          if (!titulosFornecedor.length) {
            enviar({
              type: "progress",
              operation: "conciliacao",
              current: atual,
              total: rows.length,
              label: row.cliente,

              result: {
                rowId: row.rowId,

                status: "nao_encontrado",

                statusMensagem:
                  modoConciliacao === "pendentes"
                    ? "Nenhum título pendente compatível foi localizado. Se o pagamento já tiver sido processado, utilize “Verificar todos os títulos”."
                    : "Nenhum título compatível foi localizado no M8 por Fornecedor ou Complemento.",
              },
            });

            continue;
          }

          /* ==================================================
             CONSULTAR PARCELAS
          ================================================== */

          const correspondencias: Array<{
            titulo: M8ContaPagar;
            parcela: M8Parcela;
          }> = [];

          for (const titulo of titulosFornecedor) {
            let parcelas = parcelasCache.get(titulo.id);

            if (!parcelas) {
              try {
                parcelas = await listarParcelas(
                  token,
                  titulo.id
                );

                parcelasCache.set(
                  titulo.id,
                  parcelas
                );
              } catch (error) {
                console.error(
                  `[CONCILIACAO] Erro ao consultar parcelas do título ${titulo.id}:`,
                  error
                );

                parcelas = [];

                parcelasCache.set(
                  titulo.id,
                  []
                );
              }
            }

            const parcelasCompativeis =
              encontrarParcelasCompativeis(
                row,
                parcelas
              );

            for (const parcela of parcelasCompativeis) {
              correspondencias.push({
                titulo,
                parcela,
              });
            }
          }

          /* ==================================================
             NENHUMA PARCELA
          ================================================== */

          if (!correspondencias.length) {
            enviar({
              type: "progress",
              operation: "conciliacao",
              current: atual,
              total: rows.length,
              label: row.cliente,

              result: {
                rowId: row.rowId,

                status: "nao_encontrado",

                statusMensagem:
                  modoConciliacao === "pendentes"
                    ? `${titulosFornecedor.length} título(s) pendente(s) compatível(is) localizado(s), porém nenhuma parcela correspondeu a Valor + Data de Pagamento. Caso já tenha sido processada, tente “Verificar todos os títulos”.`
                    : `${titulosFornecedor.length} título(s) compatível(is) localizado(s), porém nenhuma parcela correspondeu a Valor + Data de Pagamento.`,
              },
            });

            continue;
          }

          /* ==================================================
             CONFLITO
          ================================================== */

          if (correspondencias.length > 1) {
            enviar({
              type: "progress",
              operation: "conciliacao",
              current: atual,
              total: rows.length,
              label: row.cliente,

              result: {
                rowId: row.rowId,

                status: "conflito",

                statusMensagem:
                  `${correspondencias.length} parcelas correspondem a Valor + Data de Pagamento dentro dos títulos compatíveis. Necessária revisão manual.`,
              },
            });

            continue;
          }

          /* ==================================================
             MATCH ÚNICO
          ================================================== */

          const match = correspondencias[0];

          const titulo = match.titulo;
          const parcela = match.parcela;

          const situacao = situacaoParcela(parcela);

          /* ==================================================
             JÁ BAIXADA
          ================================================== */

          if (situacao === "baixada") {
            enviar({
              type: "progress",
              operation: "conciliacao",
              current: atual,
              total: rows.length,
              label: row.cliente,

              result: {
                rowId: row.rowId,

                status: "ja_baixada",

                statusMensagem:
                  "Título e parcela encontrados. Esta parcela já está baixada no M8.",

                tituloId: titulo.id,

                parcelaId: parcela.id,

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

          /* ==================================================
             PARCIALMENTE BAIXADA
          ================================================== */

          if (situacao === "parcial") {
            enviar({
              type: "progress",
              operation: "conciliacao",
              current: atual,
              total: rows.length,
              label: row.cliente,

              result: {
                rowId: row.rowId,

                status:
                  "parcialmente_baixada",

                statusMensagem:
                  `Título e parcela encontrados, porém a parcela possui baixa parcial. Valor: ${normalizarValor(
                    parcela.valor
                  ).toFixed(2)} | Saldo: ${normalizarValor(
                    parcela.saldo
                  ).toFixed(2)}. Revisão necessária.`,

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

          /* ==================================================
             PRONTA
          ================================================== */

          enviar({
            type: "progress",
            operation: "conciliacao",
            current: atual,
            total: rows.length,
            label: row.cliente,

            result: {
              rowId: row.rowId,

              status: "pronto",

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

        /* ====================================================
           FINAL
        ==================================================== */

        enviar({
          type: "done",
          operation: "conciliacao",
          current: rows.length,
          total: rows.length,
          label: "Conciliação concluída.",
        });
      } catch (error) {
        enviar({
          type: "error",
          operation: "conciliacao",

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

  return new Response(stream, {
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
  });
}