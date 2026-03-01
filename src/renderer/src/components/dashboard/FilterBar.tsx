import { useState } from "react";
import { Search, FileOutput, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface FilterBarProps {
  onFilter: (status: string, search: string) => void;
  statusFilter: string;
  searchQuery: string;
  onExport?: () => void;
}

const STATUS_OPTIONS = [
  { value: "", label: "All status" },
  { value: "QUEUED", label: "Queued" },
  { value: "PROCESSING", label: "Processing" },
  { value: "REVIEW", label: "Pending Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "EXPORTED", label: "Exported" },
  { value: "ERROR", label: "Error" },
];

export function FilterBar({
  onFilter,
  statusFilter,
  searchQuery,
  onExport,
}: FilterBarProps) {
  const [search, setSearch] = useState(searchQuery);

  const handleStatusChange = (value: string) => {
    onFilter(value === "all" ? "" : value, search);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onFilter(statusFilter, search);
  };

  return (
    <div className="flex items-center gap-3">
      <Select value={statusFilter || "all"} onValueChange={handleStatusChange}>
        <SelectTrigger className="w-[140px] bg-white shadow-sm">
          <SelectValue placeholder="All status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All status</SelectItem>
          {STATUS_OPTIONS.filter((o) => o.value).map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <form onSubmit={handleSearchSubmit} className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search filename, notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-white shadow-sm"
        />
      </form>

      <Button
        variant="outline"
        className="bg-white shadow-sm gap-1.5 font-medium"
        onClick={onExport}
      >
        <FileOutput className="h-4 w-4" />
        Export
        <ChevronDown className="h-3.5 w-3.5 opacity-50" />
      </Button>
    </div>
  );
}
