export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: DialogFilter[];
}

export interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
}

function bridge(): RapidPromptDesktopApi {
  if (!window.rapidPrompt) {
    throw new Error("Electron desktop bridge is not available.");
  }

  return window.rapidPrompt;
}

export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return bridge().invoke<T>(command, args ?? {});
}

export function openDialog(options: OpenDialogOptions): Promise<string | string[] | null> {
  return bridge().openDialog(options);
}

export function saveDialog(options: SaveDialogOptions): Promise<string | null> {
  return bridge().saveDialog(options);
}

export function writeClipboardText(value: string): Promise<void> {
  return bridge().writeClipboardText(value);
}

export function readTextFile(path: string): Promise<string> {
  return bridge().readTextFile(path);
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return bridge().writeTextFile(path, contents);
}

export function getDesktopWindow(): { setTitle: (title: string) => Promise<void> } {
  return {
    setTitle: (title: string) => bridge().setWindowTitle(title),
  };
}
