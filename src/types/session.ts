// src/types/session.ts
import type { Mode, UnitConfig } from "./units";

// src/types/session.ts
export interface SessionFileV4 {
  version: 4;
  rootPath: string;
  textarea: string;
  selected: string[];          // relative to root
  includeTree: boolean;        // required; we’ll coerce on write
  mode: Mode;                  // "folder" | "excel" | "block"
  unitSource?: string | undefined;         // relative to root
  unitConfig?: UnitConfig | undefined;     // excel/regex/html/api
  cursor?: { id?: string; index?: number; } | undefined;
  savedTokenCount?: number | undefined;
}

export type AnySession = SessionFileV4;