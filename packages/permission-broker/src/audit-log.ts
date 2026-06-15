import type { PermissionAuditEntry } from './contracts';

export type AuditLogStore = {
  append(entry: PermissionAuditEntry): void;
  snapshot(): readonly PermissionAuditEntry[];
};

export function createAuditLog(): AuditLogStore {
  const entries: PermissionAuditEntry[] = [];

  return {
    append(entry) {
      entries.push(Object.freeze({ ...entry }) as PermissionAuditEntry);
    },
    snapshot() {
      return Object.freeze([...entries]);
    }
  };
}
