import type { FileValue } from "../types/fs";
import type { PromptPayload } from "../types/prompt";

export function buildPayload(textarea: string, files: FileValue[]): PromptPayload {
  return { textarea, selectedFiles: files };
}

/** The *exact* string we’ll copy & count tokens for. */
export function serializePayload(payload: PromptPayload): string {
  return JSON.stringify(payload, null, 2);
}