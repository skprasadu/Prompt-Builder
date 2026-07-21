export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface FileValue {
  filePath: string;
  value: string;
}

export interface PromptUnit {
  id: string;
  body: string;
  meta?: Record<string, unknown>;
}

export interface ExcelInspector {
  path: string;
  sheets: { name: string; columns: string[] }[];
}

export interface ExcelConfig {
  sheet: string;
  idColumn: string;
  descriptionColumns: string[];
}

export interface RegexConfig {
  delimiter: string;
  idCapture?: string;
  flags?: string;
}

export interface HtmlConfig {
  itemSelector: string;
  idSelector?: string;
  idAttr?: string;
  descSelector?: string;
}

export interface ApiTable {
  columns: string[];
  rows: Record<string, string>[];
}
