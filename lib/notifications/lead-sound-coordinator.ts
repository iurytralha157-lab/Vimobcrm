const DATABASE = 'vimob-new-lead-sound-v1';
const CLAIMS = 'claims';
const CLOCKS = 'clocks';
const EXPIRY_INDEX = 'expiresAt';
const CLAIM_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 2000;
const TIMEOUT_MS = 2000;
const CLEANUP_BATCH = 16;

type SoundClaimInput = { scope: string; notificationId: string; now: number };
type SeenClaim = { scope: string; notificationId: string; expiresAt: number };
type ScopeClock = { scope: string; lastPlayedAt: number; expiresAt: number };

function eligible(check: () => boolean): boolean {
  try { return check() === true; } catch { return false; }
}

function validInput(input: SoundClaimInput): boolean {
  return typeof input.scope === 'string' && input.scope.length > 0 && input.scope.length <= 512
    && typeof input.notificationId === 'string' && input.notificationId.length > 0 && input.notificationId.length <= 512
    && Number.isSafeInteger(input.now) && input.now >= 0 && input.now <= Number.MAX_SAFE_INTEGER - CLAIM_TTL_MS;
}

function cleanExpired(store: IDBObjectStore, now: number, fail: () => void) {
  let removed = 0;
  const request = store.index(EXPIRY_INDEX).openCursor(IDBKeyRange.upperBound(now));
  request.onsuccess = () => {
    try {
      const cursor = request.result;
      if (!cursor || removed >= CLEANUP_BATCH) return;
      cursor.delete();
      removed += 1;
      if (removed < CLEANUP_BATCH) cursor.continue();
    } catch { fail(); }
  };
}

/**
 * Browser-only at-most-once sound reservation, shared by tabs of this origin.
 * Callers supply an opaque user/organization scope and recheck freshness,
 * generation, mute and audio availability in isEligible. No notification data,
 * tokens or audio are stored here. Seen IDs expire after ten minutes; callers
 * must independently reject notifications older than their freshness window.
 * Storage denial/failure deliberately suppresses sound; there is no racy fallback.
 */
export async function claimNewLeadSound(input: SoundClaimInput, isEligible: () => boolean): Promise<boolean> {
  if (!validInput(input) || !eligible(isEligible)) return false;
  const { scope, notificationId, now } = input;
  return new Promise<boolean>(resolve => {
    let settled = false;
    let database: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    let winner = false;
    const finish = (claimed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database?.close();
      resolve(claimed && eligible(isEligible));
    };
    const fail = () => {
      try { transaction?.abort(); } catch { /* Already committed or aborted. */ }
      finish(false);
    };
    const timeout = setTimeout(fail, TIMEOUT_MS);
    let request: IDBOpenDBRequest;
    try {
      if (!globalThis.indexedDB) { finish(false); return; }
      request = globalThis.indexedDB.open(DATABASE, 1);
    } catch { finish(false); return; }
    request.onerror = fail;
    request.onblocked = fail;
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      try {
        const claims = request.result.createObjectStore(CLAIMS, { keyPath: ['scope', 'notificationId'] });
        claims.createIndex(EXPIRY_INDEX, EXPIRY_INDEX);
        const clocks = request.result.createObjectStore(CLOCKS, { keyPath: 'scope' });
        clocks.createIndex(EXPIRY_INDEX, EXPIRY_INDEX);
      } catch { request.transaction?.abort(); fail(); }
    };
    request.onsuccess = () => {
      database = request.result;
      if (settled) { database.close(); return; }
      database.onversionchange = fail;
      if (!eligible(isEligible)) { finish(false); return; }
      try {
        // Both stores participate in one native readwrite transaction. IndexedDB
        // serializes overlapping transactions across connections and tabs.
        transaction = database.transaction([CLAIMS, CLOCKS], 'readwrite');
        transaction.onabort = fail;
        transaction.onerror = fail;
        transaction.oncomplete = () => finish(winner);
        const claims = transaction.objectStore(CLAIMS);
        const clocks = transaction.objectStore(CLOCKS);
        const seenRequest = claims.get([scope, notificationId]);
        const clockRequest = clocks.get(scope);
        let reads = 0;
        const decide = () => {
          reads += 1;
          if (reads < 2 || settled) return;
          if (!eligible(isEligible)) { fail(); return; }
          try {
            const seen = seenRequest.result as SeenClaim | undefined;
            const clock = clockRequest.result as ScopeClock | undefined;
            if (!seen || seen.expiresAt <= now) {
              // A cooldown-suppressed ID is still seen, so replay cannot turn
              // a later delivery of that same notification into a new sound.
              claims.put({ scope, notificationId, expiresAt: now + CLAIM_TTL_MS });
              const coolingDown = clock && clock.expiresAt > now
                && now - clock.lastPlayedAt < COOLDOWN_MS;
              if (!coolingDown) {
                clocks.put({ scope, lastPlayedAt: now, expiresAt: now + CLAIM_TTL_MS });
                winner = true;
              }
            }
            cleanExpired(claims, now, fail);
            cleanExpired(clocks, now, fail);
            if (!eligible(isEligible)) fail();
          } catch { fail(); }
        };
        seenRequest.onsuccess = decide;
        clockRequest.onsuccess = decide;
      } catch { fail(); }
    };
  });
}
