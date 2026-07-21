import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

export interface LocalProjectRecord {
  id: string;
  name: string;
  rootPath: string;
  rootPathHash: string;
  cloudProjectId?: string;
  defaultSystemPromptPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteLocalProjectResult {
  projectId: string;
  deleted: boolean;
  deletedPath: string;
  rootPath: string;
}

const RAPID_PROMPT_DIR = ".rapid_prompt";
const PROJECTS_DIR = "projects";
const PROJECT_JSON = "project.json";
const SYSTEM_PROMPT_FILE = "system-prompt.md";

function rapidPromptHome(): string {
  return path.join(os.homedir(), RAPID_PROMPT_DIR);
}

export function globalSystemPromptPath(): string {
  return path.join(rapidPromptHome(), SYSTEM_PROMPT_FILE);
}

export function projectDir(projectId: string): string {
  return path.join(rapidPromptHome(), PROJECTS_DIR, projectId);
}

export function projectSystemPromptPath(projectId: string): string {
  return path.join(projectDir(projectId), SYSTEM_PROMPT_FILE);
}

export async function listLocalProjects(): Promise<LocalProjectRecord[]> {
  await ensureRapidPromptHome();

  const projectsRoot = path.join(rapidPromptHome(), PROJECTS_DIR);

  if (!existsSync(projectsRoot)) {
    return [];
  }

  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects: LocalProjectRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const record = await readProjectRecord(entry.name);

    if (record) {
      projects.push(record);
    }
  }

  projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return projects;
}

export async function getLocalProject(projectId: string): Promise<LocalProjectRecord> {
  const record = await readProjectRecord(projectId);

  if (!record) {
    throw new Error(`Project not found: ${projectId}`);
  }

  return record;
}

export async function createLocalProject(args: {
  name: string;
  rootPath: string;
}): Promise<LocalProjectRecord> {
  const name = normalizeProjectName(args.name);
  const rootPath = args.rootPath.trim();

  if (!rootPath) {
    throw new Error("Project root path is required.");
  }

  const rootStats = await stat(rootPath);

  if (!rootStats.isDirectory()) {
    throw new Error(`Project root is not a directory: ${rootPath}`);
  }

  await ensureRapidPromptHome();

  const now = new Date().toISOString();
  const id = `rp_proj_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const record: LocalProjectRecord = {
    id,
    name,
    rootPath,
    rootPathHash: `sha256:${sha256(rootPath)}`,
    defaultSystemPromptPath: SYSTEM_PROMPT_FILE,
    createdAt: now,
    updatedAt: now,
  };

  await writeProjectRecord(record);

  const systemPromptPath = projectSystemPromptPath(id);
  if (!existsSync(systemPromptPath)) {
    await writeFile(systemPromptPath, "", "utf8");
  }

  return record;
}

export async function deleteLocalProject(projectId: string): Promise<DeleteLocalProjectResult> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const record = await getLocalProject(normalizedProjectId);
  const projectsRoot = path.resolve(rapidPromptHome(), PROJECTS_DIR);
  const deletedPath = path.resolve(projectDir(normalizedProjectId));
  const relativeTarget = path.relative(projectsRoot, deletedPath);

  if (!relativeTarget || relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    throw new Error(`Refusing to delete project outside Rapid Prompt storage: ${deletedPath}`);
  }

  await rm(deletedPath, {
    recursive: true,
    force: true,
  });

  return {
    projectId: record.id,
    deleted: true,
    deletedPath,
    rootPath: record.rootPath,
  };
}

async function ensureRapidPromptHome(): Promise<void> {
  await mkdir(path.join(rapidPromptHome(), PROJECTS_DIR), { recursive: true });
}

async function readProjectRecord(projectId: string): Promise<LocalProjectRecord | null> {
  const filePath = path.join(projectDir(projectId), PROJECT_JSON);

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (isLocalProjectRecord(parsed)) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

async function writeProjectRecord(record: LocalProjectRecord): Promise<void> {
  const dir = projectDir(record.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, PROJECT_JSON), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function normalizeProjectName(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length > 0) {
    return trimmed.replace(/[\\/]/g, "_");
  }

  return "Untitled Project";
}

function normalizeProjectId(value: string): string {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\")
  ) {
    throw new Error(`Invalid project id: ${value}`);
  }

  return trimmed;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isLocalProjectRecord(value: unknown): value is LocalProjectRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.rootPath === "string" &&
    typeof value.rootPathHash === "string" &&
    typeof value.defaultSystemPromptPath === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (value.cloudProjectId === undefined || typeof value.cloudProjectId === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
