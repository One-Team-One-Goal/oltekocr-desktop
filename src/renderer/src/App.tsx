import { Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import { SessionsHome } from "@/components/sessions/SessionsHome";
import { SessionDetail } from "@/components/sessions/SessionDetail";

export default function App() {
  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<SessionsHome />} />
            <Route path="/sessions/:id" element={<SessionDetail />} />
            <Route path="*" element={<SessionsHome />} />
          </Routes>
        </main>
      </div>
    </TooltipProvider>
  );
}
