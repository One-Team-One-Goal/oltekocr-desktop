import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FileText,
  FileScan,
  Table2,
  BookOpen,
  Palette,
  Check,
  Moon,
  Sun,
  X,
  Minus,
  Maximize2,
  EllipsisVertical,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SWAGGER_URL } from "@/api/client";
import { useTheme, themes } from "@/components/ThemeProvider";
import { SettingsDialog } from "@/components/SettingsDialog";
import ayahayLogo from "@/assets/ayahay_logo_blue.svg";

// CSS drag region helpers (Electron-specific)
const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

const navItems = [
  { icon: Table2, label: "Tables", path: "/" },
  { icon: FileScan, label: "Images", path: "/ocr-extract" },
  {
    icon: FileText,
    label: "Keywords",
    path: "/keyword-extract",
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme: currentTheme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const darkThemes = themes.filter((t) => t.type === "dark");
  const lightThemes = themes.filter((t) => t.type === "light");

  return (
    <div className="flex flex-col bg-[hsl(var(--sidebar))] border-r border-border/50 transition-all duration-200 no-select w-60">
      {/* Traffic lights */}
      <div
        className="flex items-center h-14 px-3 border-b border-border/50 pl-5"
        style={drag}
      >
        <div className="flex items-center gap-1.5" style={noDrag}>
          <TrafficLight
            color="#ff5f57"
            hoverColor="#c0392b"
            onClick={() => window.api.windowClose()}
          >
            <X className="h-2 w-2" />
          </TrafficLight>
          <TrafficLight
            color="#ffbd2e"
            hoverColor="#e67e22"
            onClick={() => window.api.windowMinimize()}
          >
            <Minus className="h-2 w-2" />
          </TrafficLight>
          <TrafficLight
            color="#28c840"
            hoverColor="#27ae60"
            onClick={() => window.api.windowMaximize()}
          >
            <Maximize2 className="h-2 w-2" />
          </TrafficLight>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground/60">
          Extract
        </p>
        {navItems.map((item) => {
          const isActive =
            item.path === "/"
              ? location.pathname === "/" ||
                location.pathname.startsWith("/pdf-extract")
              : location.pathname.startsWith(item.path);
          const btn = (
            <Button
              key={item.path}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2.5 h-9 text-sm",
                isActive
                  ? "bg-secondary/80 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
              onClick={() => navigate(item.path)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </Button>
          );
          return btn;
        })}
      </nav>

      {/* Bottom items */}
      <div className="py-3 px-2 space-y-0.5">
        {/* Theme dropdown */}
        {(() => {
          const themeBtn = (
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2.5 h-9 text-sm",
                "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              <Palette className="h-4 w-4 shrink-0" />
              <span>Theme</span>
            </Button>
          );

          const dropdown = (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{themeBtn}</DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="start"
                sideOffset={4}
                className="w-52"
              >
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Moon className="h-3 w-3" /> Dark
                </DropdownMenuLabel>
                {darkThemes.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    className="flex items-center gap-2.5 cursor-pointer"
                    onClick={() => setTheme(t.id)}
                  >
                    <div
                      className="h-4 w-4 rounded border border-border shrink-0"
                      style={{ backgroundColor: t.preview }}
                    />
                    <span className="flex-1 text-sm">{t.name}</span>
                    {currentTheme.id === t.id && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Sun className="h-3 w-3" /> Light
                </DropdownMenuLabel>
                {lightThemes.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    className="flex items-center gap-2.5 cursor-pointer"
                    onClick={() => setTheme(t.id)}
                  >
                    <div
                      className="h-4 w-4 rounded border border-border shrink-0"
                      style={{ backgroundColor: t.preview }}
                    />
                    <span className="flex-1 text-sm">{t.name}</span>
                    {currentTheme.id === t.id && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );

          return dropdown;
        })()}

        {/* Settings */}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-2.5 h-9 text-sm",
            "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
          )}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span>Settings</span>
        </Button>

        {/* OltekOCR branding */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md pt-4">
          <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 border border-border">
            <img src={ayahayLogo} alt="Logo" className="w-3.5 h-3.5" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-xs tracking-tight text-foreground">
              OltekOCR
            </span>
            <span className="text-[10px] text-muted-foreground">v1.0.0</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto h-6 w-6">
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={4}
              className="w-44"
            >
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => window.open(SWAGGER_URL, "_blank")}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>API Docs</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

// ─── Traffic Light Button ─────────────────────────────────────────────────────
function TrafficLight({
  color,
  hoverColor,
  onClick,
  children,
}: {
  color: string;
  hoverColor: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className="relative flex items-center justify-center w-3 h-3 rounded-full transition-colors focus:outline-none"
      style={{ backgroundColor: hovered ? hoverColor : color }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={cn(
          "text-black/70 transition-opacity",
          hovered ? "opacity-100" : "opacity-0",
        )}
      >
        {children}
      </span>
    </button>
  );
}
