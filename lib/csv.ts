import { BankConfig, NormalizedCsvRow } from "./types";

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0] || "";
  const candidates = [";", ",", "\t"];
  return candidates.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
}

export function parseCsv(text: string) {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = clean.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("O CSV não possui registros suficientes.");
  const delimiter = detectDelimiter(clean);
  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim());
  if (headers.some((h) => !h)) throw new Error("O CSV possui cabeçalho vazio.");

  const rows = lines.slice(1).map((line, idx) => {
    const values = splitCsvLine(line, delimiter);
    const obj: Record<string, string> = {};
    headers.forEach((header, col) => (obj[header] = values[col]?.trim() ?? ""));
    return { numeroLinha: idx + 2, values: obj };
  });
  return { headers, rows, delimiter };
}

export function parseCurrency(value: string): number | null {
  if (!value?.trim()) return null;
  const clean = value.replace(/R\$/gi, "").replace(/\s/g, "");
  let normalized = clean;
  if (clean.includes(",")) normalized = clean.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseBrDateToIso(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return v;
}

export function normalizeRows(
  parsedRows: Array<{ numeroLinha: number; values: Record<string, string> }>,
  bank: BankConfig
): NormalizedCsvRow[] {
  return parsedRows.map(({ numeroLinha, values }, idx) => ({
    rowId: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
    numeroLinha,
    original: values,
    cliente: values[bank.mapping.cliente] ?? "",
    dataVencimento: parseBrDateToIso(values[bank.mapping.dataVencimento] ?? ""),
    dataPagamento: parseBrDateToIso(values[bank.mapping.dataPagamento] ?? ""),
    documento: (values[bank.mapping.documento] ?? "").trim(),
    valor: parseCurrency(values[bank.mapping.valor] ?? ""),
    status: "aguardando",
    statusMensagem: "Aguardando conciliação"
  }));
}
