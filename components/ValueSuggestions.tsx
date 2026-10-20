import { NormalizedCsvRow, ValueSuggestion } from "@/lib/types";
import { selectionOwner } from "@/lib/value-suggestions";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ValueSuggestions({ row, rows, disabled, onSelect }: {
  row: NormalizedCsvRow;
  rows: NormalizedCsvRow[];
  disabled: boolean;
  onSelect: (suggestion: ValueSuggestion) => void;
}) {
  const selected = row.parcelasSelecionadas ?? [];
  const total = selected.reduce((sum, p) => sum + Math.round((p.parcelaValor ?? p.valor ?? 0) * 100), 0) / 100;
  const difference = (Math.round((row.valor ?? 0) * 100) - Math.round(total * 100)) / 100;
  return <div className="value-suggestions">
    <div className="suggestions-heading"><span className="suggestions-line-badge">↳ Linha {row.numeroLinha}</span><strong>Selecione as parcelas deste pagamento</strong></div>
    <div className="suggestions-client">{row.cliente}</div>
    <p>Pagamento no extrato: {row.dataPagamento} · {money(row.valor ?? 0)}. Marque uma ou mais parcelas. Para várias parcelas, a soma deve ser igual ao extrato, sem juros ou desconto. Com uma parcela, o ajuste continua automático.</p>
    <div className="selection-summary" role="status">
      <strong>{selected.length} parcela(s) selecionada(s)</strong>
      <span>Soma das parcelas: {money(total)}</span>
      <span>Valor do extrato: {money(row.valor ?? 0)}</span>
      <strong>Diferença: {money(difference)}</strong>
      {selected.length > 1 && difference !== 0 && <span>Ajuste a seleção para liberar a baixa.</span>}
    </div>
    <div className="suggestions-scroll"><table>
      <thead><tr><th>Selecionar</th><th>Título / Parcela</th><th>Fornecedor / Documento</th><th>Complementos</th><th>Vencimento / Regra de data</th><th>Principal M8</th><th>Juros</th><th>Desconto</th><th>Retorno da baixa</th></tr></thead>
      <tbody>{row.sugestoesValor?.map((suggestion) => {
        const owner = selectionOwner(rows, row.rowId, suggestion.titulo.id, suggestion.parcela.id);
        const selection = selected.find(p => p.tituloId === suggestion.titulo.id && p.parcelaId === suggestion.parcela.id);
        return <tr key={`${suggestion.titulo.id}-${suggestion.parcela.id}`}>
        <td><input type="checkbox" name={`suggestion-${row.rowId}`} aria-label={`Selecionar título ${suggestion.titulo.id}, parcela ${suggestion.parcela.id}`}
          checked={!!selection || row.tituloId === suggestion.titulo.id && row.parcelaId === suggestion.parcela.id}
          disabled={disabled || row.baixaIniciada || !!owner || !["sugestao", "conflito", "pronto"].includes(row.status)} onChange={() => onSelect(suggestion)} />
          {owner && <small className="account-id-note">Vinculada à linha {owner.numeroLinha}</small>}
        </td>
        <td>{suggestion.titulo.id} / {suggestion.parcela.id}</td>
        <td>{suggestion.titulo.fornecedorNome || "—"}<br />{String(suggestion.titulo.documento || "—")}</td>
        <td>Título: {String(suggestion.titulo.complemento || "—")}<br />Parcela: {String(suggestion.parcela.complemento || "—")}</td>
        <td>{suggestion.data.vencimento}<br /><small>{suggestion.data.motivo}</small><br /><strong>{suggestion.criterio === "valor_saldo_data" ? "Valor, saldo e data compatíveis — nome não confirmado. Confira o fornecedor." : "Identificação compatível."}</strong></td>
        <td>{money(suggestion.principal)}</td><td>{selected.length > 1 ? "—" : money(suggestion.juros)}</td><td>{selected.length > 1 ? "—" : money(suggestion.desconto)}</td>
        <td>{selection?.status === "baixada" ? "Baixada" : selection?.status === "erro" ? selection.apiError || selection.statusMensagem : selection ? row.baixaIniciada && row.status === "erro" ? "Sem confirmação. Verifique no M8." : "Aguardando baixa" : "—"}</td>
      </tr>; })}</tbody>
    </table></div>
  </div>;
}
