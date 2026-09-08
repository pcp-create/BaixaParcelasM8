import { NextResponse } from "next/server";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ============================================================
   NORMALIZAÇÃO DE TEXTO
============================================================ */

function normalizarTexto(
  valor?: string | null
): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   EXTRAIR PREFIXO DO FORNECEDOR / PESSOA

   Exemplos:

   M8 Título:
   21695 - ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD - 10560347000142
   ↓
   ELGI

   M8 Parcela:
   ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD
   ↓
   ELGI
============================================================ */

function extrairPrefixo(
  valor?: string | null
): string {
  let texto = normalizarTexto(valor);

  if (!texto) {
    return "";
  }

  /*
   * Remove código inicial caso exista:
   *
   * 21695 - ELGI...
   *
   * vira:
   *
   * ELGI...
   */
  texto = texto.replace(
    /^\d+\s*-\s*/,
    ""
  );

  /*
   * Retorna primeira palavra.
   */
  return (
    texto
      .split(/\s+/)
      .filter(Boolean)[0] ?? ""
  );
}

/* ============================================================
   VERIFICAR PREFIXO NO CAMPO NOME/CLIENTE DO CSV

   Exemplo:

   CSV:
   PG.P/INTERNET - ELGI COMPRESSORES DO BRASIL.

   Prefixo:
   ELGI

   Resultado:
   TRUE
============================================================ */

function clienteContemPrefixo(
  clienteCsv?: string | null,
  prefixo?: string | null
): boolean {
  const cliente =
    normalizarTexto(clienteCsv);

  const prefixoNormalizado =
    normalizarTexto(prefixo);

  if (
    !cliente ||
    !prefixoNormalizado
  ) {
    return false;
  }

  return cliente.includes(
    prefixoNormalizado
  );
}

/* ============================================================
   NORMALIZAR VALOR

   Aceita:

   10739
   "10739"
   "10.739,00"
   "R$ 10.739,00"
============================================================ */

function normalizarValor(
  valor: unknown
): number | null {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return null;
  }

  if (
    typeof valor === "number"
  ) {
    return Number.isFinite(valor)
      ? valor
      : null;
  }

  let texto = String(valor)
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");

  /*
   * Formato brasileiro.
   *
   * 10.739,00
   * ↓
   * 10739.00
   */
  if (texto.includes(",")) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  }

  texto = texto.replace(
    /[^0-9.-]/g,
    ""
  );

  const numero =
    Number(texto);

  return Number.isFinite(numero)
    ? numero
    : null;
}

/* ============================================================
   COMPARAR VALORES

   Tolerância:
   R$ 0,01
============================================================ */

function mesmoValor(
  valorA: unknown,
  valorB: unknown
): boolean {
  const a =
    normalizarValor(valorA);

  const b =
    normalizarValor(valorB);

  if (
    a === null ||
    b === null
  ) {
    return false;
  }

  return (
    Math.abs(a - b) <= 0.01
  );
}

/* ============================================================
   NORMALIZAR DATA

   04/09/2026
   ↓
   2026-09-04

   2026-09-04T03:00:00
   ↓
   2026-09-04
============================================================ */

function normalizarData(
  valor?: string | null
): string {
  if (!valor) {
    return "";
  }

  const texto =
    String(valor).trim();

  /* -------------------------
     DD/MM/YYYY
  ------------------------- */

  const br =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(
      texto
    );

  if (br) {
    const dia =
      br[1].padStart(2, "0");

    const mes =
      br[2].padStart(2, "0");

    const ano =
      br[3];

    return `${ano}-${mes}-${dia}`;
  }

  /* -------------------------
     YYYY-MM-DD / ISO
  ------------------------- */

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})/.exec(
      texto
    );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return "";
}

/* ============================================================
   ETAPA 2
   ENCONTRAR TÍTULOS CANDIDATOS

   REGRAS:

   M8 titulo.valor
   =
   CSV valor

   E

   Prefixo de fornecedorNome
   deve existir no Nome/Cliente CSV.
============================================================ */

function encontrarTitulosCandidatos(
  row: NormalizedCsvRow,
  titulos: M8ContaPagar[]
): M8ContaPagar[] {
  return titulos.filter(
    (titulo) => {
      /* -------------------------
         VALOR
      ------------------------- */

      const valorIgual =
        mesmoValor(
          row.valor,
          titulo.valor
        );

      if (!valorIgual) {
        return false;
      }

      /* -------------------------
         FORNECEDOR
      ------------------------- */

      const fornecedorNome =
        titulo.fornecedorNome ||
        titulo.pessoaCompraNome ||
        "";

      const prefixo =
        extrairPrefixo(
          fornecedorNome
        );

      if (!prefixo) {
        return false;
      }

      /* -------------------------
         CLIENTE CSV
      ------------------------- */

      return clienteContemPrefixo(
        row.cliente,
        prefixo
      );
    }
  );
}

/* ============================================================
   ETAPA 3
   ENCONTRAR PARCELAS

   REGRAS:

   M8 parcela.vencimento
   =
   CSV Data Pagamento

   E

   M8 parcela.valor
   =
   CSV Valor

   E

   prefixo parcela.pessoaNome
   deve existir no Nome/Cliente CSV.
============================================================ */

function encontrarParcelasCandidatas(
  row: NormalizedCsvRow,
  parcelas: M8Parcela[]
): M8Parcela[] {
  return parcelas.filter(
    (parcela) => {
      /* -------------------------
         DATA
      ------------------------- */

      const vencimentoM8 =
        normalizarData(
          parcela.vencimento
        );

      const pagamentoCsv =
        normalizarData(
          row.dataPagamento
        );

      if (
        !vencimentoM8 ||
        !pagamentoCsv ||
        vencimentoM8 !==
          pagamentoCsv
      ) {
        return false;
      }

      /* -------------------------
         VALOR
      ------------------------- */

      if (
        !mesmoValor(
          row.valor,
          parcela.valor
        )
      ) {
        return false;
      }

      /* -------------------------
         PESSOA
      ------------------------- */

      const pessoaNome =
        parcela.pessoaNome ||
        parcela.favorecidoNome ||
        "";

      const prefixoPessoa =
        extrairPrefixo(
          pessoaNome
        );

      if (!prefixoPessoa) {
        return false;
      }

      return clienteContemPrefixo(
        row.cliente,
        prefixoPessoa
      );
    }
  );
}

/* ============================================================
   ROTA POST
============================================================ */

export async function POST(
  request: Request
) {
  try {
    /* ========================================================
       RECEBER DADOS
    ======================================================== */

    const {
      company,
      rows,
    } = (await request.json()) as {
      company: number;
      rows: NormalizedCsvRow[];
    };

    /* ========================================================
       VALIDAR EMPRESA
    ======================================================== */

    if (
      !Number.isInteger(company) ||
      company <= 0
    ) {
      return NextResponse.json(
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
       VALIDAR CSV
    ======================================================== */

    if (
      !Array.isArray(rows) ||
      rows.length === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Nenhum registro recebido.",
        },
        {
          status: 400,
        }
      );
    }

    console.log("");
    console.log(
      "=============================================="
    );

    console.log(
      "[CONCILIAÇÃO] INICIANDO"
    );

    console.log(
      "[CONCILIAÇÃO] Empresa:",
      company
    );

    console.log(
      "[CONCILIAÇÃO] Linhas CSV:",
      rows.length
    );

    console.log(
      "=============================================="
    );

    /* ========================================================
       ETAPA 1
       AUTENTICAÇÃO
    ======================================================== */

    console.log("");
    console.log(
      "[ETAPA 1] Autenticando no M8..."
    );

    const token =
      await autenticarM8(
        company
      );

    console.log(
      "[ETAPA 1] Autenticação OK."
    );

    /* ========================================================
       ETAPA 2
       CARREGAR CONTAS A PAGAR

       IMPORTANTE:
       Esta consulta acontece UMA VEZ.
    ======================================================== */

    console.log("");
    console.log(
      "[ETAPA 2] Buscando Contas a Pagar..."
    );

    const inicioTitulos =
      Date.now();

    const titulos =
      await listarContasPagar(
        token
      );

    const tempoTitulos =
      Date.now() -
      inicioTitulos;

    console.log(
      "[ETAPA 2] Títulos recebidos:",
      titulos.length
    );

    console.log(
      "[ETAPA 2] Tempo:",
      `${tempoTitulos} ms`
    );

    /* ========================================================
       DIAGNÓSTICO ESPECÍFICO
       TÍTULO 43424 - ELGI
    ======================================================== */

    const tituloTeste =
      titulos.find(
        (titulo) =>
          Number(titulo.id) ===
          43424
      );

    console.log("");
    console.log(
      "========== DIAGNÓSTICO ELGI =========="
    );

    console.log(
      "Título 43424 recebido:",
      tituloTeste
        ? "SIM"
        : "NÃO"
    );

    if (tituloTeste) {
      console.log(
        "ID:",
        tituloTeste.id
      );

      console.log(
        "Fornecedor:",
        tituloTeste.fornecedorNome
      );

      console.log(
        "Prefixo:",
        extrairPrefixo(
          tituloTeste.fornecedorNome
        )
      );

      console.log(
        "Valor:",
        tituloTeste.valor
      );
    }

    const titulos10739 =
      titulos.filter(
        (titulo) =>
          mesmoValor(
            titulo.valor,
            10739
          )
      );

    console.log(
      "Títulos com valor 10739:",
      titulos10739.length
    );

    console.log(
      "======================================="
    );

    /* ========================================================
       RESULTADOS
    ======================================================== */

    const results: any[] = [];

    /* ========================================================
       PROCESSAMENTO LINHA A LINHA

       LINHA 1
       ↓
       TÍTULO
       ↓
       PARCELA
       ↓
       RESULTADO

       DEPOIS LINHA 2...
    ======================================================== */

    for (
      let indice = 0;
      indice < rows.length;
      indice++
    ) {
      const row =
        rows[indice];

      console.log("");
      console.log(
        "=============================================="
      );

      console.log(
        `[CSV] PROCESSANDO ${indice + 1}/${rows.length}`
      );

      console.log(
        "Linha CSV:",
        row.numeroLinha
      );

      console.log(
        "Cliente/Nome:",
        row.cliente
      );

      console.log(
        "Valor:",
        row.valor
      );

      console.log(
        "Data Pagamento:",
        row.dataPagamento
      );

      console.log(
        "Documento:",
        row.documento
      );

      console.log(
        "=============================================="
      );

      try {
        /* ====================================================
           VALIDAR DADOS MÍNIMOS
        ==================================================== */

        if (
          row.valor == null ||
          !row.cliente ||
          !row.dataPagamento
        ) {
          console.log(
            "[CSV] Dados obrigatórios ausentes."
          );

          results.push({
            rowId:
              row.rowId,

            status:
              "erro",

            statusMensagem:
              "Cliente/Nome, Data Pagamento ou Valor ausente no CSV.",
          });

          continue;
        }

        /* ====================================================
           ETAPA 2
           FILTRAR TÍTULOS
        ==================================================== */

        console.log(
          "[ETAPA 2] Procurando título por Valor + Cliente..."
        );

        const candidatos =
          encontrarTitulosCandidatos(
            row,
            titulos
          );

        console.log(
          "[ETAPA 2] Títulos candidatos:",
          candidatos.length
        );

        /* ====================================================
           DIAGNÓSTICO
           TÍTULOS COM MESMO VALOR
        ==================================================== */

        const titulosMesmoValor =
          titulos.filter(
            (titulo) =>
              mesmoValor(
                row.valor,
                titulo.valor
              )
          );

        console.log(
          "[ETAPA 2] Títulos somente pelo valor:",
          titulosMesmoValor.length
        );

        for (
          const titulo
          of titulosMesmoValor
        ) {
          const fornecedor =
            titulo.fornecedorNome ||
            titulo.pessoaCompraNome ||
            "";

          const prefixo =
            extrairPrefixo(
              fornecedor
            );

          const clienteOk =
            clienteContemPrefixo(
              row.cliente,
              prefixo
            );

          console.log(
            "[TESTE TÍTULO]",
            {
              tituloId:
                titulo.id,

              valorM8:
                titulo.valor,

              valorCsv:
                row.valor,

              fornecedor,

              prefixo,

              clienteCsv:
                row.cliente,

              clienteOk,
            }
          );
        }

        /* ====================================================
           NENHUM TÍTULO
        ==================================================== */

        if (
          candidatos.length === 0
        ) {
          console.log(
            "[ETAPA 2] Nenhum título candidato."
          );

          results.push({
            rowId:
              row.rowId,

            status:
              "nao_encontrado",

            statusMensagem:
              `Nenhum título encontrado por Valor + Cliente. ${titulosMesmoValor.length} título(s) encontrado(s) somente pelo valor.`,

            diagnostico: {
              clienteCsv:
                row.cliente,

              valorCsv:
                normalizarValor(
                  row.valor
                ),

              pagamentoCsv:
                normalizarData(
                  row.dataPagamento
                ),

              titulosMesmoValor:
                titulosMesmoValor
                  .slice(0, 20)
                  .map(
                    (titulo) => ({
                      tituloId:
                        titulo.id,

                      valor:
                        titulo.valor,

                      fornecedorNome:
                        titulo.fornecedorNome,

                      prefixo:
                        extrairPrefixo(
                          titulo.fornecedorNome
                        ),
                    })
                  ),
            },
          });

          /*
           * IMPORTANTE:
           *
           * Vai para a próxima linha
           * do CSV.
           */
          continue;
        }

        /* ====================================================
           ETAPA 3
           CONSULTAR PARCELAS

           SOMENTE DOS TÍTULOS CANDIDATOS
        ==================================================== */

        const encontrados: Array<{
          titulo: M8ContaPagar;
          parcela: M8Parcela;
        }> = [];

        for (
          const titulo
          of candidatos
        ) {
          console.log("");
          console.log(
            `[ETAPA 3] Consultando parcelas do título ${titulo.id}...`
          );

          const inicioParcelas =
            Date.now();

          const parcelas =
            await listarParcelas(
              token,
              titulo.id
            );

          const tempoParcelas =
            Date.now() -
            inicioParcelas;

          console.log(
            `[ETAPA 3] Título ${titulo.id}: ${parcelas.length} parcela(s)`
          );

          console.log(
            `[ETAPA 3] Tempo: ${tempoParcelas} ms`
          );

          /* ==================================================
             MOSTRAR TODAS AS PARCELAS
          ================================================== */

          for (
            const parcela
            of parcelas
          ) {
            const vencimentoM8 =
              normalizarData(
                parcela.vencimento
              );

            const pagamentoCsv =
              normalizarData(
                row.dataPagamento
              );

            const valorOk =
              mesmoValor(
                row.valor,
                parcela.valor
              );

            const pessoaNome =
              parcela.pessoaNome ||
              parcela.favorecidoNome ||
              "";

            const prefixoPessoa =
              extrairPrefixo(
                pessoaNome
              );

            const clienteOk =
              clienteContemPrefixo(
                row.cliente,
                prefixoPessoa
              );

            console.log(
              "[TESTE PARCELA]",
              {
                tituloId:
                  titulo.id,

                parcelaId:
                  parcela.id,

                vencimentoM8,

                pagamentoCsv,

                dataOk:
                  vencimentoM8 ===
                  pagamentoCsv,

                valorM8:
                  parcela.valor,

                valorCsv:
                  row.valor,

                valorOk,

                pessoaNome,

                prefixoPessoa,

                clienteCsv:
                  row.cliente,

                clienteOk,
              }
            );
          }

          /* ==================================================
             FILTRAR PARCELAS
          ================================================== */

          const parcelasEncontradas =
            encontrarParcelasCandidatas(
              row,
              parcelas
            );

          console.log(
            `[ETAPA 3] Parcelas coincidentes no título ${titulo.id}:`,
            parcelasEncontradas.length
          );

          for (
            const parcela
            of parcelasEncontradas
          ) {
            encontrados.push({
              titulo,
              parcela,
            });
          }
        }

        /* ====================================================
           EXATAMENTE UMA PARCELA
        ==================================================== */

        if (
          encontrados.length === 1
        ) {
          const {
            titulo,
            parcela,
          } = encontrados[0];

          console.log("");
          console.log(
            "******** PARCELA ENCONTRADA ********"
          );

          console.log(
            "Título ID:",
            titulo.id
          );

          console.log(
            "Parcela ID:",
            parcela.id
          );

          console.log(
            "************************************"
          );

          results.push({
            rowId:
              row.rowId,

            status:
              "pronto",

            statusMensagem:
              "Parcela encontrada e pronta para baixa.",

            tituloId:
              titulo.id,

            parcelaId:
              parcela.id,

            fornecedorNome:
              titulo.fornecedorNome ||
              titulo.pessoaCompraNome ||
              "",

            prefixoFornecedor:
              extrairPrefixo(
                titulo.fornecedorNome ||
                titulo.pessoaCompraNome
              ),

            pessoaNome:
              parcela.pessoaNome ||
              "",

            parcelaVencimento:
              parcela.vencimento ||
              "",

            parcelaValor:
              normalizarValor(
                parcela.valor
              ),

            parcelaSaldo:
              normalizarValor(
                parcela.saldo
              ),
          });

          /*
           * Finaliza esta linha.
           * Próxima iteração processa
           * a próxima linha do CSV.
           */
          continue;
        }

        /* ====================================================
           MAIS DE UMA PARCELA
        ==================================================== */

        if (
          encontrados.length > 1
        ) {
          console.log(
            "[CONFLITO]",
            encontrados.length,
            "parcelas encontradas."
          );

          results.push({
            rowId:
              row.rowId,

            status:
              "conflito",

            statusMensagem:
              `Conflito: ${encontrados.length} parcelas coincidem com Valor + Pagamento + Cliente.`,

            candidatos:
              encontrados.map(
                ({
                  titulo,
                  parcela,
                }) => ({
                  tituloId:
                    titulo.id,

                  parcelaId:
                    parcela.id,

                  fornecedorNome:
                    titulo.fornecedorNome,

                  pessoaNome:
                    parcela.pessoaNome,

                  vencimento:
                    parcela.vencimento,

                  valor:
                    parcela.valor,

                  saldo:
                    parcela.saldo,
                })
              ),
          });

          continue;
        }

        /* ====================================================
           TÍTULO ENCONTRADO
           MAS PARCELA NÃO
        ==================================================== */

        console.log(
          "[ETAPA 3] Título encontrado, mas nenhuma parcela coincidiu."
        );

        results.push({
          rowId:
            row.rowId,

          status:
            "nao_encontrado",

          statusMensagem:
            `${candidatos.length} título(s) encontrado(s) por Valor + Cliente, porém nenhuma parcela coincidiu com Data Pagamento + Valor + Cliente.`,

          titulosEncontrados:
            candidatos.map(
              (titulo) => ({
                tituloId:
                  titulo.id,

                fornecedorNome:
                  titulo.fornecedorNome,

                valor:
                  titulo.valor,
              })
            ),
        });
      } catch (error) {
        console.error(
          `[ERRO] Linha ${row.numeroLinha}:`,
          error
        );

        results.push({
          rowId:
            row.rowId,

          status:
            "erro",

          statusMensagem:
            error instanceof Error
              ? error.message
              : "Erro desconhecido na conciliação.",
        });
      }
    }

    /* ========================================================
       RESUMO
    ======================================================== */

    const prontos =
      results.filter(
        (item) =>
          item.status === "pronto"
      ).length;

    const naoEncontrados =
      results.filter(
        (item) =>
          item.status ===
          "nao_encontrado"
      ).length;

    const conflitos =
      results.filter(
        (item) =>
          item.status === "conflito"
      ).length;

    const erros =
      results.filter(
        (item) =>
          item.status === "erro"
      ).length;

    console.log("");
    console.log(
      "=============================================="
    );

    console.log(
      "[CONCILIAÇÃO] FINALIZADA"
    );

    console.log(
      "Linhas:",
      rows.length
    );

    console.log(
      "Prontas:",
      prontos
    );

    console.log(
      "Não encontradas:",
      naoEncontrados
    );

    console.log(
      "Conflitos:",
      conflitos
    );

    console.log(
      "Erros:",
      erros
    );

    console.log(
      "=============================================="
    );

    /* ========================================================
       RETORNO
    ======================================================== */

    return NextResponse.json({
      success: true,

      etapas: {
        etapa1: true,
        etapa2: true,
        etapa3: true,
      },

      diagnostico: {
        quantidadeLinhasCsv:
          rows.length,

        quantidadeTitulosM8:
          titulos.length,

        titulo43424Recebido:
          Boolean(tituloTeste),

        quantidadeTitulosValor10739:
          titulos10739.length,

        resumo: {
          prontos,
          naoEncontrados,
          conflitos,
          erros,
        },
      },

      results,
    });
  } catch (error) {
    console.error(
      "[ERRO GERAL CONCILIAÇÃO]",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro interno na conciliação.",
      },
      {
        status: 500,
      }
    );
  }
}