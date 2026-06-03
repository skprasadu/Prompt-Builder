import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  globalSystemPromptPath,
  projectSystemPromptPath,
} from "./projectStore";

export async function loadSystemPrompt(projectId?: string): Promise<string> {
  const filePath = projectId ? projectSystemPromptPath(projectId) : globalSystemPromptPath();

  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function saveSystemPrompt(value: string, projectId?: string): Promise<void> {
  const filePath = projectId ? projectSystemPromptPath(projectId) : globalSystemPromptPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}
