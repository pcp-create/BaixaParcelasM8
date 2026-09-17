import { NormalizedCsvRow, ValueSuggestion } from "@/lib/types";
import { selectionOwner } from "@/lib/value-suggestions";

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function ValueSuggestions({ row, rows, disabled, onSelect }: {
  row: NormalizedCsvRow;
  rows: NormalizedCsvRow[];
  disabled: boolean;
  onSelect: (suggestion: ValueSuggestion) => void;
}) {
  return <div className="value-suggestions">
    <div className="suggestions-heading"><span className="suggestions-line-badge">↳ Linha {row.numeroLinha}</span><strong>Selecione a parcela deste pagamento</strong></div>
    <div className="suggestions-client">{row.cliente}</div>
    <p>Pagamento no extrato: {row.dataPagamento} · {money(row.valor ?? 0)}. Confira os dados antes de selecionar. A seleção confirma a correspondência e libera a parcela para a etapa de baixa.</p>
    <div className="suggestions-scroll"><table>
      <thead><tr><th>Selecionar</th><th>Título / Parcela</th><th>Fornecedor / Documento</th><th>Complementos</th><th>Vencimento / Regra de data</th><th>Principal M8</th><th>Juros</th><th>Desconto</th></tr></thead>
      <tbody>{row.sugestoesValor?.map((suggestion) => {
        const owner = selectionOwner(rows, row.rowId, suggestion.titulo.id, suggestion.parcela.id);
        return <tr key={`${suggestion.titulo.id}-${suggestion.parcela.id}`}>
        <td><input type="radio" name={`suggestion-${row.rowId}`} aria-label={`Selecionar título ${suggestion.titulo.id}, parcela ${suggestion.parcela.id}`}
          checked={row.tituloId === suggestion.titulo.id && row.parcelaId === suggestion.parcela.id}
          disabled={disabled || !!owner || !["sugestao", "conflito", "pronto"].includes(row.status)} onChange={() => onSelect(suggestion)} />
          {owner && <small className="account-id-note">Vinculada à linha {owner.numeroLinha}</small>}
        </td>
        <td>{suggestion.titulo.id} / {suggestion.parcela.id}</td>
        <td>{suggestion.titulo.fornecedorNome || "—"}<br />{String(suggestion.titulo.documento || "—")}</td>
        <td>Título: {String(suggestion.titulo.complemento || "—")}<br />Parcela: {String(suggestion.parcela.complemento || "—")}</td>
        <td>{suggestion.data.vencimento}<br /><small>{suggestion.data.motivo}</small></td>
        <td>{money(suggestion.principal)}</td><td>{money(suggestion.juros)}</td><td>{money(suggestion.desconto)}</td>
      </tr>; })}</tbody>
    </table></div>
  </div>;
}
