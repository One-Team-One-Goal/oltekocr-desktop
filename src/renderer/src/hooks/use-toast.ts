import { useEffect, useState } from "react";

export type ToastVariant = "default" | "destructive";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
}

type ToastState = {
  toasts: ToastItem[];
};

const TOAST_LIMIT = 5;
const TOAST_REMOVE_DELAY = 5000;

let memoryState: ToastState = { toasts: [] };
const listeners: Array<(state: ToastState) => void> = [];
const timeouts = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((listener) => listener(memoryState));
}

function scheduleRemove(id: string, duration?: number) {
  clearScheduledRemove(id);
  if (duration === 0) return;

  const timeout = setTimeout(() => {
    dismissToast(id);
  }, duration ?? TOAST_REMOVE_DELAY);
  timeouts.set(id, timeout);
}

function clearScheduledRemove(id: string) {
  const timeout = timeouts.get(id);
  if (timeout) {
    clearTimeout(timeout);
    timeouts.delete(id);
  }
}

function removeToast(id: string) {
  clearScheduledRemove(id);
  memoryState = {
    ...memoryState,
    toasts: memoryState.toasts.filter((toast) => toast.id !== id),
  };
  emit();
}

function dismissToast(id?: string) {
  if (id) {
    removeToast(id);
    return;
  }

  memoryState.toasts.forEach((toast) => removeToast(toast.id));
}

function updateToast(id: string, patch: Partial<Omit<ToastItem, "id">>) {
  memoryState = {
    ...memoryState,
    toasts: memoryState.toasts.map((toast) =>
      toast.id === id ? { ...toast, ...patch } : toast,
    ),
  };
  const updated = memoryState.toasts.find((toast) => toast.id === id);
  if (updated) {
    scheduleRemove(id, updated.duration);
  }
  emit();
}

function createToast(item: Omit<ToastItem, "id">) {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  const toast: ToastItem = { id, ...item };
  memoryState = {
    ...memoryState,
    toasts: [toast, ...memoryState.toasts].slice(0, TOAST_LIMIT),
  };
  emit();
  scheduleRemove(id, toast.duration);

  return {
    id,
    dismiss: () => dismissToast(id),
    update: (patch: Partial<Omit<ToastItem, "id">>) => updateToast(id, patch),
  };
}

export function useToast() {
  const [state, setState] = useState<ToastState>(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) listeners.splice(index, 1);
    };
  }, []);

  return {
    ...state,
    toast: createToast,
    dismiss: dismissToast,
  };
}

export const toast = createToast;
