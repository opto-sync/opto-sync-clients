import {
  OPTO_SYNC_BACKGROUND_TAG,
  installOptoSyncServiceWorker,
} from '../../src/service-worker.ts';

const scope = self as unknown as {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  clients: { matchAll(): Promise<Array<{ postMessage(value: unknown): void }>> };
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('opto-sync-service-worker-e2e', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function incrementCycle(): Promise<number> {
  // Keep the cycle open briefly so concurrent messages prove single-flight.
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
  tag: OPTO_SYNC_BACKGROUND_TAG,
  timeoutMs: 5_000,
  async syncOnce() {
    const cycles = await incrementCycle();
    for (const client of await scope.clients.matchAll()) {
      client.postMessage({ type: 'opto-sync:e2e-cycle', cycles });
    }
    return { cycles };
  },
});
