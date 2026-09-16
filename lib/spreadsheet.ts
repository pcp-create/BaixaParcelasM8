import { read, utils, SSF, CellObject } from "xlsx";

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function paymentDate(cell: CellObject | undefined, date1904: boolean): string | null {
  if (!cell || cell.t === "e") return null;
  if (typeof cell.v === "number") {
    // Números de conta e outros metadados não são datas do Excel.
    if (!cell.z || !SSF.is_date(cell.z)) return null;
    const date = SSF.parse_date_code(cell.v, { date1904 });
    return date ? validDate(date.y, date.m, date.d) : null;
  }
  const text = String(cell.v ?? "").trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (br) return validDate(Number(br[3]), Number(br[2]), Number(br[1]));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return iso ? validDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
}

function amountText(cell: CellObject | undefined, row: number): string {
  if (cell?.t === "n" && typeof cell.v === "number" && Number.isFinite(cell.v)) {
    return String(cell.v);
  }
  let value = String(cell?.v ?? "").trim().replace(/R\$|\s/g, "").replace(/−/g, "-");
  if (/^\(.*\)$/.test(value)) value = "-" + value.slice(1, -1);
  if (value.endsWith("-")) value = "-" + value.slice(0, -1);
  if (cell?.t === "e" || !/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(value)) {
    throw new Error(`Valor inválido na linha ${row}, coluna 4. Confira o extrato Sicredi.`);
  }
  // Textos do extrato usam moeda brasileira; números Excel são lidos sem formatação.
  return value.replace(/\./g, "").replace(",", ".");
}

export function parseSicrediSpreadsheet(data: ArrayBuffer) {
  const workbook = read(data, { type: "array", cellNF: true, cellDates: false, raw: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) throw new Error("A primeira aba da planilha está vazia.");
  const range = utils.decode_range(sheet["!ref"]);
  const rows: Array<{ numeroLinha: number; columns: string[]; values: Record<string, string> }> = [];
  let firstDataRow: number | null = null;
  let skippedRows = 0;
  const headers = ["Data do pagamento", "Cliente / Fornecedor", "Documento", "Valor pago"];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = headers.map((_, c) => sheet[utils.encode_cell({ r, c })] as CellObject | undefined);
    const section = String(cells[0]?.v ?? "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    // Estas seções já não pertencem às movimentações efetivadas.
    // Lançamentos futuros também possuem datas, mas usam outro layout.
    if (/^saldo da conta\b|^lancamentos futuros\b/.test(section)) break;
    const date = paymentDate(cells[0], Boolean(workbook.Workbook?.WBProps?.date1904));
    if (!date) {
      if (firstDataRow !== null && cells.some((cell) => String(cell?.v ?? "").trim())) skippedRows++;
      continue;
    }
    if (firstDataRow === null) firstDataRow = r + 1;
    const columns = [
      date,
      cells[1] ? utils.format_cell(cells[1]).trim() : "",
      cells[2] ? utils.format_cell(cells[2]).trim() : "",
      amountText(cells[3], r + 1),
    ];
    rows.push({ numeroLinha: r + 1, columns, values: Object.fromEntries(headers.map((header, i) => [header, columns[i]])) });
  }

  if (!rows.length) throw new Error("Nenhuma data válida encontrada na coluna 1 da primeira aba. Confira o layout do extrato Sicredi.");
  return { rows, firstDataRow, skippedRows, sheetName };
}
