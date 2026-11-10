// Fail-closed external compiler/guest driver matrix. Never claims real execution
// unless the configured immutable driver is invoked and returns validated evidence.
// Usage: node scripts/run-oreslang-parity.mjs /absolute/drivers.json
// Drivers are reviewed locally by maintainers; NO repo-secret/token use.
import {readFileSync, writeFileSync, realpathSync, statSync, lstatSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {resolve, join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = resolve(root, 'experimental/oreslang/fixtures');
const manifest = JSON.parse(readFileSync(join(fixtures, 'manifest.v1.json'), 'utf8'));
const backends = ['java', 'llvm', 'wasm', 'forge', 'net', 'js'];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (p) => sha(readFileSync(p));

// Frozen candidate v1 scalar corpus: independently matched to the exact-byte
// Java #2751 and LLVM #1639 source fixtures. Neither a mutable manifest nor
// host-only synthetic driver can silently redefine successful guest behavior.
const scalarV1 = Object.freeze([
  {file:'scalar-order.ores', kind:'value', expected:14, sha256:'0dedccfdeff013995e1e5d784bf1767acf61b0c0485fa50aba6aa9dd473331f2'},
  {file:'scalar-parens.ores', kind:'value', expected:42, sha256:'c1be02a97cbf9c02a3ff6ed2c3452cbde2e7adca77b03c93ea2a185b87fd5a8f'},
  {file:'scalar-boundary.ores', kind:'value', expected:1, sha256:'48e5c6d9a4284d5d9c05bab779fa74a53341a981d5e6c63ce6cc5c52cbf323dd'},
  {file:'reject-overflow.ores', kind:'reject', sha256:'dbc6368f793beef3465a061983134ef85621d9084bc179f8d53c096fa0242461'},
  {file:'reject-invalid.ores', kind:'reject', sha256:'dce35f88681548d3e3e4e1d04394924a9b70f27925acc37a53689d74237ec33a'},
]);

export function validate_manifest(value) {
  if (value?.schemaVersion !== 1 || value.status !== 'candidate-not-admitted' ||
      !Array.isArray(value.cases) || value.cases.length !== scalarV1.length ||
      JSON.stringify(value.backends) !== JSON.stringify(backends)) {
    throw new Error('invalid candidate manifest');
  }
  const seen = new Set();
  for (const [index, c] of value.cases.entries()) {
    if (typeof c.file !== 'string' || !/^(scalar|reject)-[a-z-]+\.ores$/.test(c.file) ||
        seen.has(c.file) || !['value','reject'].includes(c.kind) ||
        (c.kind === 'value' && (!Number.isSafeInteger(c.expected) || c.expected < 0 || c.expected > 255)) ||
        (c.kind === 'reject' && c.expected !== undefined)) throw new Error('invalid fixture');
    seen.add(c.file);
    const p = realpathSync(join(fixtures, c.file));
    if (dirname(p) !== fixtures || !statSync(p).isFile()) throw new Error('unsafe fixture path');
    const canonical = scalarV1[index];
    if (c.file !== canonical.file || c.kind !== canonical.kind ||
        c.expected !== canonical.expected || Object.keys(c).sort().join(',') !==
        (canonical.kind === 'value' ? 'expected,file,kind' : 'file,kind')) {
      throw new Error('invalid canonical scalar v1 fixture contract');
    }
    if (sha(readFileSync(p)) !== canonical.sha256) {
      throw new Error('scalar v1 fixture byte digest mismatch: ' + c.file);
    }
  }
  if (value.admission?.sdkPublished !== false ||
      value.admission?.fullToolchainParityVerified !== false ||
      value.admission?.wasmGuestVerified !== false ||
      value.admission?.jsTranspileVerified !== false) throw new Error('unsupported support claim');
}
validate_manifest(manifest);

export function validate_receipt(receipt, testCase, expectedSource, expectedDriver, expectedBackend) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      receipt.backend !== expectedBackend || !backends.includes(receipt.backend) ||
      receipt.sourceSha256 !== expectedSource ||
      receipt.driverSha256 !== expectedDriver ||
      receipt.kind !== testCase.kind ||
      (testCase.kind === 'value' && receipt.value !== testCase.expected) ||
      (testCase.kind === 'reject' && ('value' in receipt || 'guestExitCode' in receipt)) ||
      (testCase.kind === 'value' && (receipt.compilerExitCode !== 0 || receipt.guestExitCode !== testCase.expected)) ||
      (testCase.kind === 'reject' &&
        (!Number.isInteger(receipt.compilerExitCode) || receipt.compilerExitCode === 0)) ||
      typeof receipt.compilerSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.compilerSha256) ||
      typeof receipt.runtimeSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.runtimeSha256) ||
      (testCase.kind === 'value' && (typeof receipt.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.artifactSha256))) ||
      (testCase.kind === 'reject' && receipt.artifactSha256 !== null)) {
    throw new Error('invalid or mismatched compiler-backed receipt');
  }
  return true;
}
export function validate_driver(d) {
  if (!d || typeof d !== 'object' || typeof d.binary !== 'string' ||
      !d.binary.startsWith('/') || typeof d.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(d.sha256) ||
      !Array.isArray(d.args) || d.args.length > 16 ||
      !d.args.includes('{source}') || !d.args.includes('{artifact}') ||
      !d.args.includes('{compiler}') || !d.args.includes('{runtime}') ||
      d.args.some(x => typeof x !== 'string' || x.length > 1000 || x.includes('\0'))) {
    throw new Error('invalid driver definition');
  }
  for (const [pathKey, shaKey] of [['binary','sha256'],['compiler','compilerSha256'],['runtime','runtimeSha256']]) {
    if (typeof d[pathKey] !== 'string' || !d[pathKey].startsWith('/') ||
        typeof d[shaKey] !== 'string' || !/^[a-f0-9]{64}$/.test(d[shaKey])) {
      throw new Error('missing toolchain provenance pin: ' + pathKey);
    }
    const path = realpathSync(d[pathKey]);
    if (!statSync(path).isFile() || digest(path) !== d[shaKey]) {
      throw new Error('unpinned toolchain executable: ' + pathKey);
    }
  }
}
// existsSync follows dangling symlinks; negative compiler fixtures must reject
// even an artifact symlink whose target does not exist.
function lstatExists(path) {
  try { lstatSync(path); return true; } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
// Exactly-scoped toolchain stages share the SAME immutable pin, compiler/guest
// exit, artifact and negative-case gates. A partial stage can never be passed
// to the six-backend release qualification entrypoint.
function run_driver_matrix(config, requiredBackends, invalidScope) {
  if (config?.schemaVersion !== 1 || !config.drivers ||
      Object.keys(config.drivers).sort().join(',') !== [...requiredBackends].sort().join(',')) {
    throw new Error(invalidScope);
  }
  let count = 0;
  for (const backend of requiredBackends) {
    const driver = config.drivers[backend];
    validate_driver(driver);
    for (const c of manifest.cases) {
      const sourcePath = join(fixtures, c.file);
      const scratch = mkdtempSync(join(tmpdir(), 'oreslang-parity-'));
      const artifact = join(scratch, 'guest-artifact');
      const source = join(scratch, 'source.ores');
      try {
        // Snapshot the exact bytes handed to the driver. Never invoke mutable
        // original paths after checking provenance: that would permit swapping
        // a pinned executable or fixture between the digest and spawn.
        writeFileSync(source, readFileSync(sourcePath), {flag:'wx', mode:0o400});
        const hash = digest(source);
        const staged = {};
        for (const [key, pin] of [
          ['binary','sha256'], ['compiler','compilerSha256'], ['runtime','runtimeSha256']
        ]) {
          const bytes = readFileSync(realpathSync(driver[key]));
          if (sha(bytes) !== driver[pin]) {
            throw new Error('toolchain changed after pin verification: ' + key);
          }
          staged[key] = join(scratch, key + '-executable');
          writeFileSync(staged[key], bytes, {flag:'wx', mode:0o500});
          if (digest(staged[key]) !== driver[pin]) {
            throw new Error('staged toolchain digest mismatch: ' + key);
          }
        }
        const args = driver.args.map(x => x
          .replaceAll('{source}', source)
          .replaceAll('{artifact}', artifact)
          .replaceAll('{compiler}', staged.compiler)
          .replaceAll('{runtime}', staged.runtime)
          .replaceAll('{case}', c.file));
        const result = spawnSync(staged.binary, args, {
          cwd: scratch, shell: false, encoding: 'utf8', timeout: 120000,
          maxBuffer: 8192, env: {PATH: process.env.PATH ?? '', HOME: scratch},
        });
        if (result.error || result.status !== 0 || result.signal ||
            typeof result.stdout !== 'string' || result.stdout.length > 4096) {
          throw new Error(backend + '/' + c.file + ': driver did not return valid evidence');
        }
        let receipt;
        try {receipt = JSON.parse(result.stdout);} catch {throw new Error('non-JSON driver evidence');}
        validate_receipt(receipt, c, hash, driver.sha256, backend);
        if (receipt.compilerSha256 !== driver.compilerSha256 ||
            receipt.runtimeSha256 !== driver.runtimeSha256) {
          throw new Error('compiler/runtime provenance mismatch: ' + backend);
        }
        if (c.kind === 'value') {
          // Do not follow a symlink controlled by an external driver. Its
          // target could be an unrelated sensitive host file with a forged SHA.
          if (!existsSync(artifact) || !lstatSync(artifact).isFile() ||
              realpathSync(artifact) !== artifact ||
              digest(artifact) !== receipt.artifactSha256) {
            throw new Error('compiled artifact missing or digest mismatch: ' + backend);
          }
        } else if (existsSync(artifact) || lstatExists(artifact)) {
          throw new Error('rejected source nevertheless published artifact: ' + backend);
        }
        count++;
      } finally {
        rmSync(scratch, {recursive:true, force:true});
      }
    }
  }
  return count;
}

// Only the existing portable scalar fixtures are supported by this first
// independently reviewed compiler stage. Structured sync SDK/actor APIs are
// outside its scope; see the .ores source contracts and promotion gates.
export function verify_java_llvm_stage(config) {
  return run_driver_matrix(config, ['java', 'llvm'],
    'java/llvm stage requires exactly two independently pinned drivers');
}

// This original all-six entrypoint MUST NOT accept a partial stage config.
export function verify_with_drivers(config) {
  return run_driver_matrix(config, backends, 'all six independent drivers are required');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stage = process.argv[2] === '--stage-java-llvm';
  if (stage ? process.argv.length !== 4 : process.argv.length !== 3) {
    throw new Error('provide reviewed absolute drivers.json; optional --stage-java-llvm');
  }
  const configPath = process.argv[stage ? 3 : 2];
  if (!configPath.startsWith('/')) throw new Error('config path must be absolute');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const count = stage ? verify_java_llvm_stage(config) : verify_with_drivers(config);
  if (stage) {
    console.log(JSON.stringify({
      scope: 'java-llvm-scalar-fixtures-only',
      driverReceipts: count,
      fullToolchainParity: 'NOT_CERTIFIED',
      sdk: 'NOT_PUBLISHED',
      evidence: 'DRIVER_REPORTED_REQUIRES_INDEPENDENT_GUEST_LOGS'
    }));
  } else {
    console.log('Validated ' + count + ' configured toolchain/fixture receipts; inspect compiler guest execution logs before promotion');
  }
}
