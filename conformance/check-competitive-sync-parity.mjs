import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, 'competitive-sync-parity.v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const validStatuses = new Set(manifest.statusValues ?? []);
const errors = [];

if (manifest.version !== 1) errors.push('manifest.version must be 1');
if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
  errors.push('manifest.capabilities must be a non-empty array');
}

const ids = new Set();
for (const capability of manifest.capabilities ?? []) {
  if (!capability || typeof capability !== 'object') {
    errors.push('every capability must be an object');
    continue;
  }
  if (typeof capability.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(capability.id)) {
    errors.push(`invalid capability id: ${JSON.stringify(capability.id)}`);
  } else if (ids.has(capability.id)) {
    errors.push(`duplicate capability id: ${capability.id}`);
  } else {
    ids.add(capability.id);
  }
  if (!validStatuses.has(capability.status)) {
    errors.push(`${capability.id ?? '<unknown>'}: invalid status ${JSON.stringify(capability.status)}`);
  }
  if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) {
    errors.push(`${capability.id ?? '<unknown>'}: evidence must be non-empty`);
  }
  if (capability.status === 'implemented') {
    const evidence = capability.evidence ?? [];
    const hasCodeEvidence = evidence.some((item) => typeof item === 'string' && !item.startsWith('Linear:') && !item.startsWith('Comparator:'));
    const hasContractOrTestEvidence = evidence.some((item) => typeof item === 'string' && (item.includes('formal/') || item.includes('schema/') || item.includes('sync-loop') || item.includes('service-worker') || item.includes('cross-tab') || item.includes('client.ts')));
    if (!hasCodeEvidence || !hasContractOrTestEvidence) {
      errors.push(`${capability.id}: implemented claims require code plus contract/test/runtime evidence`);
    }
  }
  if ((capability.status === 'partial' || capability.status === 'missing') && typeof capability.target !== 'string') {
    errors.push(`${capability.id}: ${capability.status} capability must define target`);
  }
}

if (errors.length > 0) {
  console.error('competitive sync parity manifest is invalid:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const counts = Object.fromEntries(
  [...validStatuses].map((status) => [
    status,
    manifest.capabilities.filter((capability) => capability.status === status).length,
  ]),
);
console.log(`competitive sync parity v${manifest.version}: ${JSON.stringify(counts)}`);
