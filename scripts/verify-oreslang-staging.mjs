import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const candidateRoots = [
  'clients/oreslang',
  'clients/oreslang-js',
  'clients/oreslang-wasm',
  'clients/wasm-oreslang',
];

/**
 * Prevent declaration-only Oreslang documents from becoming an implicitly
 * admitted Opto Sync SDK or executable target. Replace this explicit deny
 * gate only in a reviewed PR adding real compiler, exact TypeSpec/Schema
 * TJSV receipts, runtime fixture admission, and cross-language consumer CI.
 */
export function verifyStagedOreslang({matrix, presentPaths}) {
  if (!matrix || typeof matrix !== 'object' || !matrix.targets
      || typeof matrix.targets !== 'object' || Array.isArray(matrix.targets)) {
    throw new Error('invalid client target matrix');
  }
  const pathSet = new Set(presentPaths);
  for (const [target, meta] of Object.entries(matrix.targets)) {
    const fields = [target, meta?.runtime, meta?.zed_target, meta?.dir]
      .filter(x => typeof x === 'string')
      .map(x => x.toLowerCase());
    if (fields.some(x => /(^|[-_/])oreslang([-_/]|$)/.test(x))) {
      throw new Error('Oreslang target is not runtime-admitted: ' + target);
    }
  }
  for (const path of candidateRoots) {
    if (pathSet.has(path)) {
      throw new Error('Oreslang SDK candidate directory lacks native admission: ' + path);
    }
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const matrix = JSON.parse(readFileSync(resolve(root,'clients/client-contract-matrix.json'),'utf8'));
  verifyStagedOreslang({
    matrix,
    presentPaths: candidateRoots.filter(path => existsSync(resolve(root,path))),
  });
  console.log('Oreslang remains explicitly staged: no unsupported SDK/JS/Wasm targets admitted');
}
