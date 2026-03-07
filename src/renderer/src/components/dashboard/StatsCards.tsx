import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardStats } from "@shared/types";
import { formatConfidence } from "@/lib/utils";
import {
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  BarChart3,
  Inbox,
} from "lucide-react";

interface StatsCardsProps {
  stats: DashboardStats;
}

const statConfig: Array<{
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  isPercent?: boolean;
}> = [
  {
    key: "total",
    label: "Total Documents",
    icon: FileText,
    color: "text-zinc-400",
    bg: "bg-zinc-400/10",
  },
  {
    key: "queued",
    label: "In Queue",
    icon: Inbox,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
  },
  {
    key: "review",
    label: "Pending Review",
    icon: Clock,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
  },
  {
    key: "approved",
    label: "Approved",
    icon: CheckCircle2,
    color: "text-green-400",
    bg: "bg-green-400/10",
  },
  {
    key: "rejected",
    label: "Rejected",
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-400/10",
  },
  {
    key: "avgConfidence",
    label: "Avg Confidence",
    icon: BarChart3,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    isPercent: true,
  },
];

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {statConfig.map((item) => {
        const value = stats[item.key as keyof DashboardStats];
        const display = item.isPercent
          ? formatConfidence(value as number)
          : String(value ?? 0);
        const Icon = item.icon;
        return (
          <Card key={item.key} className="border-border/50 bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-muted-foreground font-medium truncate">
                  {item.label}
                </p>
                <div className={`rounded-md p-1.5 shrink-0 ${item.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${item.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold tracking-tight">{display}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
