const KEY = "oltekocr_unsaved_sessions";

function getUnsavedIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function markUnsaved(id: string): void {
  const ids = getUnsavedIds();
  ids.add(id);
  localStorage.setItem(KEY, JSON.stringify([...ids]));
}

export function markSaved(id: string): void {
  const ids = getUnsavedIds();
  ids.delete(id);
  localStorage.setItem(KEY, JSON.stringify([...ids]));
}

export function checkUnsaved(id: string): boolean {
  return getUnsavedIds().has(id);
}

/**
 * Returns the next available "Unnamed" or "Unnamed N" name,
 * deduplicating against the provided list of existing names.
 */
export function nextUnnamedName(existingNames: string[]): string {
  const nameSet = new Set(existingNames);
  if (!nameSet.has("Unnamed")) return "Unnamed";
  let n = 2;
  while (nameSet.has(`Unnamed ${n}`)) n++;
  return `Unnamed ${n}`;
}
