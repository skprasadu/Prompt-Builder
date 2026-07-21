import * as XLSX from "xlsx";
import type { ExcelConfig, ExcelInspector, PromptUnit } from "./types";

export function inspectExcel(filePath: string): ExcelInspector {
  const workbook = XLSX.readFile(filePath);

  return {
    path: filePath,
    sheets: workbook.SheetNames.map((sheetName) => {
      const rows = sheetRows(workbook, sheetName);
      const header = findHeaderRow(rows) ?? [];

      return {
        name: sheetName,
        columns: header.map((value, index) => value || `col${index + 1}`),
      };
    }),
  };
}

export function extractExcelUnits(filePath: string, config: ExcelConfig): PromptUnit[] {
  const workbook = XLSX.readFile(filePath);
  const rows = sheetRows(workbook, config.sheet);
  const headerResult = findHeaderRowWithIndex(rows);

  if (!headerResult) {
    throw new Error("Could not detect header row.");
  }

  const { header, index: headerIndex } = headerResult;
  const idIndex = findColumnIndex(header, config.idColumn);

  if (idIndex < 0) {
    throw new Error(`ID column not found: ${config.idColumn}`);
  }

  const descriptionIndices = config.descriptionColumns.map((name) => {
    const index = findColumnIndex(header, name);

    if (index < 0) {
      throw new Error(`Description column not found: ${name}`);
    }

    return index;
  });

  const units: PromptUnit[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] ?? [];
    const id = cellString(row[idIndex]).trim();

    if (!id) {
      continue;
    }

    const body = descriptionIndices
      .map((index) => cellString(row[index]).trim())
      .filter(Boolean)
      .join("\n");

    if (!body) {
      continue;
    }

    units.push({
      id,
      body,
      meta: {
        sheet: config.sheet,
        rowIndex,
      },
    });
  }

  return units;
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
}

function findHeaderRow(rows: unknown[][]): string[] | null {
  return findHeaderRowWithIndex(rows)?.header ?? null;
}

function findHeaderRowWithIndex(rows: unknown[][]): { header: string[]; index: number } | null {
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index] ?? [];
    const header = row.map(cellString);

    if (header.some((value) => value.trim().length > 0)) {
      return { header, index };
    }
  }

  return null;
}

function findColumnIndex(header: string[], columnName: string): number {
  const wanted = columnName.trim().toLowerCase();
  return header.findIndex((value) => value.trim().toLowerCase() === wanted);
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized ?? "";
  } catch {
    return "";
  }
}
