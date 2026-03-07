import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Status → display label */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    QUEUED: "Queued",
    SCANNING: "Scanning",
    PROCESSING: "Processing",
    CANCELLING: "Cancelling",
    REVIEW: "Review",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    EXPORTED: "Exported",
    ERROR: "Error",
  };
  return map[status] || status;
}

/** Status → Tailwind color class */
export function statusColor(status: string): string {
  const map: Record<string, string> = {
    QUEUED: "text-gray-400",
    SCANNING: "text-blue-400",
    PROCESSING: "text-amber-400",
    CANCELLING: "text-orange-400",
    REVIEW: "text-[#a87527]",
    APPROVED: "text-green-400",
    REJECTED: "text-red-400",
    EXPORTED: "text-cyan-400",
    ERROR: "text-red-600",
  };
  return map[status] || "text-gray-400";
}

/** Status → badge variant */
export function statusBadgeColor(status: string): string {
  const map: Record<string, string> = {
    QUEUED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    SCANNING: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    PROCESSING: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    CANCELLING: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    REVIEW: "bg-[#a87527]/20 text-[#a87527] border-[#a87527]/30",
    APPROVED: "bg-green-500/20 text-green-400 border-green-500/30",
    REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
    EXPORTED: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
    ERROR: "bg-red-500/20 text-red-600 border-red-500/30",
  };
  return map[status] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

/** Format confidence percentage */
export function formatConfidence(value: number): string {
  if (value === 0) return "—";
  return `${value.toFixed(1)}%`;
}

/** Format processing time */
export function formatTime(seconds: number): string {
  if (seconds === 0) return "—";
  return `${seconds.toFixed(1)}s`;
}

/** Status → inline dot color class */
export function statusDotColor(status: string): string {
  const map: Record<string, string> = {
    QUEUED: "bg-gray-400",
    SCANNING: "bg-blue-500",
    PROCESSING: "bg-amber-500",
    CANCELLING: "bg-orange-400",
    REVIEW: "bg-[#a87527]",
    APPROVED: "bg-green-500",
    REJECTED: "bg-red-500",
    EXPORTED: "bg-cyan-500",
    ERROR: "bg-red-600",
  };
  return map[status] || "bg-gray-400";
}

/** Format date for display */
export function formatDate(isoString: string): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Format date as DD/MM/YY HH:mm (24-hour) */
export function formatShortDateTime(isoString: string): string {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const HH = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${HH}:${min}`;
}
