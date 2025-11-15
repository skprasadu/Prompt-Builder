import type { FileValue } from "./fs";

export interface PromptPayload {
  textarea: string;
  selectedFiles: FileValue[];
}