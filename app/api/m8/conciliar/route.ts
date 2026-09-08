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

function normalizarTexto(valor?: string | null): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   EXTRAIR PREFIXO DO NOME

   Exemplos:

   "21695 - ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD - 105..."
       ↓
   "ELGI"

   "ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD"
       ↓
   "ELGI"
============================================================ */

function extrairPrefixo(valor?: string | null): string {
  const texto = normalizarTexto(valor);

  if (!texto) {
    return "";
  }

  let nome = texto;

  /*
   * Se começar com:
   *
   * 21695 - ELGI...
   *
   * remove código inicial.
   */
  nome = nome.replace(/^\d+\s*-\s*/, "");

  /*
   * Agora:
   *
   * ELGI COMPRESSORES...
   *
   * Retorna primeira palavra.
   */
  return nome.split(/\s+/)[0] ?? "";
}

/* ============================================================
   CLIENTE CONTÉM PREFIXO
============================================================ */

function clienteContemPrefixo(
  clienteCsv?: string | null,
  prefixo?: string | null
): boolean {
  const cliente = normalizarTexto(clienteCsv);
  const prefixoNormalizado = normalizarTexto(prefixo);

  if (!cliente || !prefixoNormalizado) {
    return false;
  }

  /*
   * Evita falsos positivos como:
   *
   * prefixo = ABC
   * cliente = XABCY
   *
   * Procura a palavra.
   */
  const palavrasCliente = cliente.split(/[^A-Z0-9]+/).filter(Boolean);

  return palavrasCliente.includes(prefixoNormalizado);
}

/* ============================================================
   NORMALIZAR VALOR
============================================================ */

function normalizarValor(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }

  let texto = String(valor)
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "");

  /*
   * Brasileiro:
   *
   * 10.739,00
   * 10739,00
   */
  if (texto.includes(",")) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  }

  const numero = Number(texto);

  return Number.isFinite(numero)
    ? numero
    : null;
}

/* ============================================================
   COMPARAR VALORES
============================================================ */

function mesmoValor(
  valorA: unknown,
  valorB: unknown
): boolean {
  const a = normalizarValor(valorA);
  const b = normalizarValor(valorB);

  if (a === null || b === null) {
    return false;
  }

  return Math.abs(a - b) <= 0.01;
}

/* ============================================================
   NORMALIZAR DATA
============================================================ */

function normalizarData(valor?: string | null): string {
  if (!valor) {
    return "";
  }

  const texto = String(valor).trim();

  /*
   * DD/MM/YYYY
   */
  const formatoBR = texto.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})/
  );

  if (formatoBR) {
    const dia =
      formatoBR[1].padStart(2, "0");

    const mes =
      formatoBR[2].padStart(2, "0");

    const ano =
      formatoBR[3];

    return `${ano}-${mes}-${dia}`;
  }

  /*
   * ISO:
   *
   * 2026-09-04
   * 2026-09-04T03:00:00
   */
  const formatoISO = texto.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (formatoISO) {
    return `${formatoISO[1]}-${formatoISO[2]}-${formatoISO[3]}`;
  }

  return "";
}

/* ============================================================
   ETAPA 2
   ENCONTRAR TÍTULOS
============================================================ */

function encontrarTitulosCandidatos(
  row: NormalizedCsvRow,
  titulos: M8ContaPagar[]
): M8ContaPagar[] {

  return titulos.filter((titulo) => {

    /* -------------------------
       VALOR
    ------------------------- */

    if (
      !mesmoValor(
        row.valor,
        titulo.valor
      )
    ) {
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
      extrairPrefixo(fornecedorNome);

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
  });
}

/* ============================================================
   ETAPA 3
   ENCONTRAR PARCELA
============================================================ */

function encontrarParcelasCandidatas(
  row: NormalizedCsvRow,
  parcelas: M8Parcela[]
): M8Parcela[] {

  return parcelas.filter((parcela) => {

    /* -------------------------
       VENCIMENTO
       x
       PAGAMENTO CSV
    ------------------------- */

    const vencimentoM8 =
      normalizarData(parcela.vencimento);

    const pagamentoCsv =
      normalizarData(row.dataPagamento);

    if (
      !vencimentoM8 ||
      !pagamentoCsv ||
      vencimentoM8 !== pagamentoCsv
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
      extrairPrefixo(pessoaNome);

    if (!prefixoPessoa) {
      return false;
    }

    return clienteContemPrefixo(
      row.cliente,
      prefixoPessoa
    );
  });
}

/* ============================================================
   POST
============================================================ */

export async function POST(
  request: Request
) {
  try {

    const { company, rows } =
      (await request.json()) as {
        company: number;
        rows: NormalizedCsvRow[];
      };

    /* ========================================================
       VALIDAÇÕES
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

    /* ========================================================
       ETAPA 1
       AUTENTICAÇÃO
    ======================================================== */

    const token =
      await autenticarM8(company);

    /* ========================================================
       ETAPA 2
       LISTAR TÍTULOS
    ======================================================== */

    const titulos =
      await listarContasPagar(token);

    console.log(
      `[CONCILIACAO] ${titulos.length} títulos recebidos do M8`
    );

    /*
     * Diagnóstico específico.
     *
     * Confirma se o título informado por você
     * realmente chegou da API.
     */
    const titulo43424 =
      titulos.find(
        (titulo) =>
          Number(titulo.id) === 43424
      );

    console.log(
      "[DIAGNOSTICO] Título 43424 recebido:",
      titulo43424 ?? "NÃO RECEBIDO"
    );

    const results = [];

    /* ========================================================
       PROCESSAR CSV
    ======================================================== */

    for (const row of rows) {

      try {

        /* ====================================================
           DIAGNÓSTICO DO CSV
        ==================================================== */

        console.log(
          "[CSV]",
          {
            rowId:
              row.rowId,

            cliente:
              row.cliente,

            valorOriginal:
              row.valor,

            valorNormalizado:
              normalizarValor(
                row.valor
              ),

            pagamento:
              row.dataPagamento,

            pagamentoNormalizado:
              normalizarData(
                row.dataPagamento
              ),
          }
        );

        /* ====================================================
           VALIDAR CSV
        ==================================================== */

        if (
          row.valor == null ||
          !row.cliente ||
          !row.dataPagamento
        ) {

          results.push({
            rowId:
              row.rowId,

            status:
              "erro",

            statusMensagem:
              "Cliente, Pagamento ou Valor ausente no CSV.",
          });

          continue;
        }

        /* ====================================================
           ETAPA 2
           LOCALIZAR TÍTULOS
        ==================================================== */

        const candidatos =
          encontrarTitulosCandidatos(
            row,
            titulos
          );

        console.log(
          `[ETAPA 2] Linha ${row.rowId}: ${candidatos.length} título(s) candidato(s).`,
          candidatos.map(
            (titulo) => ({
              id:
                titulo.id,

              fornecedor:
                titulo.fornecedorNome,

              prefixo:
                extrairPrefixo(
                  titulo.fornecedorNome
                ),

              valor:
                titulo.valor,
            })
          )
        );

        if (
          candidatos.length === 0
        ) {

          /*
           * Diagnóstico adicional:
           *
           * procura somente pelo valor para sabermos
           * se o problema foi Cliente ou Valor.
           */
          const mesmoValorEncontrados =
            titulos.filter(
              (titulo) =>
                mesmoValor(
                  row.valor,
                  titulo.valor
                )
            );

          results.push({
            rowId:
              row.rowId,

            status:
              "nao_encontrado",

            statusMensagem:
              `Nenhum título encontrado por Valor + Cliente. Foram encontrados ${mesmoValorEncontrados.length} título(s) somente pelo valor.`,

            diagnostico: {
              clienteCsv:
                row.cliente,

              valorCsv:
                normalizarValor(
                  row.valor
                ),

              titulosMesmoValor:
                mesmoValorEncontrados
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

          continue;
        }

        /* ====================================================
           ETAPA 3
           CONSULTAR PARCELAS
        ==================================================== */

        const encontrados: Array<{
          titulo: M8ContaPagar;
          parcela: M8Parcela;
        }> = [];

        for (
          const titulo of candidatos
        ) {

          const parcelas =
            await listarParcelas(
              token,
              titulo.id
            );

          console.log(
            `[ETAPA 3] Título ${titulo.id}: ${parcelas.length} parcela(s) recebida(s).`
          );

          for (
            const parcela of parcelas
          ) {

            console.log(
              "[PARCELA]",
              {
                tituloId:
                  titulo.id,

                parcelaId:
                  parcela.id,

                vencimento:
                  parcela.vencimento,

                vencimentoNormalizado:
                  normalizarData(
                    parcela.vencimento
                  ),

                pagamentoCsv:
                  normalizarData(
                    row.dataPagamento
                  ),

                valorParcela:
                  parcela.valor,

                valorCsv:
                  normalizarValor(
                    row.valor
                  ),

                pessoaNome:
                  parcela.pessoaNome,

                prefixoPessoa:
                  extrairPrefixo(
                    parcela.pessoaNome
                  ),

                clienteCsv:
                  row.cliente,
              }
            );
          }

          const matches =
            encontrarParcelasCandidatas(
              row,
              parcelas
            );

          for (
            const parcela of matches
          ) {
            encontrados.push({
              titulo,
              parcela,
            });
          }
        }

        /* ====================================================
           UMA PARCELA
        ==================================================== */

        if (
          encontrados.length === 1
        ) {

          const {
            titulo,
            parcela,
          } = encontrados[0];

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
              "",

            prefixoFornecedor:
              extrairPrefixo(
                titulo.fornecedorNome
              ),

            pessoaNome:
              parcela.pessoaNome ||
              "",

            parcelaVencimento:
              parcela.vencimento,

            parcelaValor:
              normalizarValor(
                parcela.valor
              ),

            parcelaSaldo:
              normalizarValor(
                parcela.saldo
              ),
          });

          continue;
        }

        /* ====================================================
           CONFLITO
        ==================================================== */

        if (
          encontrados.length > 1
        ) {

          results.push({
            rowId:
              row.rowId,

            status:
              "conflito",

            statusMensagem:
              `Conflito: ${encontrados.length} parcelas coincidem com Cliente + Valor + Pagamento.`,

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
                })
              ),
          });

          continue;
        }

        /* ====================================================
           NENHUMA PARCELA
        ==================================================== */

        results.push({
          rowId:
            row.rowId,

          status:
            "nao_encontrado",

          statusMensagem:
            `${candidatos.length} título(s) encontrado(s), porém nenhuma parcela coincidiu com Pagamento + Valor + Cliente.`,

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
        quantidadeTitulosM8:
          titulos.length,

        titulo43424Recebido:
          Boolean(titulo43424),
      },

      results,
    });

  } catch (error) {

    console.error(
      "[CONCILIACAO ERRO]",
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