// Shared path utilities used across workbench packages
// Keep implementation minimal and defensive to match existing behaviour
export function normalizePathStr(p: string): string {
  const s = (p ?? '').replaceAll('\\', '/');
  let end = s.length;
  while (end > 1 && s[end - 1] === '/') end--;
  return s.slice(0, end);
}

export function pathBasename(p: string): string {
  const normalized = normalizePathStr(p);
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}
