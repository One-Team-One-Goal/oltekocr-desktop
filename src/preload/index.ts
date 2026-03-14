import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { IpcChannel } from "@shared/types";

// Custom API exposed to the renderer
const api = {
  /** Open a native file picker dialog */
  openFileDialog: (options?: Record<string, unknown>) =>
    ipcRenderer.invoke(IpcChannel.OPEN_FILE_DIALOG, options),

  /** Open a native folder picker dialog */
  openFolderDialog: () => ipcRenderer.invoke(IpcChannel.OPEN_FOLDER_DIALOG),

  /** Open a native save dialog */
  saveFileDialog: (options: Record<string, unknown>) =>
    ipcRenderer.invoke(IpcChannel.SAVE_FILE_DIALOG, options),

  /** Copy a file on disk (used for Save As exports) */
  copyFile: (fromPath: string, toPath: string) =>
    ipcRenderer.invoke(IpcChannel.COPY_FILE, fromPath, toPath),

  /** Get the user data path */
  getAppPath: () => ipcRenderer.invoke(IpcChannel.GET_APP_PATH),

  /** Open a file/folder in the system file manager */
  showItemInFolder: (path: string) =>
    ipcRenderer.invoke(IpcChannel.SHOW_ITEM_IN_FOLDER, path),

  /** Get the NestJS server port */
  getNestPort: () => ipcRenderer.invoke("nest:get-port"),

  /** Window controls */
  windowClose: () => ipcRenderer.invoke(IpcChannel.WINDOW_CLOSE),
  windowMinimize: () => ipcRenderer.invoke(IpcChannel.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.invoke(IpcChannel.WINDOW_MAXIMIZE),
};

// Expose APIs via contextBridge
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (err) {
    console.error("Failed to expose API:", err);
  }
} else {
  (window as any).electron = electronAPI;
  (window as any).api = api;
}
