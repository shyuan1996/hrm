// Quote every cell and neutralize spreadsheet formulas, including whitespace
// or control characters before the formula marker.
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export const csvRow = (values: unknown[]) => values.map(csvCell).join(',') + '\r\n';
