import { clipboard, nativeImage } from "electron";
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

import { getLocalProject, projectDir } from "../projectStore";

import type {
  BinaryAttachmentPreview,
} from "@rapid-prompt/prompt-builder-contracts";

const execFileAsync = promisify(execFile);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
]);

const IMAGE_METADATA_FILE = "metadata.json";

const COPY_MULTIPLE_IMAGES_SWIFT = `
import AppKit
import Foundation

enum RapidPromptClipboardError: Error {
  case invalidPayload
  case emptyImage(String)
  case pngConversionFailed(String)
  case writeFailed
}

let payload = ProcessInfo.processInfo.environment["RAPID_PROMPT_IMAGE_PATHS"] ?? "[]"

guard let payloadData = payload.data(using: .utf8),
      let decoded = try JSONSerialization.jsonObject(with: payloadData) as? [String] else {
  throw RapidPromptClipboardError.invalidPayload
}

let pasteboard = NSPasteboard.general
pasteboard.clearContents()

var items: [NSPasteboardItem] = []

for imagePath in decoded {
  let url = URL(fileURLWithPath: imagePath)

  guard let image = NSImage(contentsOf: url) else {
    throw RapidPromptClipboardError.emptyImage(imagePath)
  }

  guard let tiffData = image.tiffRepresentation,
        let bitmap = NSBitmapImageRep(data: tiffData),
        let pngData = bitmap.representation(using: .png, properties: [:]) else {
    throw RapidPromptClipboardError.pngConversionFailed(imagePath)
  }

  let item = NSPasteboardItem()
  item.setData(pngData, forType: .png)
  item.setString(url.absoluteString, forType: .fileURL)
  item.setString(url.absoluteString, forType: .URL)
  items.append(item)
}

if !pasteboard.writeObjects(items) {
  throw RapidPromptClipboardError.writeFailed
}
`;

export interface ImageAttachment {
  id: string;
  projectId: string;
  sourcePath: string;
  storedPath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  addedAt: string;
}

export interface DeleteImageAttachmentResult {
  projectId: string;
  sha256: string;
  deleted: boolean;
  deletedPath: string;
}

export interface ClearImageAttachmentsResult {
  projectId: string;
  deleted: number;
  archiveRoot: string;
}

export async function addImageAttachments(args: {
  projectId: string;
  paths: string[];
}): Promise<ImageAttachment[]> {
  await getLocalProject(args.projectId);

  if (args.paths.length === 0) {
    return [];
  }

  const seenPaths = new Set<string>();
  const out: ImageAttachment[] = [];

  for (const rawPath of args.paths) {
    const sourcePath = path.resolve(rawPath);

    if (seenPaths.has(sourcePath)) {
      continue;
    }
    seenPaths.add(sourcePath);

    const extension = path.extname(sourcePath).toLowerCase();

    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Only image attachments are supported for now: ${sourcePath}`);
    }

    const sourceStats = await stat(sourcePath);

    if (!sourceStats.isFile()) {
      throw new Error(`Image attachment is not a file: ${sourcePath}`);
    }

    const sha256 = await sha256File(sourcePath);
    const bucketDir = imageBucketDir(args.projectId, sha256);
    const storedPath = path.join(bucketDir, `original${extension}`);
    const metadataPath = path.join(bucketDir, IMAGE_METADATA_FILE);

    await mkdir(bucketDir, { recursive: true });

    if (!existsSync(storedPath)) {
      await copyFile(sourcePath, storedPath);
    }

    const attachment: ImageAttachment = {
      id: `img_${sha256.slice(0, 16)}`,
      projectId: args.projectId,
      sourcePath,
      storedPath,
      fileName: path.basename(sourcePath),
      extension,
      mimeType: mimeTypeForExtension(extension),
      sizeBytes: sourceStats.size,
      sha256,
      addedAt: new Date().toISOString(),
    };

    await writeFile(metadataPath, `${JSON.stringify(attachment, null, 2)}\n`, "utf8");
    out.push(attachment);
  }

  return dedupeAttachments(out);
}

export async function listImageAttachments(projectId: string): Promise<ImageAttachment[]> {
  await getLocalProject(projectId);

  const root = imageArchiveRoot(projectId);

  if (!existsSync(root)) {
    return [];
  }

  const metadataPaths = await findMetadataFiles(root);
  const attachments: ImageAttachment[] = [];

  for (const metadataPath of metadataPaths) {
    const raw = await readFile(metadataPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const attachment = parseImageAttachment(parsed, metadataPath);

    if (attachment.projectId === projectId) {
      attachments.push(attachment);
    }
  }

  return dedupeAttachments(attachments).sort((left, right) =>
    right.addedAt.localeCompare(left.addedAt) || left.fileName.localeCompare(right.fileName),
  );
}

export async function getImageAttachmentPreview(args: {
  projectId: string;
  sha256: string;
}): Promise<BinaryAttachmentPreview> {
  const sha256 = normalizeSha256(args.sha256);
  const attachment = (await listImageAttachments(args.projectId)).find(
    (item) => item.sha256 === sha256,
  );

  if (!attachment) {
    throw new Error(`Image attachment not found: ${sha256}`);
  }

  const data = await readFile(attachment.storedPath);

  return {
    kind: "image",
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    dataUrl: `data:${attachment.mimeType};base64,${data.toString("base64")}`,
    sizeBytes: attachment.sizeBytes,
    sha256: attachment.sha256,
  };
}

export async function deleteImageAttachment(args: {
  projectId: string;
  sha256: string;
}): Promise<DeleteImageAttachmentResult> {
  await getLocalProject(args.projectId);

  const sha256 = normalizeSha256(args.sha256);
  const deletedPath = imageBucketDir(args.projectId, sha256);
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

export async function clearImageAttachments(
  projectId: string,
): Promise<ClearImageAttachmentsResult> {
  await getLocalProject(projectId);

  const archiveRoot = imageArchiveRoot(projectId);
  const existing = existsSync(archiveRoot)
    ? await listImageAttachments(projectId)
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

export async function copyImageAttachmentsToClipboard(paths: string[]): Promise<{
  copied: number;
  mode: "image" | "multiple-images";
}> {
  if (paths.length === 0) {
    return { copied: 0, mode: "image" };
  }

  const absolutePaths = paths.map((filePath) => path.resolve(filePath));

  for (const imagePath of absolutePaths) {
    const fileStats = await stat(imagePath);

    if (!fileStats.isFile()) {
      throw new Error(`Clipboard image attachment is not a file: ${imagePath}`);
    }
  }

  if (absolutePaths.length === 1) {
    copySingleImageToClipboard(absolutePaths[0] ?? "");
    return { copied: 1, mode: "image" };
  }

  if (process.platform !== "darwin") {
    throw new Error("Copying multiple image attachments is currently implemented for macOS only.");
  }

  await copyMultipleImagesToMacClipboard(absolutePaths);

  return {
    copied: absolutePaths.length,
    mode: "multiple-images",
  };
}

function copySingleImageToClipboard(imagePath: string): void {
  const image = nativeImage.createFromPath(imagePath);

  if (image.isEmpty()) {
    throw new Error(`Unable to read image for clipboard: ${imagePath}`);
  }

  clipboard.writeImage(image);
}

async function copyMultipleImagesToMacClipboard(absolutePaths: string[]): Promise<void> {
  const helperPath = path.join(
    os.tmpdir(),
    `rapid-prompt-copy-images-${process.pid}-${Date.now()}.swift`,
  );

  await writeFile(helperPath, COPY_MULTIPLE_IMAGES_SWIFT, "utf8");

  try {
    await execFileAsync("/usr/bin/swift", [helperPath], {
      env: {
        ...process.env,
        RAPID_PROMPT_IMAGE_PATHS: JSON.stringify(absolutePaths),
      },
      timeout: 20_000,
    });
  } catch (error: unknown) {
    throw new Error(
      `Failed to copy multiple images to macOS clipboard. ` +
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
    } else if (entry.isFile() && entry.name === IMAGE_METADATA_FILE) {
      out.push(candidate);
    }
  }

  return out;
}

function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Invalid image archive sha256: ${value}`);
  }

  return normalized;
}

function imageArchiveRoot(projectId: string): string {
  return path.join(projectDir(projectId), "attachments", "images");
}

function imageBucketDir(projectId: string, sha256: string): string {
  return path.join(imageArchiveRoot(projectId), sha256.slice(0, 2), sha256);
}

function parseImageAttachment(value: unknown, metadataPath: string): ImageAttachment {
  if (!isRecord(value)) {
    throw new Error(`Invalid image metadata file: ${metadataPath}`);
  }

  return {
    id: requiredString(value, "id", metadataPath),
    projectId: requiredString(value, "projectId", metadataPath),
    sourcePath: requiredString(value, "sourcePath", metadataPath),
    storedPath: requiredString(value, "storedPath", metadataPath),
    fileName: requiredString(value, "fileName", metadataPath),
    extension: requiredString(value, "extension", metadataPath),
    mimeType: requiredString(value, "mimeType", metadataPath),
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
    throw new Error(`Invalid image metadata property "${key}" in ${metadataPath}`);
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
    throw new Error(`Invalid image metadata property "${key}" in ${metadataPath}`);
  }

  return value;
}

function dedupeAttachments(attachments: ImageAttachment[]): ImageAttachment[] {
  const byHash = new Map<string, ImageAttachment>();

  for (const attachment of attachments) {
    byHash.set(attachment.sha256, attachment);
  }

  return Array.from(byHash.values());
}

async function sha256File(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function mimeTypeForExtension(extension: string): string {
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
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
