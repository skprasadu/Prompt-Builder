import type { SessionFileV4 } from "../types/session";
import type { UnitConfig } from "../types/units";

/* ---------- path helpers ---------- */

function pathSepFor(pathValue: string): "/" | "\\" {
  return pathValue.includes("\\") ? "\\" : "/";
}

export function toRelative(root: string, absolute: string): string {
  const sep = pathSepFor(root);
  const rootNorm = root.endsWith(sep) ? root : root + sep;

  if (absolute.startsWith(rootNorm)) {
    return absolute.slice(rootNorm.length);
  }

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
  selectedAbsolute: string[];
  includeTree: boolean;
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

  return {
    version: 4,
    rootPath,
    textarea,
    selected: selectedAbsolute.map((pathValue) => toRelative(rootPath, pathValue)),
    includeTree,
    mode,
    ...(unitSourceAbs ? { unitSource: toRelative(rootPath, unitSourceAbs) } : {}),
    ...(unitConfig ? { unitConfig } : {}),
    ...(cursor ? { cursor } : {}),
    ...(savedTokenCount !== undefined ? { savedTokenCount } : {}),
  };
}

/* ---------- validation ---------- */

export function validateSession(value: unknown): value is SessionFileV4 {
  if (!isRecord(value)) {
    return false;
  }

  if (value.version !== 4) {
    return false;
  }

  if (typeof value.rootPath !== "string") {
    return false;
  }

  if (typeof value.textarea !== "string") {
    return false;
  }

  if (!Array.isArray(value.selected) || !value.selected.every((item) => typeof item === "string")) {
    return false;
  }

  if (typeof value.includeTree !== "boolean") {
    return false;
  }

  if (value.mode !== "folder" && value.mode !== "excel" && value.mode !== "block") {
    return false;
  }

  if (value.unitSource !== undefined && typeof value.unitSource !== "string") {
    return false;
  }

  if (value.cursor !== undefined) {
    if (!isRecord(value.cursor)) {
      return false;
    }

    if (value.cursor.index !== undefined && typeof value.cursor.index !== "number") {
      return false;
    }

    if (value.cursor.id !== undefined && typeof value.cursor.id !== "string") {
      return false;
    }
  }

  if (value.savedTokenCount !== undefined && typeof value.savedTokenCount !== "number") {
    return false;
  }

  return true;
}

export function serializeSession(session: SessionFileV4): string {
  return JSON.stringify(session, null, 2);
}

export function parseSession(raw: string): SessionFileV4 {
  const data: unknown = JSON.parse(raw);

  if (!validateSession(data)) {
    throw new Error("Invalid session file");
  }

  return data;
}

export function resolveUnitSource(root: string, unitSource?: string): string | undefined {
  if (!unitSource) {
    return undefined;
  }

  return toAbsolute(root, unitSource);
}

export function resolveSelected(root: string, relativePaths: string[]): string[] {
  return relativePaths.map((relativePath) => toAbsolute(root, relativePath));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
