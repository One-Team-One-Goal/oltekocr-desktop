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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { SWAGGER_URL } from "@/api/client";
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
