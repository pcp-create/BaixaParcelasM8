import { BankConfig, NormalizedCsvRow } from "./types";

/* ============================================================
   DIVIDIR LINHA DO CSV
============================================================ */

function splitCsvLine(
  line: string,
  delimiter: string
): string[] {
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
    } else if (
      ch === delimiter &&
      !quoted
    ) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current.trim());

  return result;
}

/* ============================================================
   DETECTAR DELIMITADOR
============================================================ */

function detectDelimiter(text: string): string {
  const firstLine =
    text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)[0] || "";

  const candidates = [
    ";",
    ",",
    "\t",
  ];

  let melhor = ";";
  let maiorQuantidade = 0;

  for (const candidate of candidates) {
    const quantidade =
      firstLine.split(candidate).length;

    if (quantidade > maiorQuantidade) {
      maiorQuantidade = quantidade;
      melhor = candidate;
    }
  }

  return melhor;
}

/* ============================================================
   PARSE DO CSV
============================================================ */

export function parseCsv(text: string) {
  const clean = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const lines = clean
    .split("\n")
    .filter(
      (line) =>
        line.trim().length > 0
    );

  if (lines.length < 2) {
    throw new Error(
      "O CSV não possui registros suficientes."
    );
  }

  const delimiter =
    detectDelimiter(clean);

  const headers =
    splitCsvLine(
      lines[0],
      delimiter
    ).map(
      (header) =>
        header.trim()
    );

  if (
    headers.some(
      (header) => !header
    )
  ) {
    throw new Error(
      "O CSV possui cabeçalho vazio."
    );
  }

  const rows =
    lines
      .slice(1)
      .map(
        (line, idx) => {
          const values =
            splitCsvLine(
              line,
              delimiter
            );

          const obj:
            Record<string, string> =
            {};

          headers.forEach(
            (header, col) => {
              obj[header] =
                values[col]?.trim() ??
                "";
            }
          );

          return {
            numeroLinha:
              idx + 2,

            values:
              obj,
          };
        }
      );

  return {
    headers,
    rows,
    delimiter,
  };
}

/* ============================================================
   CONVERTER VALOR MONETÁRIO

   Exemplos:

   "10.739,00"  -> 10739
   "2.650,05"   -> 2650.05
   "525"        -> 525
   "R$ 1.000,00" -> 1000
============================================================ */

export function parseCurrency(
  value: string
): number | null {
  if (!value?.trim()) {
    return null;
  }

  let clean = value
    .trim()
    .replace(/R\$/gi, "")
    .replace(/\s/g, "");

  /*
   * Formato brasileiro:
   *
   * 10.739,00
   *
   * remove ponto de milhar
   * troca vírgula por ponto decimal
   */
  if (clean.includes(",")) {
    clean = clean
      .replace(/\./g, "")
      .replace(",", ".");
  }

  /*
   * Remove qualquer caractere
   * que não faça parte do número.
   */
  clean = clean.replace(
    /[^0-9.-]/g,
    ""
  );

  const numero =
    Number(clean);

  return Number.isFinite(numero)
    ? numero
    : null;
}

/* ============================================================
   CONVERTER DATA

   04/09/2026
       ↓
   2026-09-04
============================================================ */

export function parseBrDateToIso(
  value: string
): string {
  const v =
    String(value ?? "").trim();

  if (!v) {
    return "";
  }

  /*
   * DD/MM/YYYY
   */
  const br =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(
      v
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

  /*
   * YYYY-MM-DD
   * ou ISO completo
   */
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})/.exec(
      v
    );

  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return v;
}

/* ============================================================
   NORMALIZAR LINHAS

   Converte qualquer layout bancário para
   nosso padrão interno.
============================================================ */

export function normalizeRows(
  parsedRows: Array<{
    numeroLinha: number;
    values: Record<string, string>;
  }>,

  bank: BankConfig
): NormalizedCsvRow[] {
  return parsedRows.map(
    (
      {
        numeroLinha,
        values,
      },
      idx
    ) => {
      /* ------------------------------------------------------
         PEGAR VALORES ORIGINAIS
      ------------------------------------------------------ */

      const clienteOriginal =
        values[
          bank.mapping.cliente
        ] ?? "";

      const pagamentoOriginal =
        values[
          bank.mapping
            .dataPagamento
        ] ?? "";

      const vencimentoOriginal =
        values[
          bank.mapping
            .dataVencimento
        ] ?? "";

      const documentoOriginal =
        values[
          bank.mapping.documento
        ] ?? "";

      const valorOriginal =
        values[
          bank.mapping.valor
        ] ?? "";

      /* ------------------------------------------------------
         NORMALIZAR
      ------------------------------------------------------ */

      const cliente =
        clienteOriginal.trim();

      const dataPagamento =
        parseBrDateToIso(
          pagamentoOriginal
        );

      const dataVencimento =
        parseBrDateToIso(
          vencimentoOriginal
        );

      const documento =
        documentoOriginal.trim();

      const valor =
        parseCurrency(
          valorOriginal
        );

      /* ------------------------------------------------------
         DEBUG

         Deixe temporariamente.
         Assim conseguimos verificar exatamente
         o que está sendo enviado para a conciliação.
      ------------------------------------------------------ */

      console.log(
        "[CSV NORMALIZADO]",
        {
          numeroLinha,

          mapeamento: {
            cliente:
              bank.mapping.cliente,

            dataPagamento:
              bank.mapping
                .dataPagamento,

            valor:
              bank.mapping.valor,
          },

          original: {
            cliente:
              clienteOriginal,

            pagamento:
              pagamentoOriginal,

            valor:
              valorOriginal,
          },

          normalizado: {
            cliente,
            dataPagamento,
            valor,
          },
        }
      );

      /* ------------------------------------------------------
         RETORNO
      ------------------------------------------------------ */

      return {
        rowId:
          `${Date.now()}-${idx}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,

        numeroLinha,

        original:
          values,

        cliente,

        dataVencimento,

        dataPagamento,

        documento,

        valor,

        status:
          "aguardando",

        statusMensagem:
          "Aguardando conciliação",
      };
    }
  );
}