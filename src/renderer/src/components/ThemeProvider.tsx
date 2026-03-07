import { createContext, useContext, useEffect, useState } from "react";

// ─── Theme Definitions (VSCode-inspired) ──────────────────────────────────────
// Each theme maps to HSL CSS variables matching the shadcn design token system.

export interface ThemeDefinition {
  id: string;
  name: string;
  preview: string; // preview swatch color (hex)
  type: "dark" | "light";
  variables: Record<string, string>;
}

export const themes: ThemeDefinition[] = [
  {
    id: "dark-default",
    name: "Dark+ (Default)",
    preview: "#1e1e1e",
    type: "dark",
    variables: {
      "--background": "240 10% 3.9%",
      "--foreground": "0 0% 98%",
      "--card": "0 0% 9%",
      "--card-foreground": "0 0% 98%",
      "--popover": "240 5.9% 10%",
      "--popover-foreground": "0 0% 98%",
      "--primary": "0 0% 98%",
      "--primary-foreground": "240 5.9% 10%",
      "--secondary": "240 3.7% 15.9%",
      "--secondary-foreground": "0 0% 98%",
      "--muted": "240 3.7% 15.9%",
      "--muted-foreground": "240 5% 64.9%",
      "--accent": "240 3.7% 15.9%",
      "--accent-foreground": "0 0% 98%",
      "--destructive": "0 62.8% 30.6%",
      "--destructive-foreground": "0 0% 98%",
      "--border": "240 3.7% 20.9%",
      "--input": "240 3.7% 15.9%",
      "--ring": "240 4.9% 83.9%",
      "--sidebar": "0 0% 9%",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    preview: "#272822",
    type: "dark",
    variables: {
      "--background": "70 8% 15%",
      "--foreground": "60 30% 96%",
      "--card": "70 8% 12%",
      "--card-foreground": "60 30% 96%",
      "--popover": "70 8% 13%",
      "--popover-foreground": "60 30% 96%",
      "--primary": "80 76% 53%",
      "--primary-foreground": "70 8% 10%",
      "--secondary": "70 6% 20%",
      "--secondary-foreground": "60 30% 96%",
      "--muted": "70 6% 20%",
      "--muted-foreground": "60 10% 60%",
      "--accent": "338 95% 56%",
      "--accent-foreground": "60 30% 96%",
      "--destructive": "0 70% 50%",
      "--destructive-foreground": "60 30% 96%",
      "--border": "70 6% 24%",
      "--input": "70 6% 20%",
      "--ring": "80 76% 53%",
      "--sidebar": "70 8% 11%",
    },
  },
  {
    id: "github-dark",
    name: "GitHub Dark",
    preview: "#0d1117",
    type: "dark",
    variables: {
      "--background": "215 28% 7%",
      "--foreground": "210 17% 82%",
      "--card": "215 25% 10%",
      "--card-foreground": "210 17% 82%",
      "--popover": "215 25% 11%",
      "--popover-foreground": "210 17% 82%",
      "--primary": "212 92% 45%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "215 20% 16%",
      "--secondary-foreground": "210 17% 82%",
      "--muted": "215 20% 16%",
      "--muted-foreground": "215 15% 55%",
      "--accent": "215 20% 16%",
      "--accent-foreground": "210 17% 82%",
      "--destructive": "0 72% 51%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "215 18% 20%",
      "--input": "215 20% 16%",
      "--ring": "212 92% 45%",
      "--sidebar": "215 25% 9%",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    preview: "#002b36",
    type: "dark",
    variables: {
      "--background": "192 100% 11%",
      "--foreground": "44 87% 94%",
      "--card": "192 81% 14%",
      "--card-foreground": "44 87% 94%",
      "--popover": "192 81% 14%",
      "--popover-foreground": "44 87% 94%",
      "--primary": "175 59% 40%",
      "--primary-foreground": "192 100% 11%",
      "--secondary": "192 50% 18%",
      "--secondary-foreground": "44 87% 94%",
      "--muted": "192 50% 18%",
      "--muted-foreground": "186 13% 59%",
      "--accent": "175 59% 40%",
      "--accent-foreground": "44 87% 94%",
      "--destructive": "1 71% 52%",
      "--destructive-foreground": "44 87% 94%",
      "--border": "192 40% 22%",
      "--input": "192 50% 18%",
      "--ring": "175 59% 40%",
      "--sidebar": "192 100% 10%",
    },
  },
  {
    id: "one-dark-pro",
    name: "One Dark Pro",
    preview: "#282c34",
    type: "dark",
    variables: {
      "--background": "220 13% 18%",
      "--foreground": "220 14% 71%",
      "--card": "220 13% 16%",
      "--card-foreground": "220 14% 71%",
      "--popover": "220 13% 17%",
      "--popover-foreground": "220 14% 71%",
      "--primary": "207 82% 66%",
      "--primary-foreground": "220 13% 14%",
      "--secondary": "220 12% 22%",
      "--secondary-foreground": "220 14% 71%",
      "--muted": "220 12% 22%",
      "--muted-foreground": "220 10% 50%",
      "--accent": "286 60% 67%",
      "--accent-foreground": "220 14% 71%",
      "--destructive": "355 65% 65%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "220 12% 26%",
      "--input": "220 12% 22%",
      "--ring": "207 82% 66%",
      "--sidebar": "220 13% 15%",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    preview: "#282a36",
    type: "dark",
    variables: {
      "--background": "231 15% 18%",
      "--foreground": "60 30% 96%",
      "--card": "232 14% 15%",
      "--card-foreground": "60 30% 96%",
      "--popover": "232 14% 16%",
      "--popover-foreground": "60 30% 96%",
      "--primary": "265 89% 78%",
      "--primary-foreground": "231 15% 18%",
      "--secondary": "232 14% 23%",
      "--secondary-foreground": "60 30% 96%",
      "--muted": "232 14% 23%",
      "--muted-foreground": "228 8% 55%",
      "--accent": "135 94% 65%",
      "--accent-foreground": "231 15% 18%",
      "--destructive": "0 100% 67%",
      "--destructive-foreground": "60 30% 96%",
      "--border": "232 14% 27%",
      "--input": "232 14% 23%",
      "--ring": "265 89% 78%",
      "--sidebar": "231 15% 16%",
    },
  },
  {
    id: "nord",
    name: "Nord",
    preview: "#2e3440",
    type: "dark",
    variables: {
      "--background": "220 16% 22%",
      "--foreground": "218 27% 88%",
      "--card": "220 17% 20%",
      "--card-foreground": "218 27% 88%",
      "--popover": "220 17% 20%",
      "--popover-foreground": "218 27% 88%",
      "--primary": "193 43% 67%",
      "--primary-foreground": "220 16% 18%",
      "--secondary": "220 16% 28%",
      "--secondary-foreground": "218 27% 88%",
      "--muted": "220 16% 28%",
      "--muted-foreground": "219 16% 55%",
      "--accent": "179 25% 65%",
      "--accent-foreground": "218 27% 88%",
      "--destructive": "354 42% 56%",
      "--destructive-foreground": "218 27% 92%",
      "--border": "220 16% 32%",
      "--input": "220 16% 28%",
      "--ring": "193 43% 67%",
      "--sidebar": "220 16% 19%",
    },
  },
  {
    id: "light-default",
    name: "Light+ (Default)",
    preview: "#ffffff",
    type: "light",
    variables: {
      "--background": "0 0% 100%",
      "--foreground": "0 0% 15%",
      "--card": "0 0% 98%",
      "--card-foreground": "0 0% 15%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "0 0% 15%",
      "--primary": "210 100% 40%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "220 14% 96%",
      "--secondary-foreground": "0 0% 15%",
      "--muted": "220 14% 96%",
      "--muted-foreground": "220 9% 46%",
      "--accent": "220 14% 96%",
      "--accent-foreground": "0 0% 15%",
      "--destructive": "0 84% 60%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "220 13% 91%",
      "--input": "220 13% 91%",
      "--ring": "210 100% 40%",
      "--sidebar": "220 14% 96%",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    preview: "#fdf6e3",
    type: "light",
    variables: {
      "--background": "44 87% 94%",
      "--foreground": "192 81% 14%",
      "--card": "44 100% 91%",
      "--card-foreground": "192 81% 14%",
      "--popover": "44 87% 94%",
      "--popover-foreground": "192 81% 14%",
      "--primary": "175 59% 40%",
      "--primary-foreground": "44 87% 94%",
      "--secondary": "46 42% 88%",
      "--secondary-foreground": "192 81% 14%",
      "--muted": "46 42% 88%",
      "--muted-foreground": "186 13% 59%",
      "--accent": "46 42% 88%",
      "--accent-foreground": "192 81% 14%",
      "--destructive": "1 71% 52%",
      "--destructive-foreground": "44 87% 94%",
      "--border": "46 30% 82%",
      "--input": "46 30% 82%",
      "--ring": "175 59% 40%",
      "--sidebar": "44 100% 91%",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    preview: "#ffffff",
    type: "light",
    variables: {
      "--background": "0 0% 100%",
      "--foreground": "210 12% 16%",
      "--card": "210 20% 98%",
      "--card-foreground": "210 12% 16%",
      "--popover": "0 0% 100%",
      "--popover-foreground": "210 12% 16%",
      "--primary": "212 92% 45%",
      "--primary-foreground": "0 0% 100%",
      "--secondary": "210 17% 95%",
      "--secondary-foreground": "210 12% 16%",
      "--muted": "210 17% 95%",
      "--muted-foreground": "210 10% 50%",
      "--accent": "210 17% 95%",
      "--accent-foreground": "210 12% 16%",
      "--destructive": "0 72% 51%",
      "--destructive-foreground": "0 0% 100%",
      "--border": "210 16% 90%",
      "--input": "210 16% 90%",
      "--ring": "212 92% 45%",
      "--sidebar": "210 20% 97%",
    },
  },
];

// ─── Context ──────────────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeDefinition;
  setTheme: (id: string) => void;
}

const STORAGE_KEY = "oltekocr-theme";
const DEFAULT_THEME_ID = "dark-default";

const ThemeContext = createContext<ThemeContextValue>({
  theme: themes[0],
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.variables)) {
    root.style.setProperty(key, value);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeDefinition>(() => {
    const storedId = localStorage.getItem(STORAGE_KEY);
    return themes.find((t) => t.id === storedId) ?? themes[0];
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = (id: string) => {
    const found = themes.find((t) => t.id === id);
    if (!found) return;
    localStorage.setItem(STORAGE_KEY, id);
    setThemeState(found);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
