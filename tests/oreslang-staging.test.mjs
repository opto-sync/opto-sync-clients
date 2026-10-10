import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyStagedOreslang, listSdkPaths} from '../scripts/verify-oreslang-staging.mjs';

const matrix = JSON.parse(readFileSync(new URL('../clients/client-contract-matrix.json', import.meta.url), 'utf8'));

test('current Opto Sync target roster does not claim an Oreslang runtime SDK', () => {
  assert.equal(verifyStagedOreslang({matrix, presentPaths: []}), true);
});

test('reject Oreslang runtime targets in any identity field or nested alias', () => {
  const candidates = [
    ['oreslang', {dir: 'clients/custom', runtime: 'oreslang', zed_target: 'rust'}],
    ['fake', {dir: 'clients/oreslang', runtime: 'rust', zed_target: 'rust'}],
    ['wasm-bad', {dir: 'clients/wasm-oreslang', runtime: 'wasm', zed_target: 'nodejs'}],
    ['alias', {dir: 'clients/custom', runtime: 'rust', sdk: {backend: 'oreslang/graalvm-jvm'}}],
    ['wrapper', {dir: 'clients/custom', runtime: 'rust', bindings: [{language: 'ORESlang'}]}],
  ];
  for (const [name, meta] of candidates) {
    const contaminated = {...matrix, targets: {...matrix.targets, [name]: meta}};
    assert.throws(() => verifyStagedOreslang({matrix: contaminated, presentPaths: []}), /not runtime-admitted/, name);
  }
});

test('reject any Oreslang directory name, including nested, uppercase, JS and Wasm candidates', () => {
  for (const path of [
    'clients/oreslang', 'clients/oreslang-js', 'clients/oreslang-wasm',
    'clients/wasm-oreslang', 'clients/oreslang-native',
    'clients/ts/oreslang-browser', 'clients/ORESLANGJS',
  ]) {
    assert.throws(() => verifyStagedOreslang({matrix, presentPaths: [path]}), /lacks native admission/, path);
  }
});

test('directory inventory discovers candidates not present in the hard-coded original four paths', () => {
  const temp = mkdtempSync(join(tmpdir(), 'oreslang-admission-'));
  try {
    mkdirSync(join(temp, 'clients/ts/Oreslang-preview'), {recursive: true});
    const actual = listSdkPaths(temp);
    assert.ok(actual.includes('clients/ts/Oreslang-preview'));
    assert.throws(() => verifyStagedOreslang({matrix, presentPaths: actual}), /lacks native admission/);
  } finally {
    rmSync(temp, {recursive: true, force: true});
  }
});

test('deny missing or malformed matrix and directory inventory', () => {
  for (const bad of [null, {}, {targets: []}, {targets: {rust: null}}]) {
    assert.throws(() => verifyStagedOreslang({matrix: bad, presentPaths: []}), /invalid client target/);
  }
  for (const bad of [null, {}, ['clients/rust', 12]]) {
    assert.throws(() => verifyStagedOreslang({matrix, presentPaths: bad}), /invalid client directory inventory/);
  }
});
