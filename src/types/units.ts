// src/types/units.ts
export type Mode = "folder" | "excel" | "block";

/* ---------- Common app data ---------- */
export interface PromptUnit {
  id: string;
  body: string;
  meta?: Record<string, unknown>; // optional — never set `undefined`
}

/* ---------- Excel (matches Rust `ExcelInspector`) ---------- */
export interface ExcelInspector {
  path: string;
  sheets: { name: string; columns: string[] }[];
}

export interface ExcelConfig {
  kind: "excel";
  sheet: string;
  idColumn: string;
  descriptionColumns: string[];
}

/* ---------- Regex blocks ---------- */
export interface RegexConfig {
  kind: "regex";
  delimiter: string;
  idCapture?: string; // optional (important with exactOptionalPropertyTypes)
  flags?: string;     // optional
}

/* ---------- HTML blocks ---------- */
export interface HtmlConfig {
  kind: "html";
  itemSelector: string;
  idSelector?: string;   // optional
  idAttr?: string;       // optional
  descSelector?: string; // optional
}

/* ---------- API blocks (table mapping) ---------- */
export interface ApiConfig {
  kind: "api";
  endpoint: string;          // required
  idColumn?: string;         // optional until user chooses
  descriptionColumns?: string[]; // optional until user chooses
}

export type UnitConfig = ExcelConfig | RegexConfig | HtmlConfig | ApiConfig;

/* ---------- Tauri API response (normalized table) ---------- */
export interface ApiTable {
  columns: string[];
  rows: Record<string, string>[]; // flat row of column -> stringified value
}