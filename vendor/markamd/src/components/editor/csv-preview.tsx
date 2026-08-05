import { CSV_PREVIEW_MAX_COLUMNS, CSV_PREVIEW_MAX_ROWS, parseCsvPreview } from "@/lib";

type CsvPreviewProps = {
  source: string;
  fileName?: string;
};

export function CsvPreview({ source, fileName }: CsvPreviewProps) {
  const preview = parseCsvPreview(source);

  if (preview.headers.length === 0) {
    return (
      <div className="mdv-csv">
        <div className="mdv-csv__empty">empty csv file</div>
      </div>
    );
  }

  return (
    <article className="mdv-csv" aria-label={fileName ? `${fileName} csv preview` : "csv preview"}>
      <header className="mdv-csv__header">
        <div>
          <p className="mdv-csv__eyebrow">csv preview</p>
          <h1 className="mdv-csv__title">{fileName ?? "data.csv"}</h1>
        </div>
        <p className="mdv-csv__meta">
          {preview.totalRows.toLocaleString()} rows · {preview.totalColumns.toLocaleString()} columns
        </p>
      </header>
      {(preview.truncatedRows || preview.truncatedColumns) ? (
        <p className="mdv-csv__notice">
          showing first {CSV_PREVIEW_MAX_ROWS} rows and {CSV_PREVIEW_MAX_COLUMNS} columns
        </p>
      ) : null}
      <div className="mdv-csv__table-wrap">
        <table className="mdv-csv__table">
          <thead>
            <tr>
              {preview.headers.map((header, i) => (
                <th key={`${header}-${i}`}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
