import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';

const rawBudgetBytes = 65_000;
const gzipBudgetBytes = 20_000;
const sampleCount = 20;

const result = await build({
  stdin: {
    contents: [
      "export { createBroadcastHintBus, createSyncWakePipeline } from './src/hints.ts';",
      "export { createSupabaseHints$, createWebSocketHints$ } from './src/live-hints.ts';",
    ].join('\n'),
    loader: 'ts',
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    sourcefile: 'reactive-web-pilot.ts',
  },
  bundle: true,
  format: 'esm',
  legalComments: 'none',
  minify: true,
  platform: 'browser',
  target: ['es2022'],
  treeShaking: true,
  write: false,
});

if (result.outputFiles.length !== 1) {
  throw new Error('reactive web pilot must produce exactly one bundle');
}

const bundle = result.outputFiles[0].contents;
const rawBytes = bundle.byteLength;
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;
const dataUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`;
const startupSamplesMs = [];

for (let index = 0; index < sampleCount; index += 1) {
  const startedAt = performance.now();
  await import(`${dataUrl}#pilot-sample-${index}`);
  startupSamplesMs.push(performance.now() - startedAt);
}

startupSamplesMs.sort((left, right) => left - right);
const percentile = (fraction) =>
  startupSamplesMs[
    Math.min(
      startupSamplesMs.length - 1,
      Math.ceil(startupSamplesMs.length * fraction) - 1,
    )
  ];

const report = {
  schema: 'opto-sync-reactive-pilot/v1',
  entrypoints: ['src/hints.ts', 'src/live-hints.ts'],
  minified: true,
  rawBytes,
  gzipBytes,
  rawBudgetBytes,
  gzipBudgetBytes,
  startup: {
    environment: `node-${process.versions.node}-${process.platform}-${process.arch}`,
    samples: sampleCount,
    medianMs: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
  },
};

console.log(JSON.stringify(report, null, 2));

if (rawBytes > rawBudgetBytes || gzipBytes > gzipBudgetBytes) {
  throw new Error(
    `reactive web pilot bundle exceeds budget: raw=${rawBytes}/${rawBudgetBytes}, gzip=${gzipBytes}/${gzipBudgetBytes}`,
  );
}
