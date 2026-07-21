import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type {
  PythonAttachmentPreview,
  PythonPatchAttachment,
} from "@rapid-prompt/prompt-builder-contracts";

import { getLocalProject, projectDir } from "../projectStore";

const PATCH_METADATA_FILE = "metadata.json";
const PYTHON_EXTENSIONS = new Set([".py"]);

export async function addPythonPatchAttachments(args: {
  projectId: string;
  paths: string[];
}): Promise<PythonPatchAttachment[]> {
  const project = await getLocalProject(args.projectId);
  const seen = new Set<string>();
  const attachments: PythonPatchAttachment[] = [];

  for (const rawPath of args.paths) {
    const sourcePath = path.resolve(rawPath);

    if (seen.has(sourcePath)) {
      continue;
    }
    seen.add(sourcePath);

    const extension = path.extname(sourcePath).toLowerCase();

    if (!PYTHON_EXTENSIONS.has(extension)) {
      throw new Error(`Python patch attachment must use the .py extension: ${sourcePath}`);
    }

    const sourceStats = await stat(sourcePath);

    if (!sourceStats.isFile()) {
      throw new Error(`Python patch attachment is not a file: ${sourcePath}`);
    }

    const source = await readFile(sourcePath, "utf8");
    const sha256 = createHash("sha256").update(source).digest("hex");
    const bucketDir = patchBucketDir(args.projectId, sha256);
    const storedPath = path.join(bucketDir, "patch.py");
    const metadataPath = path.join(bucketDir, PATCH_METADATA_FILE);

    await mkdir(bucketDir, { recursive: true });

    if (!existsSync(storedPath)) {
      await copyFile(sourcePath, storedPath);
    }

    const attachment: PythonPatchAttachment = {
      id: `patch_${sha256.slice(0, 16)}`,
      projectId: args.projectId,
      sourcePath,
      storedPath,
      fileName: path.basename(sourcePath),
      sizeBytes: sourceStats.size,
      sha256,
      changedPaths: extractChangedPaths(source, project.rootPath),
      addedAt: new Date().toISOString(),
    };

    await writeFile(
      metadataPath,
      `${JSON.stringify(attachment, null, 2)}\n`,
      "utf8",
    );
    attachments.push(attachment);
  }

  return dedupeByHash(attachments);
}

export async function listPythonPatchAttachments(
  projectId: string,
): Promise<PythonPatchAttachment[]> {
  await getLocalProject(projectId);

  const root = patchArchiveRoot(projectId);

  if (!existsSync(root)) {
    return [];
  }

  const metadataPaths = await findMetadataFiles(root);
  const attachments: PythonPatchAttachment[] = [];

  for (const metadataPath of metadataPaths) {
    const raw = await readFile(metadataPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const attachment = parseAttachment(parsed, metadataPath);

    if (attachment.projectId === projectId) {
      attachments.push(attachment);
    }
  }

  return dedupeByHash(attachments).sort(
    (left, right) =>
      right.addedAt.localeCompare(left.addedAt) ||
      left.fileName.localeCompare(right.fileName),
  );
}

export async function getPythonPatchAttachmentPreview(args: {
  projectId: string;
  sha256: string;
  maxCharacters?: number;
}): Promise<PythonAttachmentPreview> {
  const sha256 = normalizeSha256(args.sha256);
  const attachment = (await listPythonPatchAttachments(args.projectId)).find(
    (item) => item.sha256 === sha256,
  );

  if (!attachment) {
    throw new Error(`Python patch attachment not found: ${sha256}`);
  }

  const maxCharacters = Math.max(
    1_000,
    Math.min(args.maxCharacters ?? 120_000, 250_000),
  );
  const source = await readFile(attachment.storedPath, "utf8");
  const truncated = source.length > maxCharacters;

  return {
    kind: "python",
    fileName: attachment.fileName,
    text: truncated ? source.slice(0, maxCharacters) : source,
    truncated,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  };
}

function extractChangedPaths(source: string, projectRoot: string): string[] {
  const candidates = new Set<string>();
  const normalizedRoot = path.resolve(projectRoot);
  const quotedPathPattern = /["']([^"'\\]*(?:\\.[^"'\\]*)*)["']/g;

  for (const match of source.matchAll(quotedPathPattern)) {
    const raw = decodePythonString(match[1] ?? "").trim();

    if (!looksLikeProjectFile(raw)) {
      continue;
    }

    const normalized = normalizeCandidate(raw, normalizedRoot);

    if (normalized) {
      candidates.add(normalized);
    }
  }

  const patchHeaderPattern = /^(?:\+\+\+|---)\s+(?:[ab]\/)?(.+)$/gm;

  for (const match of source.matchAll(patchHeaderPattern)) {
    const raw = (match[1] ?? "").trim();

    if (raw !== "/dev/null") {
      const normalized = normalizeCandidate(raw, normalizedRoot);

      if (normalized) {
        candidates.add(normalized);
      }
    }
  }

  return Array.from(candidates).sort();
}

function decodePythonString(value: string): string {
  return value
    .replaceAll("\\\\", "\\")
    .replaceAll("\\/", "/")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}

function looksLikeProjectFile(value: string): boolean {
  if (
    !value ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("sha256:")
  ) {
    return false;
  }

  const extension = path.extname(value).toLowerCase();

  return Boolean(extension) && extension !== ".bak";
}

function normalizeCandidate(
  candidate: string,
  projectRoot: string,
): string | null {
  const withoutPrefix = candidate.replace(/^[ab]\//, "");
  const absolute = path.isAbsolute(withoutPrefix)
    ? path.resolve(withoutPrefix)
    : path.resolve(projectRoot, withoutPrefix);
  const relative = path.relative(projectRoot, absolute);

  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return null;
  }

  return relative.split(path.sep).join("/");
}

async function findMetadataFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];

  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...await findMetadataFiles(candidate));
    } else if (entry.isFile() && entry.name === PATCH_METADATA_FILE) {
      out.push(candidate);
    }
  }

  return out;
}

function parseAttachment(
  value: unknown,
  metadataPath: string,
): PythonPatchAttachment {
  if (!isRecord(value)) {
    throw new Error(`Invalid Python patch metadata file: ${metadataPath}`);
  }

  const changedPaths = value.changedPaths;

  if (
    !Array.isArray(changedPaths) ||
    !changedPaths.every((item) => typeof item === "string")
  ) {
    throw new Error(
      `Invalid Python patch metadata property "changedPaths" in ${metadataPath}`,
    );
  }

  return {
    id: requiredString(value, "id", metadataPath),
    projectId: requiredString(value, "projectId", metadataPath),
    sourcePath: requiredString(value, "sourcePath", metadataPath),
    storedPath: requiredString(value, "storedPath", metadataPath),
    fileName: requiredString(value, "fileName", metadataPath),
    sizeBytes: requiredNumber(value, "sizeBytes", metadataPath),
    sha256: requiredString(value, "sha256", metadataPath),
    changedPaths,
    addedAt: requiredString(value, "addedAt", metadataPath),
  };
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid Python patch archive sha256: ${value}`);
  }

  return normalized;
}

function patchArchiveRoot(projectId: string): string {
  return path.join(projectDir(projectId), "attachments", "python-patches");
}

function patchBucketDir(projectId: string, sha256: string): string {
  return path.join(patchArchiveRoot(projectId), sha256.slice(0, 2), sha256);
}

function dedupeByHash(
  attachments: PythonPatchAttachment[],
): PythonPatchAttachment[] {
  const byHash = new Map<string, PythonPatchAttachment>();

  for (const attachment of attachments) {
    byHash.set(attachment.sha256, attachment);
  }

  return Array.from(byHash.values());
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  metadataPath: string,
): string {
  const value = record[key];

  if (typeof value !== "string") {
    throw new Error(
      `Invalid Python patch metadata property "${key}" in ${metadataPath}`,
    );
  }

  return value;
}

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  metadataPath: string,
): number {
  const value = record[key];

  if (typeof value !== "number") {
    throw new Error(
      `Invalid Python patch metadata property "${key}" in ${metadataPath}`,
    );
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
