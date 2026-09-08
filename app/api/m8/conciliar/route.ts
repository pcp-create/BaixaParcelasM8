import { NextResponse } from "next/server";
import { autenticarM8, listarContasPagar, listarParcelas } from "@/lib/m8";
import {
  M8ContaPagar,
  M8Parcela,
  NormalizedCsvRow,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Normaliza textos para comparação:
 * - remove acentos
 * - converte para maiúsculas
 * - remove espaços duplicados
 */
function normalizarTexto(valor?: string | null): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exemplo:
 *
 * "21695 - ELGI COMPRESSORES DO BRASIL IMP. EXP.LTD - 10560347000142"
 *
 * Retorna:
 *
 * "ELGI"
 */
function extrairPrefixoFornecedor(valor?: string | null): string {
  const texto = String(valor ?? "").trim();

  if (!texto) {
    return "";
  }

  // Divide pelo separador " - "
  const partes = texto
    .split(/\s+-\s+/)
    .map((parte) => parte.trim())
    .filter(Boolean);

  /**
   * Formato esperado do M8:
   *
   * CODIGO - NOME DO FORNECEDOR - CNPJ
   *
   * partes[0] = código
   * partes[1] = nome fornecedor
   */
  const nomeFornecedor =
    partes.length >= 2
      ? partes[1]
      : texto;

  // Pega somente a primeira palavra
  const primeiraPalavra =
    nomeFornecedor
      .split(/\s+/)
      .filter(Boolean)[0] ?? "";

  return normalizarTexto(primeiraPalavra);
}

/**
 * Verifica se o prefixo do fornecedor M8
 * existe no campo Cliente do CSV.
 *
 * Exemplo:
 *
 * prefixo = ELGI
 * cliente = ELGI COMPRESSORES
 *
 * => true
 */
function clienteContemPrefixo(
  clienteCsv?: string | null,
  prefixo?: string | null
): boolean {
  const cliente = normalizarTexto(clienteCsv);
  const prefixoNormalizado = normalizarTexto(prefixo);

  if (!cliente || !prefixoNormalizado) {
    return false;
  }

  return cliente.includes(prefixoNormalizado);
}

/**
 * Comparação monetária com tolerância de 1 centavo.
 */
function mesmoValor(
  valorA?: number | null,
  valorB?: number | null
): boolean {
  if (valorA == null || valorB == null) {
    return false;
  }

  return Math.abs(Number(valorA) - Number(valorB)) <= 0.01;
}

/**
 * Normaliza uma data para YYYY-MM-DD.
 *
 * Aceita:
 * 2026-09-19T00:00:00Z
 * 2026-09-19
 * 19/09/2026
 */
function normalizarData(valor?: string | null): string {
  if (!valor) {
    return "";
  }

  const texto = String(valor).trim();

  // DD/MM/YYYY
  const br = texto.match(
    /^(\d{2})\/(\d{2})\/(\d{4})/
  );

  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }

  // YYYY-MM-DD ou ISO
  const iso = texto.match(
    /^(\d{4})-(\d{2})-(\d{2})/
  );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return texto;
}

/**
 * ETAPA 2
 *
 * Localiza títulos candidatos utilizando:
 *
 * M8 titulo.valor
 *      =
 * CSV row.valor
 *
 * +
 *
 * prefixo titulo.fornecedorNome
 *      encontrado em
 * CSV row.cliente
 */
function encontrarTitulosCandidatos(
  row: NormalizedCsvRow,
  titulos: M8ContaPagar[]
): M8ContaPagar[] {
  return titulos.filter((titulo) => {
    const valorTitulo = Number(titulo.valor ?? 0);

    if (!mesmoValor(row.valor, valorTitulo)) {
      return false;
    }

    const nomeFornecedor =
      titulo.fornecedorNome ||
      titulo.pessoaCompraNome ||
      "";

    const prefixo =
      extrairPrefixoFornecedor(nomeFornecedor);

    if (!prefixo) {
      return false;
    }

    return clienteContemPrefixo(
      row.cliente,
      prefixo
    );
  });
}

/**
 * ETAPA 3
 *
 * Localiza parcelas utilizando:
 *
 * parcela.vencimento
 *      =
 * CSV row.dataPagamento
 *
 * parcela.valor
 *      =
 * CSV row.valor
 *
 * prefixo parcela.pessoaNome
 *      encontrado em
 * CSV row.cliente
 */
function encontrarParcelasCandidatas(
  row: NormalizedCsvRow,
  parcelas: M8Parcela[]
): M8Parcela[] {
  return parcelas.filter((parcela) => {
    // -------------------------------------------------
    // 1. Vencimento x Pagamento CSV
    // -------------------------------------------------

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

    // -------------------------------------------------
    // 2. Valor
    // -------------------------------------------------

    const valorParcela =
      Number(parcela.valor ?? 0);

    if (
      !mesmoValor(
        row.valor,
        valorParcela
      )
    ) {
      return false;
    }

    // -------------------------------------------------
    // 3. Pessoa / Cliente
    // -------------------------------------------------

    const nomePessoa =
      parcela.pessoaNome ||
      parcela.favorecidoNome ||
      "";

    const prefixo =
      extrairPrefixoFornecedor(nomePessoa);

    if (!prefixo) {
      return false;
    }

    return clienteContemPrefixo(
      row.cliente,
      prefixo
    );
  });
}

export async function POST(
  request: Request
) {
  try {
    const { company, rows } =
      (await request.json()) as {
        company: number;
        rows: NormalizedCsvRow[];
      };

    // =================================================
    // VALIDAÇÕES
    // =================================================

    if (
      !Number.isInteger(company) ||
      company <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Empresa M8 inválida.",
        },
        { status: 400 }
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
        { status: 400 }
      );
    }

    // =================================================
    // ETAPA 1 — AUTENTICAÇÃO
    // =================================================

    const token =
      await autenticarM8(company);

    // =================================================
    // ETAPA 2 — LISTAR CONTAS A PAGAR
    // =================================================

    const titulos =
      await listarContasPagar(token);

    const results = [];

    // =================================================
    // PROCESSAR CADA LINHA DO CSV
    // =================================================

    for (const row of rows) {
      try {
        // ---------------------------------------------
        // Validar dados mínimos do CSV
        // ---------------------------------------------

        if (
          row.valor == null ||
          !row.cliente ||
          !row.dataPagamento
        ) {
          results.push({
            rowId: row.rowId,

            status: "erro",

            statusMensagem:
              "Cliente, pagamento ou valor ausente no CSV.",
          });

          continue;
        }

        // =============================================
        // ETAPA 2
        // ENCONTRAR TÍTULOS
        // =============================================

        const candidatos =
          encontrarTitulosCandidatos(
            row,
            titulos
          );

        if (
          candidatos.length === 0
        ) {
          results.push({
            rowId: row.rowId,

            status:
              "nao_encontrado",

            statusMensagem:
              "Nenhum título encontrado com o mesmo valor e fornecedor/cliente.",
          });

          continue;
        }

        // =============================================
        // ETAPA 3
        // CONSULTAR PARCELAS DOS TÍTULOS CANDIDATOS
        // =============================================

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

          const parcelasEncontradas =
            encontrarParcelasCandidatas(
              row,
              parcelas
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

        // =============================================
        // RESULTADO ÚNICO
        // =============================================

        if (
          encontrados.length === 1
        ) {
          const {
            titulo,
            parcela,
          } = encontrados[0];

          const fornecedorNome =
            titulo.fornecedorNome ||
            titulo.pessoaCompraNome ||
            "";

          const prefixoFornecedor =
            extrairPrefixoFornecedor(
              fornecedorNome
            );

          results.push({
            rowId: row.rowId,

            status: "pronto",

            statusMensagem:
              "Parcela encontrada e pronta para baixa.",

            tituloId:
              titulo.id,

            parcelaId:
              parcela.id,

            fornecedorNome,

            prefixoFornecedor,

            pessoaNome:
              parcela.pessoaNome ||
              "",

            parcelaVencimento:
              parcela.vencimento ||
              "",

            parcelaValor:
              Number(
                parcela.valor ?? 0
              ),

            parcelaSaldo:
              Number(
                parcela.saldo ??
                parcela.valor ??
                0
              ),
          });

          continue;
        }

        // =============================================
        // CONFLITO
        // =============================================

        if (
          encontrados.length > 1
        ) {
          results.push({
            rowId: row.rowId,

            status: "conflito",

            statusMensagem:
              `Conflito: ${encontrados.length} parcelas coincidem com Cliente, Valor e Pagamento do CSV.`,

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
                    titulo.fornecedorNome ||
                    titulo.pessoaCompraNome ||
                    "",

                  pessoaNome:
                    parcela.pessoaNome ||
                    "",

                  vencimento:
                    parcela.vencimento,

                  valor:
                    parcela.valor,
                })
              ),
          });

          continue;
        }

        // =============================================
        // TÍTULO ENCONTRADO,
        // MAS PARCELA NÃO
        // =============================================

        results.push({
          rowId: row.rowId,

          status:
            "nao_encontrado",

          statusMensagem:
            `Foram encontrados ${candidatos.length} título(s) pelo Valor + Cliente, mas nenhuma parcela coincidiu com Pagamento + Valor + Cliente.`,
        });
      } catch (error) {
        results.push({
          rowId: row.rowId,

          status: "erro",

          statusMensagem:
            error instanceof Error
              ? error.message
              : "Erro desconhecido na conciliação.",
        });
      }
    }

    return NextResponse.json({
      success: true,

      etapas: {
        etapa1: true,
        etapa2: true,
        etapa3: true,
      },

      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro interno na conciliação.",
      },
      { status: 500 }
    );
  }
}