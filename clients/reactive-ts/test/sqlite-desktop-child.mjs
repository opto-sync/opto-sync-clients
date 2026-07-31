import { NodeSqliteDesktopCoordinator } from '../src/sqlite-desktop.ts';

const [mode, path, key, owner, holdText = '0', ttlText = '1000'] =
  process.argv.slice(2);
const holdMs = Number(holdText);
const leaseTtlMs = Number(ttlText);
const coordinator = new NodeSqliteDesktopCoordinator(path, { busyTimeoutMs: 10_000 });
try {
  if (mode === 'contend') {
    coordinator.signalWake(key);
    const result = coordinator.acquire({
      key,
      ownerId: owner,
      token: `${owner}-token`,
      leaseTtlMs: 2_000,
    });
    if (result.status === 'busy') {
      process.stdout.write(`busy:${result.wakeGeneration}\n`);
    } else {
      process.stdout.write(`acquired:${result.grant.fence}\n`);
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      coordinator.complete(result.grant, result.grant.wakeGeneration);
    }
  } else if (mode === 'acquire-and-die') {
    coordinator.signalWake(key);
    const result = coordinator.acquire({
      key,
      ownerId: owner,
      token: `${owner}-token`,
      leaseTtlMs,
    });
    if (result.status !== 'acquired') throw new Error('expected acquisition');
    process.stdout.write(`acquired:${result.grant.fence}\n`);
    await new Promise((resolve) => setTimeout(resolve, holdMs));
  } else {
    throw new Error(`unknown child mode: ${mode}`);
  }
} finally {
  coordinator.close();
}
