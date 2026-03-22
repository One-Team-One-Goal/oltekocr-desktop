// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import unpluginSwc from "unplugin-swc";
var __electron_vite_injected_dirname = "C:\\Users\\Keiru\\Documents\\programs\\oltekocr-desktop";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
      unpluginSwc.vite({
        jsc: {
          parser: { syntax: "typescript", decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true }
        }
      })
    ],
    resolve: {
      alias: {
        "@shared": resolve("src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared")
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@shared": resolve("src/shared")
      }
    },
    plugins: [react()],
    css: {
      postcss: resolve(__electron_vite_injected_dirname, "postcss.config.js")
    }
  }
});
export {
  electron_vite_config_default as default
};
