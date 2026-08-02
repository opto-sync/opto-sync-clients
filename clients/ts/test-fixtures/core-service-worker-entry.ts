import {
  installOptoSyncServiceWorker,
  type ServiceWorkerScopeLike,
} from '../src/service-worker.ts';
import type { ProtocolSyncCycleResult } from '../src/sync-loop.ts';

// This entry is bundled for Chromium; keeping it outside `test/` prevents
// Node's recursive test discovery from evaluating the `self` global.
const databaseName = 'opto-sync-core-service-worker-e2e';
const workerInstance = crypto.randomUUID();
const scope = self as unknown as ServiceWorkerScopeLike & {
  clients: { matchAll(): Promise<Array<{ postMessage(value: unknown): void }>> };
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function incrementCycle(): Promise<number> {
  // Make concurrent tab messages overlap so the SDK's single-flight promise
  // is exercised by the real service-worker event loop.
  await new Promise((resolve) => setTimeout(resolve, 75));
  const database = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = database.transaction('meta', 'readwrite');
      const store = transaction.objectStore('meta');
      const get = store.get('cycles');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const cycles = Number(get.result?.value ?? 0) + 1;
        store.put({ key: 'cycles', value: cycles });
        transaction.oncomplete = () => resolve(cycles);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      };
    });
  } finally {
    database.close();
  }
}

installOptoSyncServiceWorker({
  scope,
  createSession: () => ({
    loop: {
      async syncNow() {
        const cycles = await incrementCycle();
        for (const client of await scope.clients.matchAll()) {
          client.postMessage({ type: 'opto-sync:core-e2e-cycle', cycles });
        }
        return {
          pushedMutations: cycles,
          acknowledgedMutations: cycles,
          pulledChanges: 0,
          installedSnapshots: 0,
          checkpoint: String(cycles),
          hasMorePending: false,
          workerInstance,
        } as ProtocolSyncCycleResult & { workerInstance: string };
      },
    },
  }),
});
