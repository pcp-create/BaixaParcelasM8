"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import defaultBanks from "@/data/bancos.json";
import { BankConfig, NormalizedCsvRow } from "@/lib/types";
import { normalizeRows, parseCsv } from "@/lib/csv";
import StatusBadge from "./StatusBadge";
import BankConfigModal from "./BankConfigModal";

const STORAGE_KEY = "conciliacao-m8-bancos-v1";

function money(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}
function dateBr(v: string) {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

export default function MainApp() {
  const [banks, setBanks] = useState<BankConfig[]>(defaultBanks as BankConfig[]);
  const [bankId, setBankId] = useState("banco-teste");
  const [company, setCompany] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Array<{ numeroLinha: number; values: Record<string, string> }>>([]);
  const [rows, setRows] = useState<NormalizedCsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { try { setBanks(JSON.parse(saved)); } catch {} }
  }, []);
  const bank = banks.find((b) => b.id === bankId) || banks[0];
  useEffect(() => { if (rawRows.length && bank) setRows(normalizeRows(rawRows, bank)); }, [bankId]);

  const counts = useMemo(() => ({
    total: rows.length,
    pronto: rows.filter((r) => r.status === "pronto").length,
    baixada: rows.filter((r) => r.status === "baixada").length,
    erro: rows.filter((r) => ["erro", "nao_encontrado", "conflito"].includes(r.status)).length,
    valorPronto: rows.filter((r) => r.status === "pronto").reduce((a, r) => a + (r.valor || 0), 0)
  }), [rows]);
  const filtered = rows.filter((r) => !query || JSON.stringify(r.original).toLowerCase().includes(query.toLowerCase()) || r.statusMensagem.toLowerCase().includes(query.toLowerCase()));

  async function chooseFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setMessage("Selecione um arquivo .CSV."); return; }
    try {
      const text = await file.text(); const parsed = parseCsv(text);
      setHeaders(parsed.headers); setRawRows(parsed.rows); setFileName(file.name); setMessage(`Arquivo carregado: ${parsed.rows.length} registro(s). Delimitador detectado: ${parsed.delimiter === "\t" ? "TAB" : parsed.delimiter}`);
      setRows(normalizeRows(parsed.rows, bank));
    } catch (err) { setMessage(err instanceof Error ? err.message : "Falha ao ler CSV."); }
  }

  function saveBank(updated: BankConfig) {
    const next = banks.map((b) => b.id === updated.id ? updated : b);
    setBanks(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setShowConfig(false);
    if (rawRows.length) setRows(normalizeRows(rawRows, updated));
    setMessage("Configuração do banco salva neste navegador.");
  }

  function newBank() {
    const id = `banco-${Date.now()}`;
    const empty: BankConfig = { id, nome: "Novo Banco", mapping: { cliente: "", dataVencimento: "", dataPagamento: "", documento: "", valor: "" }, m8: { contaContabilId: 0, historicoId: 0, meioPagamentoId: 0, observacaoInterna: "Baixa automática via conciliação bancária", complemento: "" } };
    const next = [...banks, empty]; setBanks(next); setBankId(id); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); setShowConfig(true);
  }

  async function conciliar() {
    if (!rows.length) return setMessage("Importe um CSV antes de conciliar.");
    if (!bank.mapping.documento || !bank.mapping.valor) return setMessage("Configure as colunas obrigatórias do banco.");
    setBusy(true); setMessage("Executando ETAPA 1, ETAPA 2 e ETAPA 3...");
    setRows((old) => old.map((r) => ({ ...r, status: "conciliando", statusMensagem: "Consultando M8..." })));
    try {
      const response = await fetch("/api/m8/conciliar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, rows }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Falha na conciliação.");
      setRows((old) => old.map((r) => ({ ...r, ...(data.results.find((x: any) => x.rowId === r.rowId) || {}) })));
      setMessage("Conciliação concluída. Revise os registros antes de efetuar a baixa.");
    } catch (err) { setRows((old) => old.map((r) => r.status === "conciliando" ? { ...r, status: "erro", statusMensagem: "Conciliação interrompida." } : r)); setMessage(err instanceof Error ? err.message : "Erro na conciliação."); }
    finally { setBusy(false); }
  }

  async function baixar() {
    const aptas = rows.filter((r) => r.status === "pronto");
    if (!aptas.length) return setMessage("Não existem parcelas prontas para baixa.");
    if (!confirm(`Confirma a baixa de ${aptas.length} parcela(s), totalizando ${money(aptas.reduce((a, r) => a + (r.valor || 0), 0))}?`)) return;
    setBusy(true); setMessage("Executando ETAPA 4 — Baixa de parcelas...");
    try {
      const response = await fetch("/api/m8/baixar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, rows: aptas, config: bank.m8 }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Falha ao efetuar baixas.");
      setRows((old) => old.map((r) => ({ ...r, ...(data.results.find((x: any) => x.rowId === r.rowId) || {}) })));
      setMessage("Processamento de baixa concluído.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Erro na baixa."); }
    finally { setBusy(false); }
  }

  return <main className="container">
    <header className="page-header"><div><div className="eyebrow">FINANCEIRO · ERP M8</div><h1>Conciliação e Baixa de Parcelas</h1><p>Importe o extrato bancário, concilie com as contas a pagar e execute as baixas de forma controlada.</p></div><div className="brand">RJ <span>Compressores</span></div></header>

    <section className="panel controls">
      <label>Empresa M8<input type="number" min="1" value={company} onChange={(e) => setCompany(Number(e.target.value) || 1)} /></label>
      <label>Banco<select value={bankId} onChange={(e) => setBankId(e.target.value)}>{banks.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}</select></label>
      <div className="button-stack"><button className="button secondary" onClick={() => setShowConfig(true)}>Configurar banco</button><button className="link-button" onClick={newBank}>+ Adicionar banco</button></div>
      <label className="file-control">Arquivo CSV<input type="file" accept=".csv,text/csv" onChange={chooseFile} /><span>{fileName || "Selecionar arquivo CSV"}</span></label>
    </section>

    {message && <div className="notice">{message}</div>}

    <section className="stats">
      <div className="stat"><span>Registros</span><strong>{counts.total}</strong></div>
      <div className="stat"><span>Prontos para baixa</span><strong>{counts.pronto}</strong></div>
      <div className="stat"><span>Baixados</span><strong>{counts.baixada}</strong></div>
      <div className="stat"><span>Pendências / erros</span><strong>{counts.erro}</strong></div>
      <div className="stat accent"><span>Valor pronto</span><strong>{money(counts.valorPronto)}</strong></div>
    </section>

    <section className="panel">
      <div className="toolbar"><div><h2>Registros importados</h2><p>O sistema exige correspondência segura antes de permitir a baixa.</p></div><div className="toolbar-actions"><input className="search" placeholder="Filtrar tabela..." value={query} onChange={(e) => setQuery(e.target.value)} /><button className="button secondary" disabled={busy || !rows.length} onClick={conciliar}>1. Conciliar no M8</button><button className="button primary" disabled={busy || counts.pronto === 0} onClick={baixar}>2. Efetuar baixas ({counts.pronto})</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Linha</th><th>Cliente</th><th>Documento</th><th>Vencimento</th><th>Pagamento</th><th className="right">Valor CSV</th><th>Título M8</th><th>Parcela M8</th><th>Status Integração</th><th>Retorno</th></tr></thead><tbody>
        {filtered.length === 0 ? <tr><td colSpan={10} className="empty">Importe um arquivo CSV para visualizar os registros.</td></tr> : filtered.map((r) => <tr key={r.rowId}><td>{r.numeroLinha}</td><td>{r.cliente || "—"}</td><td>{r.documento || "—"}</td><td>{dateBr(r.dataVencimento)}</td><td>{dateBr(r.dataPagamento)}</td><td className="right">{money(r.valor)}</td><td>{r.tituloId ?? "—"}</td><td>{r.parcelaId ?? "—"}</td><td><StatusBadge status={r.status} /></td><td className="message-cell" title={r.apiError}>{r.statusMensagem}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="flow"><div><b>ETAPA 1</b><span>Autenticação Token</span></div><i>→</i><div><b>ETAPA 2</b><span>Contas a Pagar</span></div><i>→</i><div><b>ETAPA 3</b><span>Parcelas em Aberto</span></div><i>→</i><div><b>REVISÃO</b><span>Conciliação</span></div><i>→</i><div><b>ETAPA 4</b><span>Baixar Parcelas</span></div></section>

    <BankConfigModal open={showConfig} bank={bank} headers={headers} onClose={() => setShowConfig(false)} onSave={saveBank} />
  </main>;
}
