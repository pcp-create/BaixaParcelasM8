import { NextResponse } from "next/server";
import { autenticarM8, listarContasPagar, listarParcelas } from "@/lib/m8";
import { escolherParcela, titulosPorDocumento } from "@/lib/conciliacao";
import { NormalizedCsvRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { company, rows } = (await request.json()) as { company: number; rows: NormalizedCsvRow[] };
    if (!Number.isInteger(company) || company <= 0) return NextResponse.json({ error: "Empresa M8 inválida." }, { status: 400 });
    if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "Nenhum registro recebido." }, { status: 400 });

    // ETAPA 1
    const token = await autenticarM8(company);
    // ETAPA 2
    const titulos = await listarContasPagar(token);
    const results = [];

    for (const row of rows) {
      try {
        if (!row.documento || row.valor == null) {
          results.push({ rowId: row.rowId, status: "erro", statusMensagem: "Documento ou valor ausente no CSV." });
          continue;
        }
        const candidatos = titulosPorDocumento(row, titulos);
        if (candidatos.length === 0) {
          results.push({ rowId: row.rowId, status: "nao_encontrado", statusMensagem: "Título não encontrado pelo documento informado." });
          continue;
        }

        const encontrados: Array<{ titulo: any; parcela: any }> = [];
        for (const titulo of candidatos) {
          // ETAPA 3
          const parcelas = await listarParcelas(token, titulo.id);
          const match = escolherParcela(row, titulo, parcelas);
          if (match.parcela) encontrados.push({ titulo, parcela: match.parcela });
        }

        if (encontrados.length === 1) {
          const { titulo, parcela } = encontrados[0];
          results.push({
            rowId: row.rowId,
            status: "pronto",
            statusMensagem: "Parcela encontrada e pronta para baixa.",
            tituloId: titulo.id,
            parcelaId: parcela.id,
            fornecedorNome: titulo.fornecedorNome || titulo.pessoaCompraNome || "",
            parcelaValor: Number(parcela.valor ?? 0),
            parcelaSaldo: Number(parcela.saldo ?? parcela.valor ?? 0)
          });
        } else if (encontrados.length > 1) {
          results.push({ rowId: row.rowId, status: "conflito", statusMensagem: `Conflito: ${encontrados.length} títulos/parcelas coincidem com o CSV.` });
        } else {
          results.push({ rowId: row.rowId, status: "nao_encontrado", statusMensagem: "Título localizado, mas nenhuma parcela coincidiu com valor e vencimento." });
        }
      } catch (error) {
        results.push({ rowId: row.rowId, status: "erro", statusMensagem: error instanceof Error ? error.message : "Erro desconhecido na conciliação." });
      }
    }

    return NextResponse.json({ success: true, etapas: { etapa1: true, etapa2: true, etapa3: true }, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro interno na conciliação." }, { status: 500 });
  }
}
