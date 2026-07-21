interface RapidPromptDialogFilter {
  name: string;
  extensions: string[];
}

interface RapidPromptOpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: RapidPromptDialogFilter[];
}

interface RapidPromptSaveDialogOptions {
  defaultPath?: string;
  filters?: RapidPromptDialogFilter[];
}

interface RapidPromptDesktopApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  openDialog(options: RapidPromptOpenDialogOptions): Promise<string | string[] | null>;
  saveDialog(options: RapidPromptSaveDialogOptions): Promise<string | null>;
  writeClipboardText(value: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  setWindowTitle(title: string): Promise<void>;
}

interface Window {
  rapidPrompt?: RapidPromptDesktopApi;
}
