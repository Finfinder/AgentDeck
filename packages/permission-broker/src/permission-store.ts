import type { PermissionGrant, PermissionGrantScope, PermissionRequest } from './contracts';
import { isScopeMatch as matchesScope } from './risk-rules';

export type PermissionStore = {
  add(grant: PermissionGrant): void;
  findMatching(request: PermissionRequest, predicate: (grant: PermissionGrant) => boolean): PermissionGrant | undefined;
  snapshot(): readonly PermissionGrant[];
};

export type PermissionStoreOptions = {
  now?: () => number;
};

export function createPermissionStore(options: PermissionStoreOptions = {}): PermissionStore {
  const now = options.now ?? (() => Date.now());
  const grants = new Map<string, PermissionGrant>();

  function pruneExpired(): void {
    for (const [id, grant] of grants) {
      if (grant.expiresAt !== undefined && grant.expiresAt <= now()) {
        grants.delete(id);
      }
    }
  }

  return {
    add(grant) {
      grants.set(grant.id, Object.freeze({ ...grant }) as PermissionGrant);
    },
    findMatching(request, predicate) {
      pruneExpired();
      const matching = [...grants.values()]
        .filter(grant => grant.sessionId === request.sessionId && predicate(grant))
        .sort((left, right) => right.createdAt - left.createdAt);

      return matching.find(grant => isScopeMatch(request, grant.scope));
    },
    snapshot() {
      pruneExpired();
      return Object.freeze([...grants.values()]);
    }
  };
}

function isScopeMatch(request: PermissionRequest, scope: PermissionGrantScope): boolean {
  return matchesScope(request, scope);
}
