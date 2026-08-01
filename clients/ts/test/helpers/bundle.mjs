/**
 * Bundle the browser entry point the way a real app would, and serve it.
 *
 * Shared by the bundle-shape test and the real-Chromium test so that both are
 * looking at the identical artifact — the one asserted to be free of Node
 * builtins is the one actually executed in the browser.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const testDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const CLIENT_ROOT = dirname(testDir);
export const OUT_DIR = join(testDir, '.tmp');

let cached = null;

/**
 * Bundle dist/esm/browser.js into a single IIFE exposing `window.OptoSync`.
 * Cached per process.
 *
 * @returns {Promise<{code: string, bytes: number, path: string}>}
 */
export async function bundleBrowserClient() {
  if (cached) return cached;

  await mkdir(OUT_DIR, { recursive: true });
  const outfile = join(OUT_DIR, 'opto-sync.browser.js');

  const result = await esbuild.build({
    entryPoints: [join(CLIENT_ROOT, 'dist', 'esm', 'browser.js')],
    bundle: true,
    outfile,
    format: 'iife',
    globalName: 'OptoSync',
    platform: 'browser',
    target: ['es2022'],
    // No `external`, no plugins, no polyfills, no loader config: if the client
    // needs any of that to reach a browser, this build fails and the test
    // reports it. That is the whole point.
    metafile: true,
    logLevel: 'silent',
  });

  if (result.errors.length) {
    throw new Error(`esbuild failed:\n${JSON.stringify(result.errors, null, 2)}`);
  }

  const code = await readFile(outfile, 'utf8');

  /* A second, minified build purely for a realistic size number: the
     unminified bundle is what the regex assertions read (minification can
     rename identifiers and mask a `require` reference), while what an app
     actually ships is minified and gzipped. */
  const minified = await esbuild.build({
    entryPoints: [join(CLIENT_ROOT, 'dist', 'esm', 'browser.js')],
    bundle: true,
    outfile: join(OUT_DIR, 'opto-sync.browser.min.js'),
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    logLevel: 'silent',
  });
  if (minified.errors.length) {
    throw new Error(`esbuild (minified) failed:\n${JSON.stringify(minified.errors, null, 2)}`);
  }
  const minCode = await readFile(join(OUT_DIR, 'opto-sync.browser.min.js'), 'utf8');
  const minGzipBytes = gzipSync(Buffer.from(minCode), { level: 9 }).length;

  cached = {
    code,
    bytes: Buffer.byteLength(code),
    minBytes: Buffer.byteLength(minCode),
    minGzipBytes,
    path: outfile,
    metafile: result.metafile,
  };
  return cached;
}

/**
 * Serve the bundle plus a host page over HTTP on an ephemeral localhost port.
 *
 * http:// rather than file:// because Chromium gives file:// pages an opaque
 * origin, and an opaque origin has no IndexedDB — the very thing under test.
 *
 * @param {string} html
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean} [route]
 *   Optional extra route handler, consulted first. Return true once it has
 *   answered the request. Lets a test mount a fixture sync backend on the SAME
 *   origin as the page, so the browser makes genuine same-origin requests.
 * @returns {Promise<{origin: string, close: () => Promise<void>}>}
 */
export async function serveBundle(html, route) {
  const { code } = await bundleBrowserClient();

  const server = createServer((req, res) => {
    if (route?.(req, res)) return;
    if (req.url === '/opto-sync.browser.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(code);
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404).end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
