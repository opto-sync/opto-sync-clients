import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  NodeSqliteDesktopCoordinator,
  SqliteCoordinatedDesktopSyncRunner,
  StaleDesktopFenceError,
} from '../src/sqlite-desktop.ts';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'opto-sync-sqlite-'));
  const path = join(directory, 'coordination.sqlite3');
  return {
    path,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const childFixture = fileURLToPath(
  new URL('./sqlite-desktop-child.mjs', import.meta.url),
);

async function spawnChild(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', childFixture, ...args],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  const [code] = (await once(child, 'exit')) as [number | null];
  return { code, stdout, stderr };
}

test('SQLite store time, not a process wall clock, decides lease overlap', async () => {
  const { path, cleanup } = fixture();
  const first = new NodeSqliteDesktopCoordinator(path);
  const second = new NodeSqliteDesktopCoordinator(path);
  try {
    first.signalWake('partition');
    const grant = await first.tryAcquire({
      key: 'partition',
      ownerId: 'slow-clock-process',
      token: 'token-a',
      nowMs: 0,
      expiresAtMs: 5_000,
    });
    assert.ok(grant);
    assert.ok(grant.acquiredAtMs > 1_000_000_000_000);
    assert.equal(grant.expiresAtMs - grant.acquiredAtMs, 5_000);

    const skewed = await second.tryAcquire({
      key: 'partition',
      ownerId: 'future-clock-process',
      token: 'token-b',
      nowMs: 9_000_000_000_000,
      expiresAtMs: 9_000_000_005_000,
    });
    assert.equal(skewed, null);
  } finally {
    first.close();
    second.close();
    cleanup();
  }
});

test('a wake committed after inspection is retained for a trailing fenced cycle', () => {
  const { path, cleanup } = fixture();
  const owner = new NodeSqliteDesktopCoordinator(path);
  const writer = new NodeSqliteDesktopCoordinator(path);
  try {
    const initial = owner.signalWake('partition');
    assert.equal(initial.generation, '1');
    const acquired = owner.acquire({
      key: 'partition',
      ownerId: 'owner-a',
      token: 'token-a',
      leaseTtlMs: 5_000,
    });
    assert.equal(acquired.status, 'acquired');
    if (acquired.status !== 'acquired') return;

    const later = writer.signalWake('partition');
    assert.equal(later.generation, '2');
    const firstCompletion = owner.complete(
      acquired.grant,
      acquired.grant.wakeGeneration,
    );
    assert.equal(firstCompletion.released, false);
    assert.equal(firstCompletion.currentWakeGeneration, '2');
    assert.equal(firstCompletion.handledGeneration, '1');

    const renewed = owner.renew(acquired.grant, 5_000);
    assert.ok(renewed);
    const secondCompletion = owner.complete(
      { ...renewed, wakeGeneration: '2', handledGeneration: '1' },
      '2',
    );
    assert.equal(secondCompletion.released, true);
    assert.deepEqual(owner.readState('partition'), {
      key: 'partition',
      fence: '1',
      expiresAtMs: 0,
      wakeGeneration: '2',
      handledGeneration: '2',
      dirty: false,
      owned: false,
      retryAfterMs: 0,
    });
  } finally {
    owner.close();
    writer.close();
    cleanup();
  }
});

test('stale owners cannot write or release after a newer fence is granted', async () => {
  const { path, cleanup } = fixture();
  const first = new NodeSqliteDesktopCoordinator(path);
  const second = new NodeSqliteDesktopCoordinator(path);
  try {
    first.signalWake('partition');
    const firstGrant = first.acquire({
      key: 'partition',
      ownerId: 'owner-a',
      token: 'token-a',
      leaseTtlMs: 1_000,
    });
    assert.equal(firstGrant.status, 'acquired');
    if (firstGrant.status !== 'acquired') return;
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    const secondGrant = second.acquire({
      key: 'partition',
      ownerId: 'owner-b',
      token: 'token-b',
      leaseTtlMs: 5_000,
    });
    assert.equal(secondGrant.status, 'acquired');
    if (secondGrant.status !== 'acquired') return;
    assert.equal(secondGrant.grant.fence, '2');

    assert.throws(
      () => first.withFencedWrite(firstGrant.grant, () => undefined),
      StaleDesktopFenceError,
    );
    await first.release(firstGrant.grant);
    second.assertCurrentFence(secondGrant.grant);
  } finally {
    first.close();
    second.close();
    cleanup();
  }
});

test('real OS processes contend for one SQLite partition and only one acquires', async () => {
  const { path, cleanup } = fixture();
  const holder = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      childFixture,
      'acquire-and-die',
      path,
      'partition',
      'holder',
      '10000',
      '5000',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let holderStderr = '';
  let holderExited = false;
  holder.once('exit', () => {
    holderExited = true;
  });
  holder.stderr.setEncoding('utf8');
  holder.stderr.on('data', (chunk) => (holderStderr += chunk));
  holder.stdout.setEncoding('utf8');
  try {
    const [holderOutput] = (await once(holder.stdout, 'data')) as [string];
    assert.match(holderOutput, /^acquired:1/);

    const contenders = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        spawnChild(['contend', path, 'partition', `process-${index}`, '0']),
      ),
    );
    for (const child of contenders) {
      assert.equal(child.code, 0, child.stderr);
      assert.match(child.stdout, /^busy:/);
    }

    holder.kill();
    await once(holder, 'exit');
    assert.equal(holderStderr.includes('Error:'), false, holderStderr);

    const coordinator = new NodeSqliteDesktopCoordinator(path);
    try {
      const state = coordinator.readState('partition');
      assert.equal(state.fence, '1');
      assert.equal(state.wakeGeneration, '4');
      assert.equal(state.handledGeneration, '0');
      assert.equal(state.dirty, true);
    } finally {
      coordinator.close();
    }
  } finally {
    if (!holderExited) {
      holder.kill();
      await once(holder, 'exit');
    }
    cleanup();
  }
});

test('process death after remote commit leaves dirty generation for replay after expiry', async () => {
  const { path, cleanup } = fixture();
  try {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        childFixture,
        'acquire-and-die',
        path,
        'partition',
        'doomed-process',
        '10000',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.setEncoding('utf8');
    const [chunk] = (await once(child.stdout, 'data')) as [string];
    assert.match(chunk, /^acquired:1/);
    child.kill();
    await once(child, 'exit');
    await new Promise((resolve) => setTimeout(resolve, 1_050));

    const recovery = new NodeSqliteDesktopCoordinator(path);
    try {
      const state = recovery.readState('partition');
      assert.equal(state.wakeGeneration, '1');
      assert.equal(state.handledGeneration, '0');
      assert.equal(state.dirty, true);
      const acquired = recovery.acquire({
        key: 'partition',
        ownerId: 'recovery-process',
        token: 'recovery-token',
        leaseTtlMs: 5_000,
      });
      assert.equal(acquired.status, 'acquired');
      if (acquired.status !== 'acquired') return;
      assert.equal(acquired.grant.fence, '2');
      assert.equal(acquired.grant.wakeGeneration, '1');
      const completed = recovery.complete(acquired.grant, '1');
      assert.equal(completed.released, true);
    } finally {
      recovery.close();
    }
  } finally {
    cleanup();
  }
});

test('runner persists busy wakes and rechecks generations before release', async () => {
  const { path, cleanup } = fixture();
  const coordinatorA = new NodeSqliteDesktopCoordinator(path);
  const coordinatorB = new NodeSqliteDesktopCoordinator(path);
  try {
    const seen: string[] = [];
    const runner = new SqliteCoordinatedDesktopSyncRunner({
      coordinator: coordinatorA,
      leaseKey: 'partition',
      ownerId: 'runner-a',
      timeoutMs: 1_000,
      leaseTtlMs: 2_500,
      busyRetryCapMs: 25,
      syncOnce: async (context) => {
        seen.push(context.wakeGeneration);
        if (seen.length === 1) coordinatorB.signalWake('partition');
        return context.wakeGeneration;
      },
    });
    const result = await runner.wake('local-mutation');
    assert.deepEqual(seen, ['1', '2']);
    assert.equal(result.outcomes.length, 2);
    assert.equal(result.outcomes.every((outcome) => outcome.status === 'completed'), true);
    assert.equal(coordinatorA.readState('partition').dirty, false);
    runner.close();
  } finally {
    coordinatorA.close();
    coordinatorB.close();
    cleanup();
  }
});
