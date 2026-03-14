// Make OltekApi (defined in preload/index.d.ts) available to all renderer files.
// This re-exports the global augmentation so TS picks it up inside src/renderer/src.

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
  copyFile: (fromPath: string, toPath: string) => Promise<void>;
  getAppPath: () => Promise<string>;
  showItemInFolder: (path: string) => Promise<void>;
  getNestPort: () => Promise<number>;
  windowClose: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
}

declare global {
  interface Window {
    api: OltekApi;
  }
}

export {};

declare module "*.svg" {
  const src: string;
  export default src;
}
