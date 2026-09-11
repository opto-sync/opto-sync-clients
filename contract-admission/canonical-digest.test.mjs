import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalStringify, sha256Json, verifyContractIrAdmission } from './contract-ir-admission.mjs';

for (const key of ['allOf', 'anyOf', 'enum', 'oneOf', 'required', 'type']) {
  test(`literal ${key} array order binds the digest`, () => {
    assert.notEqual(sha256Json({ const: { [key]: ['b', 'a'] } }), sha256Json({ const: { [key]: ['a', 'b'] } }));
  });
  test(`literal ${key} array multiplicity binds the digest`, () => {
    assert.notEqual(sha256Json({ [key]: ['a', 'a'] }), sha256Json({ [key]: ['a'] }));
  });
}
test('object key order alone does not change JSON identity', () => {
  assert.equal(sha256Json({ b: 2, a: [{ d: 4, c: 3 }] }), sha256Json({ a: [{ c: 3, d: 4 }], b: 2 }));
});
test('own __proto__ data is retained and does not mutate prototypes', () => {
  const input = JSON.parse('{"__proto__":{"polluted":true},"x":1}');
  assert.equal(canonicalStringify(input), '{"__proto__":{"polluted":true},"x":1}');
  assert.notEqual(sha256Json(input), sha256Json({ x: 1 }));
  assert.equal({}.polluted, undefined);
});
function envelope(declarations = [], complete = true) {
  const inputs = Object.fromEntries(['typespec', 'authoredJsonSchema', 'generatedJsonSchema'].map((key, index) => [key, { digest: String(index + 1).repeat(64) }]));
  const parityReport = { schema: 'ores.typespec-json-schema-validator.report/v1', runId: 'a'.repeat(64), status: 'passed', zeroUnexplainedFindings: true, findings: [], inputs };
  const body = {
    schema: 'ores.typespec-json-schema-validator.contract-ir/v1', status: 'passed', admissible: true,
    role: 'downstream-derived-parity-artifact', editableAuthority: false,
    authorities: { typespec: 'independently-authored', jsonSchema: 'independently-authored', generatedJsonSchema: 'comparison-evidence-only', precedence: 'none' },
    provenance: inputs,
    admission: { receipt: { schema: parityReport.schema, runId: parityReport.runId, status: 'passed', zeroUnexplainedFindings: true, digest: sha256Json(parityReport) }, scope: { complete } },
    declarations,
  };
  return { contractIr: { ...body, irId: sha256Json(body) }, parityReport, expectedInputs: Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, value.digest])) };
}
test('rejects an empty declaration list even with recomputed valid digests', () => {
  assert.throws(() => verifyContractIrAdmission(envelope()), /nonempty/);
});
test('requires complete scope by default', () => {
  assert.throws(() => verifyContractIrAdmission(envelope([], false)), /complete Contract IR scope/);
});
test('rejects a nonboolean completeness policy', () => {
  assert.throws(() => verifyContractIrAdmission({ ...envelope(), requireComplete: 'false' }), /must be boolean/);
});
test('rejects duplicate declarations despite valid envelope and assertion digests', () => {
  const declaration = { id: 'Example.Id', assertionSchema: { type: 'string' }, assertionDigest: sha256Json({ type: 'string' }), lanes: { typespecGeneratedJsonSchema: { role: 'comparison-evidence-only' }, authoredJsonSchema: { role: 'independently-authored-authority' } } };
  assert.throws(() => verifyContractIrAdmission(envelope([declaration, declaration])), /unique/);
});
