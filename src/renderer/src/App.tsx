import { Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { SessionsHome } from "@/components/sessions/SessionsHome";
import { SessionDetail } from "@/components/sessions/SessionDetail";

export default function App() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="flex h-screen w-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex flex-col overflow-hidden">
            <Routes>
              <Route path="/" element={<SessionsHome mode="PDF_EXTRACT" />} />
              <Route
                path="/ocr-extract"
                element={<SessionsHome mode="OCR_EXTRACT" />}
              />
              <Route
                path="/keyword-extract"
                element={<SessionsHome mode="TABLE_EXTRACT" />}
              />
              <Route path="/sessions/:id" element={<SessionDetail />} />
              <Route path="*" element={<SessionsHome mode="PDF_EXTRACT" />} />
            </Routes>
          </main>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
