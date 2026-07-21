import { contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("rapidPrompt", {
  invoke: <T>(command: string, args?: Record<string, unknown>): Promise<T> =>
    ipcRenderer.invoke("rapid-prompt:invoke", command, args ?? {}) as Promise<T>,

  openDialog: (options: unknown): Promise<string | string[] | null> =>
    ipcRenderer.invoke("rapid-prompt:dialog-open", options) as Promise<string | string[] | null>,

  saveDialog: (options: unknown): Promise<string | null> =>
    ipcRenderer.invoke("rapid-prompt:dialog-save", options) as Promise<string | null>,

  writeClipboardText: (value: string): Promise<void> =>
    ipcRenderer.invoke("rapid-prompt:clipboard-write-text", value) as Promise<void>,

  getDroppedFilePaths: (files: File[]): string[] =>
    files.map((file) => webUtils.getPathForFile(file)).filter((filePath) => filePath.length > 0),

  readTextFile: (path: string): Promise<string> =>
    ipcRenderer.invoke("rapid-prompt:read-text-file", path) as Promise<string>,

  writeTextFile: (path: string, contents: string): Promise<void> =>
    ipcRenderer.invoke("rapid-prompt:write-text-file", path, contents) as Promise<void>,

  setWindowTitle: (title: string): Promise<void> =>
    ipcRenderer.invoke("rapid-prompt:set-window-title", title) as Promise<void>,
});
