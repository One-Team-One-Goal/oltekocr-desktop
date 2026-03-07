import "reflect-metadata";
import { app, shell, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { bootstrapNestServer } from "./nest/bootstrap";
import { ensureDataDirs } from "./data-dirs";
import { IpcChannel } from "@shared/types";

let mainWindow: BrowserWindow | null = null;
let nestPort = 3847;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    autoHideMenuBar: true,
    title: "",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // In dev, load from Vite dev server; in prod, load built files
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ─── IPC Handlers ───────────────────────────────────────
function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.OPEN_FILE_DIALOG, async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Supported Documents",
          extensions: ["jpg", "jpeg", "png", "tiff", "tif", "bmp", "pdf"],
        },
      ],
      ...options,
    });
  });

  ipcMain.handle(IpcChannel.OPEN_FOLDER_DIALOG, async () => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    return dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
  });

  ipcMain.handle(IpcChannel.SAVE_FILE_DIALOG, async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePath: "" };
    return dialog.showSaveDialog(mainWindow, options);
  });

  ipcMain.handle(IpcChannel.GET_APP_PATH, () => {
    return app.getPath("userData");
  });

  ipcMain.handle(IpcChannel.SHOW_ITEM_IN_FOLDER, (_event, path: string) => {
    shell.showItemInFolder(path);
  });

  // Expose the NestJS port to the renderer
  ipcMain.handle("nest:get-port", () => nestPort);

  // Window controls
  ipcMain.handle(IpcChannel.WINDOW_CLOSE, () => mainWindow?.close());
  ipcMain.handle(IpcChannel.WINDOW_MINIMIZE, () => mainWindow?.minimize());
  ipcMain.handle(IpcChannel.WINDOW_MAXIMIZE, () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
}

// ─── App Lifecycle ──────────────────────────────────────
app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.oltek.oltekocr");

  // Dev: open devtools on F12, ignore Ctrl+R in prod
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Ensure data directories exist
  ensureDataDirs();

  // Register IPC handlers
  registerIpcHandlers();

  // Boot NestJS server
  try {
    nestPort = await bootstrapNestServer();
    console.log(
      `[OltekOCR] NestJS server running on http://localhost:${nestPort}`,
    );
  } catch (err) {
    console.error("[OltekOCR] Failed to start NestJS server:", err);
  }

  // Create the main window
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
