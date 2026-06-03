import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SYSTEM_PROMPT_FILENAME = "rapid-prompt-system-prompt.txt";

export async function loadSystemPrompt(): Promise<string> {
  try {
    return await readFile(systemPromptPath(), "utf8");
  } catch {
    return "";
  }
}

export async function saveSystemPrompt(value: string): Promise<void> {
  const dir = app.getPath("userData");
  await mkdir(dir, { recursive: true });
  await writeFile(systemPromptPath(), value, "utf8");
}

function systemPromptPath(): string {
  return path.join(app.getPath("userData"), SYSTEM_PROMPT_FILENAME);
}
