/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), embedded newlines, CRLF, UTF-8 BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Turns CSV text into objects keyed by header. LinkedIn prefixes some files (e.g. Connections.csv) with
 * a "Notes:" preamble, so the header is the first row that contains `expectHeader`.
 */
export function csvRecords(input: string, expectHeader?: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  const start = expectHeader ? rows.findIndex((r) => r.map((c) => c.trim()).includes(expectHeader)) : 0;
  if (start < 0 || !rows[start]) return [];
  const header = rows[start]!.map((h) => h.trim());
  return rows.slice(start + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
