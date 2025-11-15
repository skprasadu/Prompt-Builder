// src/lib/session.ts
import type { SessionFileV4 } from "../types/session";
import type { UnitConfig } from "../types/units";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open, save } from "@tauri-apps/plugin-dialog";

/* ---------- path helpers ---------- */

function pathSepFor(p: string): "/" | "\\" {
  return p.includes("\\") ? "\\" : "/";
}

export function toRelative(root: string, absolute: string): string {
  const sep = pathSepFor(root);
  const rootNorm = root.endsWith(sep) ? root : root + sep;
  if (absolute.startsWith(rootNorm)) return absolute.slice(rootNorm.length);
  const absFix = absolute.split(/[\\/]+/).join(sep);
  const rootFix = rootNorm.split(/[\\/]+/).join(sep);
  return absFix.startsWith(rootFix) ? absFix.slice(rootFix.length) : absolute;
}

export function toAbsolute(root: string, relative: string): string {
  const sep = pathSepFor(root);
  const relNorm = relative.split(/[\\/]+/).join(sep);
  return (root.endsWith(sep) ? root : root + sep) + relNorm;
}

/* ---------- build v4 session ---------- */

export function toSessionV4(args: {
  rootPath: string;
  textarea: string;
  selectedAbsolute: string[]; // folder mode
  includeTree: boolean; // keep as a concrete boolean for strict typing
  mode: "folder" | "excel" | "block";
  unitSourceAbs?: string;
  unitConfig?: UnitConfig;
  cursor?: { id?: string; index?: number };
  savedTokenCount?: number;
}): SessionFileV4 {
  const {
    rootPath,
    textarea,
    selectedAbsolute,
    includeTree,
    mode,
    unitSourceAbs,
    unitConfig,
    cursor,
    savedTokenCount,
  } = args;

  const out: SessionFileV4 = {
    version: 4 as const,
    rootPath,
    textarea,
    selected: selectedAbsolute.map((p: string) => toRelative(rootPath, p)),
    includeTree: !!includeTree,
    mode,
    unitSource: unitSourceAbs ? toRelative(rootPath, unitSourceAbs) : undefined,
    unitConfig,
    cursor,
  };
  if (savedTokenCount !== undefined) out.savedTokenCount = savedTokenCount;
  return out;
}

/* ---------- validation ---------- */

export function validateSession(x: unknown): x is SessionFileV4 {
  const s = x as Partial<SessionFileV4>;
  if (!s || s.version !== 4) return false;
  if (typeof s.rootPath !== "string") return false;
  if (typeof s.textarea !== "string") return false;
  if (!Array.isArray(s.selected) || !s.selected.every((v) => typeof v === "string")) return false;
  if (s.includeTree !== undefined && typeof s.includeTree !== "boolean") return false;
  if (s.mode !== "folder" && s.mode !== "excel" && s.mode !== "block") return false;
  if (s.unitSource !== undefined && typeof s.unitSource !== "string") return false;
  if (s.cursor !== undefined) {
    if (typeof s.cursor !== "object") return false;
    if (s.cursor.index !== undefined && typeof s.cursor.index !== "number") return false;
    if (s.cursor.id !== undefined && typeof s.cursor.id !== "string") return false;
  }
  if (s.savedTokenCount !== undefined && typeof s.savedTokenCount !== "number") return false;
  return true;
}

/* ---------- export/import ---------- */

export async function exportSession(session: SessionFileV4): Promise<void> {
  const filepath = await save({
    defaultPath: "session.rag.json",
    filters: [{ name: "RAG Session", extensions: ["json"] }],
  });
  if (!filepath) return;
  await writeTextFile(filepath, JSON.stringify(session, null, 2));
}

export async function importSession(): Promise<SessionFileV4 | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "RAG Session", extensions: ["json"] }],
  });
  if (typeof picked !== "string" || picked.length === 0) return null;
  const raw = await readTextFile(picked);
  const data = JSON.parse(raw) as unknown;
  if (!validateSession(data)) throw new Error("Invalid session file");
  return data;
}

/* ---------- helpers used by app ---------- */

export async function resolveUnitSource(
  root: string,
  unitSource?: string
): Promise<string | undefined> {
  if (!unitSource) return undefined;
  return toAbsolute(root, unitSource);
}

export async function resolveSelected(root: string, rels: string[]): Promise<string[]> {
  return rels.map((r: string) => toAbsolute(root, r));
}