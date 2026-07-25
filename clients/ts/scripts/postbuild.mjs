/**
 * Mark dist/esm/ as ESM.
 *
 * The package itself is CommonJS (no "type" field), so Node would otherwise
 * parse dist/esm/*.js as CommonJS and choke on the `import` statements. A
 * nested package.json with "type": "module" scopes the format to that
 * directory — the standard dual-build layout.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const esmDir = join(root, 'dist', 'esm');

await mkdir(esmDir, { recursive: true });
await writeFile(
  join(esmDir, 'package.json'),
  JSON.stringify({ type: 'module', sideEffects: false }, null, 2) + '\n',
);

console.log('postbuild: wrote dist/esm/package.json (type: module)');
