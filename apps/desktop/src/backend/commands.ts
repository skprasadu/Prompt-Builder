import { ipcMain, shell } from "electron";

import { fetchApiTable, fetchApiTableFromUrl, extractApiUnits } from "./apiTable";
import { extractHtmlBlocks, extractRegexBlocks } from "./blocks";
import { inspectExcel, extractExcelUnits } from "./excel";
import { scanDir } from "./fileTree";
import { readAsciiFiles } from "./ascii";
import { buildRagContext, createEntry, deleteEntry, getEntryDetail, listEntries, searchEntries } from "./entryStore";
import { generateInsight } from "./rag/ragService";
import { getProjectState, saveProjectState } from "./projectStateStore";
import { createLocalProject, deleteLocalProject, getLocalProject, listLocalProjects } from "./projectStore";
import { loadSystemPrompt, saveSystemPrompt } from "./systemPrompt";
import { addImageAttachments, clearImageAttachments, copyImageAttachmentsToClipboard, deleteImageAttachment, getImageAttachmentPreview, listImageAttachments, type ImageAttachment } from "./attachments/imageAttachmentStore";
import { addPdfAttachments, clearPdfAttachments, copyPdfAttachmentsToClipboard, deletePdfAttachment, getPdfAttachmentPreview, listPdfAttachments, type PdfAttachment } from "./attachments/pdfAttachmentStore";
import { addPythonPatchAttachments, getPythonPatchAttachmentPreview, listPythonPatchAttachments } from "./attachments/patchAttachmentStore";
import { closeRequirement, createRequirement, ensureRequirementActiveIteration, getRequirement, listRequirements, saveRequirementIteration, searchRequirements } from "./requirementStore";
import {
  closeRequirementIterationWithKnowledge,
  compileRequirementPrompt,
  extractRequirementIterationKnowledge,
  prepareRequirementCloseout,
  refreshRequirementIterationMemories,
} from "./requirementIntelligenceService";

type CommandArgs = Record<string, unknown>;
type EntryPurpose = "software_implementation" | "research";

export function registerCommandHandlers(): void {
  ipcMain.handle(
    "rapid-prompt:invoke",
    async (_event, command: string, args: CommandArgs = {}) => {
      switch (command) {
        case "scan_dir":
          return scanDir(requiredString(args, "path"));

        case "read_ascii_files":
          return readAsciiFiles(
            requiredStringArray(args, "paths"),
            optionalNumber(args, "maxBytes") ?? 512 * 1024,
          );

        case "load_system_prompt":
          return loadSystemPrompt(optionalString(args, "projectId"));

        case "save_system_prompt":
          return saveSystemPrompt(
            requiredString(args, "value"),
            optionalString(args, "projectId"),
          );

        case "inspect_excel":
          return inspectExcel(requiredString(args, "path"));

        case "extract_excel_units":
          return extractExcelUnits(
            requiredString(args, "path"),
            requiredObject(args, "config"),
          );

        case "extract_regex_blocks":
          return extractRegexBlocks(
            requiredString(args, "path"),
            requiredObject(args, "config"),
          );

        case "extract_html_blocks":
          return extractHtmlBlocks(
            requiredString(args, "path"),
            requiredObject(args, "config"),
          );

        case "fetch_api_table":
          return fetchApiTable(
            requiredString(args, "endpoint"),
            requiredString(args, "path"),
          );

        case "fetch_api_table_from_url":
          return fetchApiTableFromUrl(
            requiredString(args, "endpoint"),
            requiredString(args, "url"),
          );

        case "extract_api_units":
          return extractApiUnits(
            requiredString(args, "endpoint"),
            requiredString(args, "path"),
            requiredString(args, "which"),
            optionalStringRecord(args, "headers"),
          );

        case "project:list":
          return listLocalProjects();

        case "project:create":
          return createLocalProject({
            name: requiredString(args, "name"),
            rootPath: requiredString(args, "rootPath"),
          });

        case "project:get":
          return getLocalProject(requiredString(args, "projectId"));

        case "project:delete":
          return deleteLocalProject(requiredString(args, "projectId"));

        case "project:get_state":
          return getProjectState(requiredString(args, "projectId"));

        case "project:save_state":
          return saveProjectState({
            projectId: requiredString(args, "projectId"),
            state: requiredObject(args, "state"),
          });

        case "requirement:create":
          return createRequirement({
            projectId: requiredString(args, "projectId"),
            title: requiredString(args, "title"),
            objective: requiredString(args, "objective"),
          });

        case "requirement:list":
          return listRequirements(requiredString(args, "projectId"));

        case "requirement:get":
          return getRequirement({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
          });

        case "requirement:ensure_active_iteration":
          return ensureRequirementActiveIteration({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
          });

        case "requirement:save_iteration":
          return saveRequirementIteration({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
            iterationId: requiredString(args, "iterationId"),
            instruction: optionalString(args, "instruction") ?? "",
            assembledPrompt: optionalString(args, "assembledPrompt") ?? "",
            aiOutput: optionalString(args, "aiOutput") ?? "",
            selectedPaths: optionalStringArray(args, "selectedPaths") ?? [],
            imageAttachmentSha256s:
              optionalStringArray(args, "imageAttachmentSha256s") ?? [],
            pdfAttachmentSha256s:
              optionalStringArray(args, "pdfAttachmentSha256s") ?? [],
            patchAttachmentSha256s:
              optionalStringArray(args, "patchAttachmentSha256s") ?? [],
            patchChangedPaths:
              optionalStringArray(args, "patchChangedPaths") ?? [],
          });

        case "requirement:extract_iteration_knowledge":
          return extractRequirementIterationKnowledge({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
            iterationId: requiredString(args, "iterationId"),
            instruction: optionalString(args, "instruction") ?? "",
            aiOutput: requiredString(args, "aiOutput"),
            selectedPaths: optionalStringArray(args, "selectedPaths") ?? [],
            patchAttachmentSha256s:
              optionalStringArray(args, "patchAttachmentSha256s") ?? [],
            patchChangedPaths:
              optionalStringArray(args, "patchChangedPaths") ?? [],
          });

        case "requirement:refresh_iteration_memories":
          return refreshRequirementIterationMemories({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
          });

        case "requirement:compile_prompt":
          return compileRequirementPrompt({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
            instruction: requiredString(args, "instruction"),
            baseSystemPrompt: optionalString(args, "baseSystemPrompt") ?? "",
            selectedPaths: optionalStringArray(args, "selectedPaths") ?? [],
          });

        case "requirement:prepare_closeout":
          return prepareRequirementCloseout({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
          });

        case "requirement:close_iteration":
          return closeRequirementIterationWithKnowledge({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
            iterationId: requiredString(args, "iterationId"),
            instruction: requiredString(args, "instruction"),
            assembledPrompt: optionalString(args, "assembledPrompt") ?? "",
            aiOutput: optionalString(args, "aiOutput") ?? "",
            selectedPaths: optionalStringArray(args, "selectedPaths") ?? [],
            imageAttachmentSha256s:
              optionalStringArray(args, "imageAttachmentSha256s") ?? [],
            pdfAttachmentSha256s:
              optionalStringArray(args, "pdfAttachmentSha256s") ?? [],
            patchAttachmentSha256s:
              optionalStringArray(args, "patchAttachmentSha256s") ?? [],
            patchChangedPaths:
              optionalStringArray(args, "patchChangedPaths") ?? [],
          });

        case "requirement:close":
          return closeRequirement({
            projectId: requiredString(args, "projectId"),
            requirementId: requiredString(args, "requirementId"),
            outcome: requiredString(args, "outcome"),
            decisions: optionalStringArray(args, "decisions") ?? [],
            reusablePatterns: optionalStringArray(args, "reusablePatterns") ?? [],
            rejectedApproaches: optionalStringArray(args, "rejectedApproaches") ?? [],
          });

        case "requirement:search": {
          const limit = optionalNumber(args, "limit");
          return searchRequirements({
            projectId: requiredString(args, "projectId"),
            query: requiredString(args, "query"),
            ...(limit !== undefined ? { limit } : {}),
          });
        }

        case "attachments:add_python_patches":
          return addPythonPatchAttachments({
            projectId: requiredString(args, "projectId"),
            paths: requiredStringArray(args, "paths"),
          });

        case "attachments:list_python_patches":
          return listPythonPatchAttachments(
            requiredString(args, "projectId"),
          );

        case "attachments:preview_python_patch": {
          const maxCharacters = optionalNumber(args, "maxCharacters");
          return getPythonPatchAttachmentPreview({
            projectId: requiredString(args, "projectId"),
            sha256: requiredString(args, "sha256"),
            ...(maxCharacters !== undefined ? { maxCharacters } : {}),
          });
        }

        case "attachments:add_images":
          return addImageAttachments({
            projectId: requiredString(args, "projectId"),
            paths: requiredStringArray(args, "paths"),
          });

        case "attachments:list_images":
          return listImageAttachments(requiredString(args, "projectId"));

        case "attachments:preview_image":
          return getImageAttachmentPreview({
            projectId: requiredString(args, "projectId"),
            sha256: requiredString(args, "sha256"),
          });

        case "attachments:delete_image":
          return deleteImageAttachment({
            projectId: requiredString(args, "projectId"),
            sha256: requiredString(args, "sha256"),
          });

        case "attachments:clear_images":
          return clearImageAttachments(requiredString(args, "projectId"));

        case "attachments:copy_images_to_clipboard":
          return copyImageAttachmentsToClipboard(requiredStringArray(args, "paths"));

        case "attachments:add_pdfs":
          return addPdfAttachments({
            projectId: requiredString(args, "projectId"),
            paths: requiredStringArray(args, "paths"),
          });

        case "attachments:list_pdfs":
          return listPdfAttachments(requiredString(args, "projectId"));

        case "attachments:preview_pdf":
          return getPdfAttachmentPreview({
            projectId: requiredString(args, "projectId"),
            sha256: requiredString(args, "sha256"),
          });

        case "attachments:delete_pdf":
          return deletePdfAttachment({
            projectId: requiredString(args, "projectId"),
            sha256: requiredString(args, "sha256"),
          });

        case "attachments:clear_pdfs":
          return clearPdfAttachments(requiredString(args, "projectId"));

        case "attachments:copy_pdfs_to_clipboard":
          return copyPdfAttachmentsToClipboard(requiredStringArray(args, "paths"));

        case "entry:create":
          return createEntry({
            projectId: requiredString(args, "projectId"),
            purpose: parseEntryPurpose(optionalString(args, "purpose")),
            name: requiredString(args, "name"),
            description: optionalString(args, "description") ?? "",
            notes: optionalString(args, "notes") ?? "",
            aiOutput: optionalString(args, "aiOutput") ?? "",
            systemPrompt: optionalString(args, "systemPrompt") ?? "",
            promptText: optionalString(args, "promptText") ?? "",
            selectedPaths: optionalStringArray(args, "selectedPaths") ?? [],
            imageAttachments: optionalImageAttachments(args, "imageAttachments") ?? [],
            pdfAttachments: optionalPdfAttachments(args, "pdfAttachments") ?? [],
            includeTree: optionalBoolean(args, "includeTree") ?? false,
            includeGitChangedFiles: optionalBoolean(args, "includeGitChangedFiles") ?? false,
            tokenCount: optionalNumber(args, "tokenCount") ?? 0,
          });

        case "entry:list":
          return listEntries(requiredString(args, "projectId"));

        case "entry:get":
          return getEntryDetail({
            projectId: requiredString(args, "projectId"),
            entryId: requiredString(args, "entryId"),
          });

        case "entry:delete":
          return deleteEntry({
            projectId: requiredString(args, "projectId"),
            entryId: requiredString(args, "entryId"),
          });

        case "entry:search": {
          const limit = optionalNumber(args, "limit");

          return searchEntries({
            projectId: requiredString(args, "projectId"),
            query: requiredString(args, "query"),
            ...(limit !== undefined ? { limit } : {}),
          });
        }

        case "rag:build_context": {
          const limit = optionalNumber(args, "limit");
          const selectedEntryId = optionalString(args, "selectedEntryId");

          return buildRagContext({
            projectId: requiredString(args, "projectId"),
            query: requiredString(args, "query"),
            ...(selectedEntryId ? { selectedEntryId } : {}),
            ...(limit !== undefined ? { limit } : {}),
          });
        }

        case "insight:generate": {
          const selectedEntryId = optionalString(args, "selectedEntryId");

          return generateInsight({
            projectId: requiredString(args, "projectId"),
            intentId: requiredString(args, "intentId"),
            ...(selectedEntryId ? { selectedEntryId } : {}),
          });
        }

        case "shell:open_path":
          return shell.openPath(requiredString(args, "path"));

        default:
          throw new Error(`Unknown desktop command: ${command}`);
      }
    },
  );
}

function requiredString(args: CommandArgs, key: string): string {
  const value = args[key];

  if (typeof value !== "string") {
    throw new Error(`Missing required string argument: ${key}`);
  }

  return value;
}

function optionalString(args: CommandArgs, key: string): string | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Expected string argument: ${key}`);
  }

  return value;
}

function requiredStringArray(args: CommandArgs, key: string): string[] {
  const value = args[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Missing required string[] argument: ${key}`);
  }

  return value;
}

function optionalStringArray(args: CommandArgs, key: string): string[] | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Expected string[] argument: ${key}`);
  }

  return value;
}

function requiredObject<T extends object>(args: CommandArgs, key: string): T {
  const value = args[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Missing required object argument: ${key}`);
  }

  return value as T;
}

function optionalNumber(args: CommandArgs, key: string): number | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number") {
    throw new Error(`Expected number argument: ${key}`);
  }

  return value;
}

function optionalBoolean(args: CommandArgs, key: string): boolean | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Expected boolean argument: ${key}`);
  }

  return value;
}

function optionalImageAttachments(
  args: CommandArgs,
  key: string,
): ImageAttachment[] | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Expected ImageAttachment[] argument: ${key}`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Expected ImageAttachment at ${key}[${index}]`);
    }

    return {
      id: requiredRecordString(item, "id"),
      projectId: requiredRecordString(item, "projectId"),
      sourcePath: requiredRecordString(item, "sourcePath"),
      storedPath: requiredRecordString(item, "storedPath"),
      fileName: requiredRecordString(item, "fileName"),
      extension: requiredRecordString(item, "extension"),
      mimeType: requiredRecordString(item, "mimeType"),
      sizeBytes: requiredRecordNumber(item, "sizeBytes"),
      sha256: requiredRecordString(item, "sha256"),
      addedAt: requiredRecordString(item, "addedAt"),
    };
  });
}

function optionalPdfAttachments(
  args: CommandArgs,
  key: string,
): PdfAttachment[] | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Expected PdfAttachment[] argument: ${key}`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Expected PdfAttachment at ${key}[${index}]`);
    }

    return {
      id: requiredRecordString(item, "id"),
      projectId: requiredRecordString(item, "projectId"),
      sourcePath: requiredRecordString(item, "sourcePath"),
      storedPath: requiredRecordString(item, "storedPath"),
      fileName: requiredRecordString(item, "fileName"),
      extension: requiredRecordString(item, "extension"),
      mimeType: "application/pdf",
      sizeBytes: requiredRecordNumber(item, "sizeBytes"),
      sha256: requiredRecordString(item, "sha256"),
      addedAt: requiredRecordString(item, "addedAt"),
    };
  });
}

function optionalStringRecord(
  args: CommandArgs,
  key: string,
): Record<string, string> | undefined {
  const value = args[key];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object argument: ${key}`);
  }

  const out: Record<string, string> = {};

  for (const [recordKey, recordValue] of Object.entries(value)) {
    if (typeof recordValue === "string") {
      out[recordKey] = recordValue;
    }
  }

  return out;
}

function parseEntryPurpose(value: string | undefined): EntryPurpose {
  if (value === undefined || value === "software_implementation") {
    return "software_implementation";
  }

  if (value === "research") {
    return "research";
  }

  throw new Error(`Invalid entry purpose: ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== "string") {
    throw new Error(`Missing required string property: ${key}`);
  }

  return value;
}

function requiredRecordNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];

  if (typeof value !== "number") {
    throw new Error(`Missing required number property: ${key}`);
  }

  return value;
}


