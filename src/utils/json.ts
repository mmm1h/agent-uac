import { ServerDiff } from "../types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      result[key] = sortValue(record[key]);
    }
    return result;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function diffServerMaps(
  current: Record<string, unknown>,
  desired: Record<string, unknown>
): ServerDiff {
  const currentIds = new Set(Object.keys(current));
  const desiredIds = new Set(Object.keys(desired));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  let unchanged = 0;

  for (const id of desiredIds) {
    if (!currentIds.has(id)) {
      added.push(id);
      continue;
    }
    if (stableStringify(current[id]) !== stableStringify(desired[id])) {
      changed.push(id);
    } else {
      unchanged += 1;
    }
  }

  for (const id of currentIds) {
    if (!desiredIds.has(id)) {
      removed.push(id);
    }
  }

  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed, unchanged };
}

export function hasDiff(diff: ServerDiff): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
