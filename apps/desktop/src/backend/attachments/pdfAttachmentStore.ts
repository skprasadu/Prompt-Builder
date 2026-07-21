import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";

import { getLocalProject, projectDir } from "../projectStore";

import type {
  BinaryAttachmentPreview,
} from "@rapid-prompt/prompt-builder-contracts";

const execFileAsync = promisify(execFile);

const PDF_EXTENSION = ".pdf";
const PDF_METADATA_FILE = "metadata.json";

const COPY_FILES_SWIFT = `
import AppKit
import Foundation

enum RapidPromptClipboardError: Error {
  case invalidPayload
  case writeFailed
}

let payload = ProcessInfo.processInfo.environment["RAPID_PROMPT_FILE_PATHS"] ?? "[]"

guard let payloadData = payload.data(using: .utf8),
      let decoded = try JSONSerialization.jsonObject(with: payloadData) as? [String] else {
  throw RapidPromptClipboardError.invalidPayload
}

let pasteboard = NSPasteboard.general
pasteboard.clearContents()

let urls = decoded.map { NSURL(fileURLWithPath: $0) }

if !pasteboard.writeObjects(urls) {
  throw RapidPromptClipboardError.writeFailed
}
`;

export interface PdfAttachment {
  id: string;
  projectId: string;
  sourcePath: string;
  storedPath: string;
  fileName: string;
  extension: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  sha256: string;
  addedAt: string;
}

export type PdfTextExtractionStatus = "completed" | "failed";

export interface PdfTextExtraction {
  pdfId: string;
  sha256: string;
  fileName: string;
  status: PdfTextExtractionStatus;
  title: string;
  text: string;
  pageCount?: number;
  error?: string;
  extractedAt: string;
}

export interface DeletePdfAttachmentResult {
  projectId: string;
  sha256: string;
  deleted: boolean;
  deletedPath: string;
}

export interface ClearPdfAttachmentsResult {
  projectId: string;
  deleted: number;
  archiveRoot: string;
}

export async function addPdfAttachments(args: {
  projectId: string;
  paths: string[];
}): Promise<PdfAttachment[]> {
  await getLocalProject(args.projectId);

  if (args.paths.length === 0) {
    return [];
  }

  const seenPaths = new Set<string>();
  const out: PdfAttachment[] = [];

  for (const rawPath of args.paths) {
    const sourcePath = path.resolve(rawPath);

    if (seenPaths.has(sourcePath)) {
      continue;
    }
    seenPaths.add(sourcePath);

    const extension = path.extname(sourcePath).toLowerCase();

    if (extension !== PDF_EXTENSION) {
      throw new Error(`Only PDF attachments are supported here: ${sourcePath}`);
    }

    const sourceStats = await stat(sourcePath);

    if (!sourceStats.isFile()) {
      throw new Error(`PDF attachment is not a file: ${sourcePath}`);
    }

    const sha256 = await sha256File(sourcePath);
    const bucketDir = pdfBucketDir(args.projectId, sha256);
    const storedPath = path.join(bucketDir, "original.pdf");
    const metadataPath = path.join(bucketDir, PDF_METADATA_FILE);

    await mkdir(bucketDir, { recursive: true });

    if (!existsSync(storedPath)) {
      await copyFile(sourcePath, storedPath);
    }

    const attachment: PdfAttachment = {
      id: `pdf_${sha256.slice(0, 16)}`,
      projectId: args.projectId,
      sourcePath,
      storedPath,
      fileName: path.basename(sourcePath),
      extension,
      mimeType: "application/pdf",
      sizeBytes: sourceStats.size,
      sha256,
      addedAt: new Date().toISOString(),
    };

    await writeFile(metadataPath, `${JSON.stringify(attachment, null, 2)}\n`, "utf8");
    out.push(attachment);
  }

  return dedupePdfAttachments(out);
}

export async function listPdfAttachments(projectId: string): Promise<PdfAttachment[]> {
  await getLocalProject(projectId);

  const root = pdfArchiveRoot(projectId);

  if (!existsSync(root)) {
    return [];
  }

  const metadataPaths = await findMetadataFiles(root);
  const attachments: PdfAttachment[] = [];

  for (const metadataPath of metadataPaths) {
    const raw = await readFile(metadataPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const attachment = parsePdfAttachment(parsed, metadataPath);

    if (attachment.projectId === projectId) {
      attachments.push(attachment);
    }
  }

  return dedupePdfAttachments(attachments).sort((left, right) =>
    right.addedAt.localeCompare(left.addedAt) || left.fileName.localeCompare(right.fileName),
  );
}

export async function getPdfAttachmentPreview(args: {
  projectId: string;
  sha256: string;
}): Promise<BinaryAttachmentPreview> {
  const sha256 = normalizeSha256(args.sha256);
  const attachment = (await listPdfAttachments(args.projectId)).find(
    (item) => item.sha256 === sha256,
  );

  if (!attachment) {
    throw new Error(`PDF attachment not found: ${sha256}`);
  }

  const data = await readFile(attachment.storedPath);

  return {
    kind: "pdf",
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    dataUrl: `data:${attachment.mimeType};base64,${data.toString("base64")}`,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  };
}

export async function deletePdfAttachment(args: {
  projectId: string;
  sha256: string;
}): Promise<DeletePdfAttachmentResult> {
  await getLocalProject(args.projectId);

  const sha256 = normalizeSha256(args.sha256);
  const deletedPath = pdfBucketDir(args.projectId, sha256);
  const deleted = existsSync(deletedPath);

  await rm(deletedPath, {
    recursive: true,
    force: true,
  });

  return {
    projectId: args.projectId,
    sha256,
    deleted,
    deletedPath,
  };
}

export async function clearPdfAttachments(
  projectId: string,
): Promise<ClearPdfAttachmentsResult> {
  await getLocalProject(projectId);

  const archiveRoot = pdfArchiveRoot(projectId);
  const existing = existsSync(archiveRoot)
    ? await listPdfAttachments(projectId)
    : [];

  await rm(archiveRoot, {
    recursive: true,
    force: true,
  });

  return {
    projectId,
    deleted: existing.length,
    archiveRoot,
  };
}

export async function copyPdfAttachmentsToClipboard(paths: string[]): Promise<{
  copied: number;
  mode: "pdf-files";
}> {
  if (paths.length === 0) {
    return { copied: 0, mode: "pdf-files" };
  }

  const absolutePaths = paths.map((filePath) => path.resolve(filePath));

  for (const pdfPath of absolutePaths) {
    const fileStats = await stat(pdfPath);

    if (!fileStats.isFile()) {
      throw new Error(`Clipboard PDF attachment is not a file: ${pdfPath}`);
    }

    if (path.extname(pdfPath).toLowerCase() !== PDF_EXTENSION) {
      throw new Error(`Clipboard attachment is not a PDF: ${pdfPath}`);
    }
  }

  if (process.platform !== "darwin") {
    throw new Error("Copying PDF attachments is currently implemented for macOS only.");
  }

  await copyFilesToMacClipboard(absolutePaths);

  return {
    copied: absolutePaths.length,
    mode: "pdf-files",
  };
}

export async function extractPdfTextForAttachments(
  attachments: PdfAttachment[],
): Promise<PdfTextExtraction[]> {
  const out: PdfTextExtraction[] = [];

  for (const attachment of attachments) {
    out.push(await extractPdfTextForAttachment(attachment));
  }

  return out;
}

export function renderPdfTextExtractionsMarkdown(extractions: PdfTextExtraction[]): string {
  if (extractions.length === 0) {
    return "";
  }

  const lines: string[] = ["# PDF Text", ""];

  for (const extraction of extractions) {
    lines.push(`## ${extraction.fileName}`);
    lines.push(`Status: ${extraction.status}`);
    lines.push(`SHA-256: ${extraction.sha256}`);

    if (extraction.title) {
      lines.push(`Title: ${extraction.title}`);
    }

    if (extraction.pageCount !== undefined) {
      lines.push(`Pages: ${extraction.pageCount}`);
    }

    if (extraction.error) {
      lines.push(`Error: ${extraction.error}`);
    }

    lines.push("");
    lines.push(extraction.text || "No extractable text found.");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

async function extractPdfTextForAttachment(
  attachment: PdfAttachment,
): Promise<PdfTextExtraction> {
  const extractedAt = new Date().toISOString();

  try {
    const buffer = await readFile(attachment.storedPath);
    const parsed = extractPdfText(buffer);

    return {
      pdfId: attachment.id,
      sha256: attachment.sha256,
      fileName: attachment.fileName,
      status: "completed",
      title: parsed.title,
      text: parsed.text,
      ...(parsed.pageCount !== undefined ? { pageCount: parsed.pageCount } : {}),
      extractedAt,
    };
  } catch (error: unknown) {
    return {
      pdfId: attachment.id,
      sha256: attachment.sha256,
      fileName: attachment.fileName,
      status: "failed",
      title: "",
      text: "",
      error: toErrorMessage(error),
      extractedAt,
    };
  }
}

async function copyFilesToMacClipboard(absolutePaths: string[]): Promise<void> {
  const helperPath = path.join(
    os.tmpdir(),
    `rapid-prompt-copy-files-${process.pid}-${Date.now()}.swift`,
  );

  await writeFile(helperPath, COPY_FILES_SWIFT, "utf8");

  try {
    await execFileAsync("/usr/bin/swift", [helperPath], {
      env: {
        ...process.env,
        RAPID_PROMPT_FILE_PATHS: JSON.stringify(absolutePaths),
      },
      timeout: 20_000,
    });
  } catch (error: unknown) {
    throw new Error(
      `Failed to copy PDF attachments to macOS clipboard. ` +
        `Ensure Xcode Command Line Tools are installed. ${toErrorMessage(error)}`,
      { cause: error },
    );
  } finally {
    await rm(helperPath, { force: true });
  }
}

async function findMetadataFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];

  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...await findMetadataFiles(candidate));
    } else if (entry.isFile() && entry.name === PDF_METADATA_FILE) {
      out.push(candidate);
    }
  }

  return out;
}

function extractPdfText(buffer: Buffer): {
  title: string;
  text: string;
  pageCount?: number;
} {
  const raw = buffer.toString("latin1");
  const pageCount = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length || undefined;
  const title = extractPdfTitle(raw);
  const textSources = [raw, ...extractPdfStreams(buffer, raw)];
  const fragments: string[] = [];

  for (const source of textSources) {
    fragments.push(...extractTextFragments(source));
  }

  const text = normalizeExtractedText(uniqueLines(fragments).join("\n")).slice(0, 120_000);

  return {
    title,
    text,
    ...(pageCount !== undefined ? { pageCount } : {}),
  };
}

function extractPdfStreams(buffer: Buffer, raw: string): string[] {
  const out: string[] = [];
  const streamToken = "stream";
  let offset = 0;

  while (offset < raw.length) {
    const streamIndex = raw.indexOf(streamToken, offset);

    if (streamIndex < 0) {
      break;
    }

    let dataStart = streamIndex + streamToken.length;

    if (raw[dataStart] === "\r" && raw[dataStart + 1] === "\n") {
      dataStart += 2;
    } else if (raw[dataStart] === "\n") {
      dataStart += 1;
    } else if (raw[dataStart] === "\r") {
      dataStart += 1;
    }

    const endIndex = raw.indexOf("endstream", dataStart);

    if (endIndex < 0) {
      break;
    }

    const header = raw.slice(Math.max(0, streamIndex - 700), streamIndex);
    let dataEnd = endIndex;

    while (dataEnd > dataStart && (buffer[dataEnd - 1] === 10 || buffer[dataEnd - 1] === 13)) {
      dataEnd -= 1;
    }

    const streamBytes = buffer.subarray(dataStart, dataEnd);

    try {
      if (header.includes("/FlateDecode")) {
        out.push(inflateSync(streamBytes).toString("latin1"));
      } else {
        out.push(streamBytes.toString("latin1"));
      }
    } catch {
      // Ignore one corrupt stream. Other streams may still contain useful text.
    }

    offset = endIndex + "endstream".length;
  }

  return out;
}

function extractPdfTitle(raw: string): string {
  const literalMatch = /\/Title\s*\(([^)]{1,300})\)/.exec(raw);

  if (literalMatch?.[1]) {
    return decodePdfLiteral(literalMatch[1]).trim();
  }

  const hexMatch = /\/Title\s*<([0-9a-fA-F\s]{4,600})>/.exec(raw);

  if (hexMatch?.[1]) {
    return decodePdfHex(hexMatch[1]).trim();
  }

  return "";
}

function extractTextFragments(source: string): string[] {
  const fragments: string[] = [];

  fragments.push(...extractLiteralStrings(source));
  fragments.push(...extractHexStrings(source));

  return fragments
    .map((fragment) => normalizeExtractedText(fragment))
    .filter((fragment) => /[a-zA-Z0-9]/.test(fragment) && fragment.length >= 3);
}

function extractLiteralStrings(source: string): string[] {
  const out: string[] = [];
  let index = 0;

  while (index < source.length) {
    const open = source.indexOf("(", index);

    if (open < 0) {
      break;
    }

    let cursor = open + 1;
    let depth = 1;
    let escaped = false;
    let value = "";

    while (cursor < source.length && depth > 0) {
      const ch = source[cursor] ?? "";

      if (escaped) {
        value += decodePdfEscape(ch);
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "(") {
        depth += 1;
        value += ch;
      } else if (ch === ")") {
        depth -= 1;

        if (depth > 0) {
          value += ch;
        }
      } else {
        value += ch;
      }

      cursor += 1;
    }

    if (value.length > 0) {
      out.push(decodePdfLiteral(value));
    }

    index = cursor;
  }

  return out;
}

function extractHexStrings(source: string): string[] {
  const out: string[] = [];
  const regex = /<([0-9a-fA-F\s]{6,})>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const decoded = decodePdfHex(match[1] ?? "");

    if (decoded) {
      out.push(decoded);
    }
  }

  return out;
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "")
    .replace(/\\f/g, "")
    .replace(/\\\\/g, "\\")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")");
}

function decodePdfEscape(value: string): string {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\n";
    case "t":
      return "\t";
    case "b":
    case "f":
      return "";
    default:
      return value;
  }
}

function decodePdfHex(value: string): string {
  const clean = value.replace(/\s+/g, "");

  if (clean.length < 2 || clean.length % 2 !== 0) {
    return "";
  }

  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(Number.parseInt(clean.slice(i, i + 2), 16));
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const chars: string[] = [];

    for (let i = 2; i + 1 < bytes.length; i += 2) {
      const code = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
      chars.push(String.fromCharCode(code));
    }

    return chars.join("");
  }

  return Buffer.from(bytes).toString("latin1");
}

function normalizeExtractedText(value: string): string {
  return collapsePdfWhitespace(stripPdfControlCharacters(value));
}

function stripPdfControlCharacters(value: string): string {
  let out = "";

  for (const char of value) {
    const code = char.charCodeAt(0);

    if (code === 0) {
      continue;
    }

    if (
      (code >= 1 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    ) {
      out += " ";
      continue;
    }

    out += char;
  }

  return out;
}

function collapsePdfWhitespace(value: string): string {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uniqueLines(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const normalized = normalizeExtractedText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid PDF archive sha256: ${value}`);
  }

  return normalized;
}

function pdfArchiveRoot(projectId: string): string {
  return path.join(projectDir(projectId), "attachments", "pdfs");
}

function pdfBucketDir(projectId: string, sha256: string): string {
  return path.join(pdfArchiveRoot(projectId), sha256.slice(0, 2), sha256);
}

function parsePdfAttachment(value: unknown, metadataPath: string): PdfAttachment {
  if (!isRecord(value)) {
    throw new Error(`Invalid PDF metadata file: ${metadataPath}`);
  }

  return {
    id: requiredString(value, "id", metadataPath),
    projectId: requiredString(value, "projectId", metadataPath),
    sourcePath: requiredString(value, "sourcePath", metadataPath),
    storedPath: requiredString(value, "storedPath", metadataPath),
    fileName: requiredString(value, "fileName", metadataPath),
    extension: requiredString(value, "extension", metadataPath),
    mimeType: "application/pdf",
    sizeBytes: requiredNumber(value, "sizeBytes", metadataPath),
    sha256: requiredString(value, "sha256", metadataPath),
    addedAt: requiredString(value, "addedAt", metadataPath),
  };
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  metadataPath: string,
): string {
  const value = record[key];

  if (typeof value !== "string") {
    throw new Error(`Invalid PDF metadata property "${key}" in ${metadataPath}`);
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
    throw new Error(`Invalid PDF metadata property "${key}" in ${metadataPath}`);
  }

  return value;
}

function dedupePdfAttachments(attachments: PdfAttachment[]): PdfAttachment[] {
  const byHash = new Map<string, PdfAttachment>();

  for (const attachment of attachments) {
    byHash.set(attachment.sha256, attachment);
  }

  return Array.from(byHash.values());
}

async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error === null || error === undefined) {
    return "Unknown error";
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}
