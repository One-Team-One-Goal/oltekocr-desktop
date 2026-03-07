import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  ScanLine,
  FileOutput,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Palette,
  Check,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import ayahayLogo from "@/assets/ayahay_logo_blue.svg";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: ScanLine, label: "Scanner", path: "/scanner" },
  { icon: FileOutput, label: "Export", path: "/export" },
];

const bottomItems = [
  {
    icon: BookOpen,
    label: "API Docs",
    action: () => window.open(SWAGGER_URL, "_blank"),
  },
  { icon: Settings, label: "Settings", path: "/settings" },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme: currentTheme, setTheme } = useTheme();

  const darkThemes = themes.filter((t) => t.type === "dark");
  const lightThemes = themes.filter((t) => t.type === "light");

  return (
    <div
      className={cn(
        "flex flex-col bg-[hsl(var(--sidebar))] border-r border-border/50 transition-all duration-200 no-select",
        collapsed ? "w-16" : "w-56",
      )}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center h-14 px-3 border-b border-border/50">
        {collapsed ? (
          <Button
            variant="ghost"
            size="icon"
            className="w-full text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(false)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-border">
                <img src={ayahayLogo} alt="Logo" className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-sm tracking-tight">
                  OltekOCR
                </span>
                <span className="text-[10px] text-muted-foreground">
                  v1.0.0
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground hover:text-foreground h-7 w-7"
              onClick={() => setCollapsed(true)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 px-2 space-y-0.5">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const btn = (
            <Button
              key={item.path}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2.5 h-9 text-sm",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-secondary/80 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
              onClick={() => navigate(item.path)}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return btn;
        })}
      </nav>

      <Separator className="opacity-30" />

      {/* Bottom items */}
      <div className="py-3 px-2 space-y-0.5">
        {/* Theme dropdown */}
        {(() => {
          const themeBtn = (
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2.5 h-8 text-sm",
                collapsed && "justify-center px-0",
                "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              <Palette className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Theme</span>}
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

          return collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{dropdown}</TooltipTrigger>
              <TooltipContent side="right">Theme</TooltipContent>
            </Tooltip>
          ) : (
            dropdown
          );
        })()}

        {bottomItems.map((item) => {
          const isActive = "path" in item && location.pathname === item.path;
          const btn = (
            <Button
              key={item.label}
              variant={isActive ? "secondary" : "ghost"}
              className={cn(
                "w-full justify-start gap-2.5 h-9 text-sm",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-secondary/80 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
              onClick={() =>
                "action" in item && item.action
                  ? item.action()
                  : "path" in item && navigate(item.path!)
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Button>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>{btn}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          }
          return btn;
        })}
      </div>
    </div>
  );
}
