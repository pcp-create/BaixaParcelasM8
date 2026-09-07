import { NextResponse } from "next/server";
import { autenticarM8, baixarParcela } from "@/lib/m8";
import { BankM8Config, NormalizedCsvRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { company, rows, config } = (await request.json()) as {
      company: number;
      rows: NormalizedCsvRow[];
      config: BankM8Config;
    };
    if (!Number.isInteger(company) || company <= 0) return NextResponse.json({ error: "Empresa M8 inválida." }, { status: 400 });
    if (!config || config.contaContabilId <= 0 || config.historicoId <= 0 || config.meioPagamentoId <= 0) {
      return NextResponse.json({ error: "Configure Conta Contábil ID, Histórico ID e Meio de Pagamento ID antes de efetuar baixas." }, { status: 400 });
    }

    const aptas = (rows || []).filter((r) => r.status === "pronto" && r.tituloId && r.parcelaId && r.valor != null);
    if (aptas.length === 0) return NextResponse.json({ error: "Não existem parcelas prontas para baixa." }, { status: 400 });

    const token = await autenticarM8(company);
    const results = [];

    for (const row of aptas) {
      try {
        const data = row.dataPagamento ? `${row.dataPagamento}T12:00:00Z` : new Date().toISOString();
        const payload = {
          data,
          contaContabilId: Number(config.contaContabilId),
          historicoId: Number(config.historicoId),
          meioPagamentoId: Number(config.meioPagamentoId),
          valor: Number(row.valor),
          chequeId: 0,
          valorJuros: 0,
          valorMulta: 0,
          valorDesconto: 0,
          taxaOperadoraCartao: 0,
          observacaoInterna: config.observacaoInterna || "Baixa automática via conciliação bancária",
          complemento: config.complemento || ""
        };
        await baixarParcela(token, Number(row.tituloId), Number(row.parcelaId), payload);
        results.push({ rowId: row.rowId, status: "baixada", statusMensagem: "Parcela Baixada" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro desconhecido";
        results.push({ rowId: row.rowId, status: "erro", statusMensagem: `Erro ao Baixar Parcela (${message})`, apiError: message });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro interno ao efetuar baixas." }, { status: 500 });
  }
}
