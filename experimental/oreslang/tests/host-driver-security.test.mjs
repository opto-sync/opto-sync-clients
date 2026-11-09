// HOST-ONLY synthetic-driver tests: no AttoLang compiler, guest, or SDK claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verify_with_drivers, verify_java_llvm_stage} from '../../../scripts/run-oreslang-parity.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['java','llvm','wasm','forge','net','js'];
const mockScript = [
  '#!/usr/bin/env node',
  "'use strict';",
  "const fs = require('node:fs');",
  "const crypto = require('node:crypto');",
  "const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');",
  "const [backend, source, artifact, compiler, runtime, fixture, mode] = process.argv.slice(2);",
  "const expected = {'scalar-order.ores':14,'scalar-parens.ores':42,'scalar-boundary.ores':1};",
  "const reject = fixture.startsWith('reject-');",
  "if (!reject && mode === 'symlink') fs.symlinkSync(source,artifact);",
  "if (reject && mode === 'dangling') fs.symlinkSync('/no/such/opto-guest-artifact',artifact);",
  "if (!reject && mode !== 'symlink') fs.writeFileSync(artifact,'synthetic:' + backend + ':' + fixture);",
  "const r = {backend, sourceSha256:hash(source),driverSha256:hash(process.argv[1]),",
  "  compilerSha256:hash(compiler),runtimeSha256:hash(runtime),",
  "  kind:reject?'reject':'value',compilerExitCode:reject?1:0,",
  "  artifactSha256:reject?null:hash(artifact)};",
  "if (!reject) {r.value=expected[fixture];r.guestExitCode=mode==='bad-exit'?0:expected[fixture];}",
  "console.log(JSON.stringify(r));",
].join('\n') + '\n';

function withSyntheticDrivers(mode, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'opto-host-security-'));
  try {
    const binary = join(dir, 'mock-driver');
    const compiler = join(dir, 'mock-compiler');
    const runtime = join(dir, 'mock-runtime');
    writeFileSync(binary, mockScript, {mode:0o700});
    writeFileSync(compiler, '#!/bin/sh\nexit 0\n', {mode:0o700});
    writeFileSync(runtime, '#!/bin/sh\nexit 0\n', {mode:0o700});
    const pinned = {
      binary, sha256:hash(mockScript),
      compiler, compilerSha256:hash('#!/bin/sh\nexit 0\n'),
      runtime, runtimeSha256:hash('#!/bin/sh\nexit 0\n'),
    };
    const config = {schemaVersion:1, drivers:Object.fromEntries(names.map(backend => [
      backend, {...pinned, args:[backend,'{source}','{artifact}','{compiler}','{runtime}','{case}',mode]}
    ]))};
    callback(config);
  } finally {
    rmSync(dir, {recursive:true,force:true});
  }
}

test('synthetic pinned driver covers all thirty receipt admissions (HOST_ONLY)', () => {
  withSyntheticDrivers('valid', config => {
    assert.equal(verify_with_drivers(config), 30);
  });
});

test('reject compiler guest exit mismatch instead of treating receipt as proof', () => {
  withSyntheticDrivers('bad-exit', config => {
    assert.throws(() => verify_with_drivers(config), /mismatched compiler-backed receipt/);
  });
});

test('reject artifact symlink to pinned source even when digest matches', () => {
  withSyntheticDrivers('symlink', config => {
    assert.throws(() => verify_with_drivers(config), /artifact missing or digest mismatch/);
  });
});

test('reject dangling artifact symlink after compiler rejection', () => {
  withSyntheticDrivers('dangling', config => {
    assert.throws(() => verify_with_drivers(config), /rejected source nevertheless published artifact/);
  });
});

test('reject unpinned compiler or runtime, and omission of executable arguments', () => {
  withSyntheticDrivers('valid', config => {
    config.drivers.llvm.compilerSha256 = '0'.repeat(64);
    assert.throws(() => verify_with_drivers(config), /unpinned toolchain executable/);
  });
  withSyntheticDrivers('valid', config => {
    config.drivers.java.args = ['java','{source}','{artifact}'];
    assert.throws(() => verify_with_drivers(config), /invalid driver definition/);
  });
});

test('separate Java/LLVM stage uses ten strict compiler/guest receipts, host synthetic only', () => {
  withSyntheticDrivers('valid', config => {
    const stage = {schemaVersion:1, drivers:{java:config.drivers.java, llvm:config.drivers.llvm}};
    assert.equal(verify_java_llvm_stage(stage), 10);
    assert.throws(() => verify_with_drivers(stage), /all six independent drivers/);
  });
});

test('Java/LLVM stage refuses missing, extra or substituted driver lanes', () => {
  withSyntheticDrivers('valid', config => {
    assert.throws(() => verify_java_llvm_stage(config), /exactly two independently pinned/);
    assert.throws(() => verify_java_llvm_stage({
      schemaVersion:1, drivers:{java:config.drivers.java}
    }), /exactly two independently pinned/);
    assert.throws(() => verify_java_llvm_stage({
      schemaVersion:1, drivers:{java:config.drivers.java, wasm:config.drivers.wasm}
    }), /exactly two independently pinned/);
    const staged = {schemaVersion:1, drivers:{java:config.drivers.java, llvm:{...config.drivers.llvm, compilerSha256:'0'.repeat(64)}}};
    assert.throws(() => verify_java_llvm_stage(staged), /unpinned toolchain executable/);
  });
});

test('Java/LLVM stage rejects forged native guest exits and artifact links', () => {
  withSyntheticDrivers('bad-exit', config => {
    const staged={schemaVersion:1,drivers:{java:config.drivers.java,llvm:config.drivers.llvm}};
    assert.throws(() => verify_java_llvm_stage(staged), /mismatched compiler-backed receipt/);
  });
  withSyntheticDrivers('symlink', config => {
    const staged={schemaVersion:1,drivers:{java:config.drivers.java,llvm:config.drivers.llvm}};
    assert.throws(() => verify_java_llvm_stage(staged), /artifact missing or digest mismatch/);
  });
  withSyntheticDrivers('dangling', config => {
    const staged={schemaVersion:1,drivers:{java:config.drivers.java,llvm:config.drivers.llvm}};
    assert.throws(() => verify_java_llvm_stage(staged), /rejected source nevertheless published artifact/);
  });
});
