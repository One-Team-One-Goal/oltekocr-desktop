import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SchemaPresetDraft } from "./SchemaBuilderDialog";
import { ManualSchemaWizard } from "./ManualSchemaWizard";

interface ManualSchemaBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  submitting?: boolean;
  onSubmit: (preset: SchemaPresetDraft) => Promise<void> | void;
}

export function ManualSchemaBuilderDialog({
  open,
  onClose,
  submitting = false,
  onSubmit,
}: ManualSchemaBuilderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manual Schema Builder</DialogTitle>
          <DialogDescription>
            Upload a PDF, review extracted tables, configure columns, assign sheets, then save.
          </DialogDescription>
        </DialogHeader>
        <ManualSchemaWizard onSubmit={onSubmit} submitting={submitting} />
      </DialogContent>
    </Dialog>
  );
}