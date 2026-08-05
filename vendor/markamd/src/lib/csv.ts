const CSV_EXT = /\.csv$/i;

export const CSV_PREVIEW_MAX_ROWS = 200;
export const CSV_PREVIEW_MAX_COLUMNS = 20;

export type CsvPreview = {
  headers: string[];
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
};

export function isCsvPath(path: string): boolean {
  return CSV_EXT.test(path);
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }

  row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
  rows.push(row);

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === "")) {
    rows.pop();
  }

  return rows;
}

export function parseCsvPreview(
  source: string,
  maxRows = CSV_PREVIEW_MAX_ROWS,
  maxColumns = CSV_PREVIEW_MAX_COLUMNS,
): CsvPreview {
  const parsed = parseCsvRows(source);
  const totalColumns = parsed.reduce((max, row) => Math.max(max, row.length), 0);
  const headerRow = parsed[0] ?? [];
  const headers = Array.from({ length: Math.min(totalColumns, maxColumns) }, (_, i) => {
    const value = headerRow[i]?.trim();
    return value || `column ${i + 1}`;
  });

  const bodyRows = parsed.slice(1);
  const visibleRows = bodyRows.slice(0, maxRows).map((row) =>
    Array.from({ length: headers.length }, (_, i) => row[i] ?? ""),
  );

  return {
    headers,
    rows: visibleRows,
    totalRows: bodyRows.length,
    totalColumns,
    truncatedRows: bodyRows.length > maxRows,
    truncatedColumns: totalColumns > maxColumns,
  };
}
