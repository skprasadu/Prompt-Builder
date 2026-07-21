import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { registerCommandHandlers } from "../backend/commands";
import { registerDesktopIpcHandlers } from "../backend/desktopIpc";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: "Rapid Prompt - Workbench",
    webPreferences: {
      preload: path.join(currentDir, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(path.join(currentDir, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  registerCommandHandlers();
  registerDesktopIpcHandlers();

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
