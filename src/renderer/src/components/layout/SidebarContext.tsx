import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Minus,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

interface SidebarContextType {
  collapsed: boolean;
  hidden: boolean;
  toggle: () => void;
  setHidden: (hidden: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  hidden: false,
  toggle: () => {},
  setHidden: () => {},
});

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        hidden,
        toggle: () => setCollapsed((v) => !v),
        setHidden,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarToggleButton() {
  const { collapsed, toggle } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </Button>
  );
}

export function WindowControls() {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="flex items-center gap-1.5 px-4 shrink-0 pr-6"
      style={noDrag}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TrafficLight
        color="#28c840"
        hoverColor="#27ae60"
        onClick={() => window.api.windowMinimize()}
        showIcon={hovered}
      >
        <Minus className="h-2 w-2" />
      </TrafficLight>
      <TrafficLight
        color="#ffbd2e"
        hoverColor="#e67e22"
        onClick={() => window.api.windowMaximize()}
        showIcon={hovered}
      >
        <Maximize2 className="h-2 w-2" />
      </TrafficLight>
      <TrafficLight
        color="#ff5f57"
        hoverColor="#c0392b"
        onClick={() => window.api.windowClose()}
        showIcon={hovered}
      >
        <X className="h-2 w-2" />
      </TrafficLight>
    </div>
  );
}

function TrafficLight({
  color,
  hoverColor,
  onClick,
  showIcon,
  children,
}: {
  color: string;
  hoverColor: string;
  onClick: () => void;
  showIcon: boolean;
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
        className={`text-black/70 transition-opacity ${showIcon ? "opacity-100" : "opacity-0"}`}
      >
        {children}
      </span>
    </button>
  );
}
