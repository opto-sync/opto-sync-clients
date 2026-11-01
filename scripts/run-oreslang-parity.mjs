// Fail-closed external compiler/guest driver matrix. Never claims real execution
// unless the configured immutable driver is invoked and returns validated evidence.
// Usage: node scripts/run-oreslang-parity.mjs /absolute/drivers.json
// Drivers are reviewed locally by maintainers; NO repo-secret/token use.
import {readFileSync, realpathSync, statSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
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

export function validate_manifest(value) {
  if (value?.schemaVersion !== 1 || value.status !== 'candidate-not-admitted' ||
      !Array.isArray(value.cases) || value.cases.length < 5 ||
      JSON.stringify(value.backends) !== JSON.stringify(backends)) {
    throw new Error('invalid candidate manifest');
  }
  const seen = new Set();
  for (const c of value.cases) {
    if (typeof c.file !== 'string' || !/^(scalar|reject)-[a-z-]+\.ores$/.test(c.file) ||
        seen.has(c.file) || !['value','reject'].includes(c.kind) ||
        (c.kind === 'value' && (!Number.isSafeInteger(c.expected) || c.expected < 0 || c.expected > 255)) ||
        (c.kind === 'reject' && c.expected !== undefined)) throw new Error('invalid fixture');
    seen.add(c.file);
    const p = realpathSync(join(fixtures, c.file));
    if (dirname(p) !== fixtures || !statSync(p).isFile()) throw new Error('unsafe fixture path');
  }
  if (value.admission?.sdkPublished !== false ||
      value.admission?.fullToolchainParityVerified !== false ||
      value.admission?.wasmGuestVerified !== false ||
      value.admission?.jsTranspileVerified !== false) throw new Error('unsupported support claim');
}
validate_manifest(manifest);

export function validate_receipt(receipt, testCase, expectedSource, expectedDriver) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
      receipt.sourceSha256 !== expectedSource ||
      receipt.driverSha256 !== expectedDriver ||
      receipt.kind !== testCase.kind ||
      (testCase.kind === 'value' && receipt.value !== testCase.expected) ||
      (testCase.kind === 'reject' && ('value' in receipt)) ||
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
      d.args.some(x => typeof x !== 'string' || x.length > 1000)) {
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
export function verify_with_drivers(config) {
  if (config?.schemaVersion !== 1 || !config.drivers ||
      Object.keys(config.drivers).sort().join(',') !== [...backends].sort().join(',')) {
    throw new Error('all six independent drivers are required');
  }
  let count = 0;
  for (const backend of backends) {
    const driver = config.drivers[backend];
    validate_driver(driver);
    for (const c of manifest.cases) {
      const sourcePath = join(fixtures, c.file), hash = digest(sourcePath);
      const scratch = mkdtempSync(join(tmpdir(), 'oreslang-parity-'));
      const artifact = join(scratch, 'guest-artifact');
      try {
        const args = driver.args.map(x => x.replaceAll('{source}', sourcePath).replaceAll('{artifact}', artifact));
        const result = spawnSync(driver.binary, args, {
          cwd: root, shell: false, encoding: 'utf8', timeout: 120000,
          maxBuffer: 8192, env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? ''},
        });
        if (result.error || result.status !== 0 || result.signal ||
            typeof result.stdout !== 'string' || result.stdout.length > 4096) {
          throw new Error(backend + '/' + c.file + ': driver did not return valid evidence');
        }
        let receipt;
        try {receipt = JSON.parse(result.stdout);} catch {throw new Error('non-JSON driver evidence');}
        validate_receipt(receipt, c, hash, driver.sha256);
        if (receipt.compilerSha256 !== driver.compilerSha256 ||
            receipt.runtimeSha256 !== driver.runtimeSha256) {
          throw new Error('compiler/runtime provenance mismatch: ' + backend);
        }
        if (c.kind === 'value') {
          if (!existsSync(artifact) || !statSync(artifact).isFile() ||
              digest(artifact) !== receipt.artifactSha256) {
            throw new Error('compiled artifact missing or digest mismatch: ' + backend);
          }
        } else if (existsSync(artifact)) {
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('provide absolute, reviewed drivers.json');
  const configPath = process.argv[2];
  if (!configPath.startsWith('/')) throw new Error('config path must be absolute');
  const count = verify_with_drivers(JSON.parse(readFileSync(configPath, 'utf8')));
  console.log('Validated ' + count + ' configured toolchain/fixture receipts; inspect compiler guest execution logs before promotion');
}
