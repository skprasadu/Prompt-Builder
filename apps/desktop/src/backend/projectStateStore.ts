import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { projectDir } from "./projectStore";
import type { ImageAttachment } from "./attachments/imageAttachmentStore";
import type { PdfAttachment } from "./attachments/pdfAttachmentStore";

export interface LocalProjectState {
  promptText: string;
  includeTree: boolean;
  selectedPaths: string[];
  expandedPaths: string[];
  imageAttachments: ImageAttachment[];
  selectedImageAttachmentSha256s: string[];
  pdfAttachments: PdfAttachment[];
  selectedPdfAttachmentSha256s: string[];
  folderPanelWidth: number;
  updatedAt: string;
}

const LOCAL_STATE_FILE = "local-state.json";

export async function getProjectState(projectId: string): Promise<LocalProjectState> {
  const filePath = statePath(projectId);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const normalized = normalizeProjectState(parsed, projectId);

    if (normalized) {
      return normalized;
    }
  } catch {
    // Missing or corrupt state falls back to a clean state.
  }

  return defaultProjectState();
}

export async function saveProjectState(args: {
  projectId: string;
  state: Partial<LocalProjectState>;
}): Promise<LocalProjectState> {
  const current = await getProjectState(args.projectId);
  const next: LocalProjectState = {
    ...current,
    ...args.state,
    selectedPaths: args.state.selectedPaths ?? current.selectedPaths,
    expandedPaths: args.state.expandedPaths ?? current.expandedPaths,
    imageAttachments: args.state.imageAttachments ?? current.imageAttachments,
    selectedImageAttachmentSha256s:
      args.state.selectedImageAttachmentSha256s ?? current.selectedImageAttachmentSha256s,
    pdfAttachments: args.state.pdfAttachments ?? current.pdfAttachments,
    selectedPdfAttachmentSha256s:
      args.state.selectedPdfAttachmentSha256s ?? current.selectedPdfAttachmentSha256s,
    updatedAt: new Date().toISOString(),
  };

  const dir = projectDir(args.projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(statePath(args.projectId), `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return next;
}

function statePath(projectId: string): string {
  return path.join(projectDir(projectId), LOCAL_STATE_FILE);
}

function defaultProjectState(): LocalProjectState {
  return {
    promptText: "",
    includeTree: false,
    selectedPaths: [],
    expandedPaths: [],
    imageAttachments: [],
    selectedImageAttachmentSha256s: [],
    pdfAttachments: [],
    selectedPdfAttachmentSha256s: [],
    folderPanelWidth: 360,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProjectState(
  value: unknown,
  projectId: string,
): LocalProjectState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.promptText !== "string" ||
    typeof value.includeTree !== "boolean" ||
    !isStringArray(value.selectedPaths) ||
    !isStringArray(value.expandedPaths) ||
    typeof value.folderPanelWidth !== "number" ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  const imageAttachments = parseImageAttachments(value.imageAttachments, projectId);
  const selectedImageAttachmentSha256s = isStringArray(value.selectedImageAttachmentSha256s)
    ? value.selectedImageAttachmentSha256s.filter((sha256) =>
        imageAttachments.some((attachment) => attachment.sha256 === sha256),
      )
    : imageAttachments.map((attachment) => attachment.sha256);
  const pdfAttachments = parsePdfAttachments(value.pdfAttachments, projectId);
  const selectedPdfAttachmentSha256s = isStringArray(value.selectedPdfAttachmentSha256s)
    ? value.selectedPdfAttachmentSha256s.filter((sha256) =>
        pdfAttachments.some((attachment) => attachment.sha256 === sha256),
      )
    : pdfAttachments.map((attachment) => attachment.sha256);

  return {
    promptText: value.promptText,
    includeTree: value.includeTree,
    selectedPaths: value.selectedPaths,
    expandedPaths: value.expandedPaths,
    imageAttachments,
    selectedImageAttachmentSha256s,
    pdfAttachments,
    selectedPdfAttachmentSha256s,
    folderPanelWidth: value.folderPanelWidth,
    updatedAt: value.updatedAt,
  };
}

function parseImageAttachments(
  value: unknown,
  projectId: string,
): ImageAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isImageAttachment)
    .filter((attachment) => attachment.projectId === projectId);
}

function parsePdfAttachments(
  value: unknown,
  projectId: string,
): PdfAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isPdfAttachment)
    .filter((attachment) => attachment.projectId === projectId);
}

function isPdfAttachment(value: unknown): value is PdfAttachment {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.sourcePath === "string" &&
    typeof value.storedPath === "string" &&
    typeof value.fileName === "string" &&
    typeof value.extension === "string" &&
    value.mimeType === "application/pdf" &&
    typeof value.sizeBytes === "number" &&
    typeof value.sha256 === "string" &&
    typeof value.addedAt === "string"
  );
}

function isImageAttachment(value: unknown): value is ImageAttachment {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.projectId === "string" &&
    typeof value.sourcePath === "string" &&
    typeof value.storedPath === "string" &&
    typeof value.fileName === "string" &&
    typeof value.extension === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.sizeBytes === "number" &&
    typeof value.sha256 === "string" &&
    typeof value.addedAt === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
