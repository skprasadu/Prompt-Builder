import { BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";

interface DialogFilter {
  name: string;
  extensions: string[];
}

interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: DialogFilter[];
}

interface SaveDialogOptions {
  defaultPath?: string;
  filters?: DialogFilter[];
}

export function registerDesktopIpcHandlers(): void {
  ipcMain.handle("rapid-prompt:dialog-open", async (_event, options: OpenDialogOptions) => {
    const properties: ("openFile" | "openDirectory" | "multiSelections")[] = [
      options?.directory ? "openDirectory" : "openFile",
    ];

    if (options?.multiple) {
      properties.push("multiSelections");
    }

    const result = await dialog.showOpenDialog({
      properties,
      ...(options?.filters ? { filters: options.filters } : {}),
    });

    if (result.canceled) {
      return null;
    }

    return options?.multiple ? result.filePaths : result.filePaths[0] ?? null;
  });

  ipcMain.handle("rapid-prompt:dialog-save", async (_event, options: SaveDialogOptions) => {
    const result = await dialog.showSaveDialog({
      ...(options?.defaultPath ? { defaultPath: options.defaultPath } : {}),
      ...(options?.filters ? { filters: options.filters } : {}),
    });

    if (result.canceled) {
      return null;
    }

    return result.filePath ?? null;
  });

  ipcMain.handle("rapid-prompt:clipboard-write-text", (_event, value: string) => {
    clipboard.writeText(value);
  });

  ipcMain.handle("rapid-prompt:read-text-file", async (_event, filePath: string) => {
    return readFile(filePath, "utf8");
  });

  ipcMain.handle("rapid-prompt:write-text-file", async (_event, filePath: string, contents: string) => {
    await writeFile(filePath, contents, "utf8");
  });

  ipcMain.handle("rapid-prompt:set-window-title", (event, title: string) => {
    BrowserWindow.fromWebContents(event.sender)?.setTitle(title);
  });
}
