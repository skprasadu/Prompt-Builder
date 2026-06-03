import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { projectDir } from "./projectStore";

export interface LocalProjectState {
  promptText: string;
  includeTree: boolean;
  selectedPaths: string[];
  expandedPaths: string[];
  folderPanelWidth: number;
  updatedAt: string;
}

const LOCAL_STATE_FILE = "local-state.json";

export async function getProjectState(projectId: string): Promise<LocalProjectState> {
  const filePath = statePath(projectId);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (isLocalProjectState(parsed)) {
      return parsed;
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
    folderPanelWidth: 360,
    updatedAt: new Date().toISOString(),
  };
}

function isLocalProjectState(value: unknown): value is LocalProjectState {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.promptText === "string" &&
    typeof value.includeTree === "boolean" &&
    Array.isArray(value.selectedPaths) &&
    value.selectedPaths.every((item) => typeof item === "string") &&
    Array.isArray(value.expandedPaths) &&
    value.expandedPaths.every((item) => typeof item === "string") &&
    typeof value.folderPanelWidth === "number" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
