import fs from "node:fs";

/** A cell starting with one of these is read as a formula by spreadsheets. */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);
/** Byte order mark, so spreadsheets read the file as UTF-8. */
export const CSV_BOM = "﻿";

function csvEscape(value: string): string {
  let str = value;
  const first = str.charAt(0);
  if (first && FORMULA_PREFIXES.has(first)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Appends one row to a CSV file, its cells escaped and defused. */
export function appendCsvRow(filePath: string, row: string[]): void {
  fs.appendFileSync(filePath, `${row.map(csvEscape).join(",")}\r\n`);
}
