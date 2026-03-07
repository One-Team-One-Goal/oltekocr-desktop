import { ElectronAPI } from "@electron-toolkit/preload";

interface OltekApi {
  openFileDialog: (options?: Record<string, unknown>) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
  openFolderDialog: () => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
  saveFileDialog: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    filePath: string;
  }>;
  getAppPath: () => Promise<string>;
  showItemInFolder: (path: string) => Promise<void>;
  getNestPort: () => Promise<number>;
  windowClose: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: OltekApi;
  }
}
