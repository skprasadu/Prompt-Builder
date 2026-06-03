import { ipcMain } from "electron";

import { fetchApiTable, fetchApiTableFromUrl, extractApiUnits } from "./apiTable";
import { extractHtmlBlocks, extractRegexBlocks } from "./blocks";
import { inspectExcel, extractExcelUnits } from "./excel";
import { scanDir } from "./fileTree";
import { readAsciiFiles } from "./ascii";
import { createLocalProject, getLocalProject, listLocalProjects } from "./projectStore";
import { loadSystemPrompt, saveSystemPrompt } from "./systemPrompt";

type CommandArgs = Record<string, unknown>;

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
