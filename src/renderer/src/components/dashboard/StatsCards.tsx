import type { DashboardStats } from "@shared/types";
import { formatConfidence } from "@/lib/utils";

interface StatsCardsProps {
  stats: DashboardStats;
}

const statConfig: Array<{
  key: string;
  label: string;
  dot: string;
  isPercent?: boolean;
}> = [
  { key: "total", label: "All Documents", dot: "bg-gray-400" },
  { key: "review", label: "Pending Review", dot: "bg-amber-400" },
  { key: "queued", label: "In Queue", dot: "bg-amber-500" },
  { key: "approved", label: "Approved", dot: "bg-green-500" },
  { key: "rejected", label: "Rejected", dot: "bg-red-500" },
  {
    key: "avgConfidence",
    label: "Avg Confidence",
    dot: "bg-blue-500",
    isPercent: true,
  },
];

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 divide-x divide-border border border-border rounded-xl bg-card shadow-sm overflow-hidden">
      {statConfig.map((item) => {
        const value = stats[item.key as keyof DashboardStats];
        const display = item.isPercent
          ? formatConfidence(value as number)
          : String(value);
        return (
          <div key={item.key} className="flex flex-col gap-1.5 px-6 py-4">
            <p className="text-3xl font-bold tracking-tight text-foreground">
              {display}
            </p>
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full shrink-0 ${item.dot}`}
              />
              <span className="text-xs text-muted-foreground">
                {item.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
