import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FileText,
  Table2,
  BookOpen,
  Palette,
  Check,
  Moon,
  Sun,
  Settings,
  ScanText,
  Grid2X2Plus,
  PanelLeftClose,
  PanelLeftOpen,
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
import { SWAGGER_URL } from "@/api/client";
import { useTheme, themes } from "@/components/ThemeProvider";
import { SettingsDialog } from "@/components/SettingsDialog";
import { useSidebar } from "@/components/layout/SidebarContext";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import logoDark from "@/assets/logo_dark.svg";
import logoLight from "@/assets/logo_light.svg";

const navItems = [
  { icon: Table2, label: "Tables", path: "/" },
  { icon: ScanText, label: "Images", path: "/ocr-extract" },
  {
    icon: Grid2X2Plus,
    label: "Keywords",
    path: "/keyword-extract",
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme: currentTheme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { collapsed, toggle } = useSidebar();

  const darkThemes = themes.filter((t) => t.type === "dark");
  const lightThemes = themes.filter((t) => t.type === "light");

  const logo = currentTheme.type === "dark" ? logoDark : logoLight;

  return (
    <div
      className={cn(
        "flex flex-col bg-[hsl(var(--sidebar))] border-r border-border/50 transition-all duration-200 no-select overflow-hidden",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* Top bar with logo + collapse button */}
      <div className="flex items-center h-14 px-3 border-b border-border/50 shrink-0">
        {collapsed ? (
          // When collapsed: logo visible by default, expand button shown on hover
          <div
            className="relative flex items-center justify-center w-8 h-8 cursor-pointer group mx-auto"
            onClick={toggle}
          >
            <img
              src={logo}
              alt="Logo"
              className="w-6 h-6 transition-opacity duration-150 group-hover:opacity-0"
            />
            <PanelLeftOpen className="h-4 w-4 absolute transition-opacity duration-150 opacity-0 group-hover:opacity-100 text-muted-foreground" />
          </div>
        ) : (
          // When expanded: logo + name on left, collapse button on right
          <>
            <img src={logo} alt="Logo" className="w-6 h-6 shrink-0 ml-1" />
            <span className="ml-1 font-extrabold text-lg tracking-tight text-foreground flex-1 truncate pt-0.5">
              TRDNT
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {!collapsed && (
          <p className="px-2 py-1 text-[11px] font-semibold text-muted-foreground/60">
            Extract
          </p>
        )}
        {navItems.map((item) => {
          const isActive =
            item.path === "/"
              ? location.pathname === "/" ||
                location.pathname.startsWith("/pdf-extract")
              : location.pathname.startsWith(item.path);
          if (collapsed) {
            return (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className={cn(
                      "w-full justify-center h-9",
                      isActive
                        ? "bg-secondary/80 text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                    )}
                    onClick={() => navigate(item.path)}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return (
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
        })}
      </nav>

      {/* Bottom items */}
      <div className="py-3 px-2 space-y-0.5">
        {/* Theme dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full h-9 text-sm",
                collapsed ? "justify-center" : "justify-start gap-2.5",
                "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              <Palette className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Theme</span>}
            </Button>
          </DropdownMenuTrigger>
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

        {/* API Docs */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-center h-9 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                onClick={() => window.open(SWAGGER_URL, "_blank")}
              >
                <BookOpen className="h-4 w-4 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">API Docs</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            className={cn(
              "w-full justify-start gap-2.5 h-9 text-sm",
              "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
            )}
            onClick={() => window.open(SWAGGER_URL, "_blank")}
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <span>API Docs</span>
          </Button>
        )}

        {/* Settings */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-center h-9 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="h-4 w-4 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        ) : (
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
            <span className="ml-auto text-[10px] text-muted-foreground/60 pt-0.5">
              v1.0.0
            </span>
          </Button>
        )}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
