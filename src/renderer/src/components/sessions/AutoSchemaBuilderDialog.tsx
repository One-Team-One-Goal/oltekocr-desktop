import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AutomaticSchemaBuilderPanel } from "./AutomaticSchemaBuilderPanel";
import type { SchemaPresetPayload } from "@/api/client";
import type { SchemaPresetDraft, SchemaPresetTab } from "./SchemaBuilderDialog";

interface AutoSchemaBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  submitting?: boolean;
  onSubmit: (preset: SchemaPresetDraft) => Promise<void> | void;
}

export function AutoSchemaBuilderDialog({
  open,
  onClose,
  submitting = false,
  onSubmit,
}: AutoSchemaBuilderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[1100px] h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Auto Schema Builder</DialogTitle>
          <DialogDescription>
            Automatically extract schema structure from a sample PDF document.
          </DialogDescription>
        </DialogHeader>

        <AutomaticSchemaBuilderPanel
          onClose={onClose}
          onComplete={async (preset: SchemaPresetPayload) => {
            await onSubmit({
              // Auto-built schemas should always create a new preset entry.
              id: undefined,
              name: preset.name,
              extractionMode: preset.extractionMode,
              recordStartRegex: preset.recordStartRegex,
              tabs: preset.tabs as SchemaPresetTab[],
            });
          }}
          submitting={submitting}
        />
      </DialogContent>
    </Dialog>
  );
}
