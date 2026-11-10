// Host-only admission & forged-evidence tests, NOT Oreslang runtime proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate_manifest, validate_receipt, validate_driver, verify_with_drivers} from '../../../scripts/run-oreslang-parity.mjs';
const m = JSON.parse(readFileSync(new URL('../fixtures/manifest.v1.json', import.meta.url),'utf8'));
test('fixtures are explicit, bounded and unadmitted',()=>{
  assert.doesNotThrow(()=>validate_manifest(m));
  assert.equal(m.cases.length,5);
  assert.equal(m.admission.sdkPublished,false);
});
test('fail closed on unsupported release claims and duplicate fixtures',()=>{
  assert.throws(()=>validate_manifest({...m,admission:{...m.admission,sdkPublished:true}}),/support claim/);
  assert.throws(()=>validate_manifest({...m,cases:[...m.cases,m.cases[0]]}),/invalid (candidate manifest|fixture)/);
  assert.throws(()=>validate_manifest({...m,backends:['java']}),/manifest/);
});
test('canonical v1 fixture names, expected exits and exact source bytes cannot drift',()=>{
  assert.doesNotThrow(()=>validate_manifest(m));
  const modifiedExpected = structuredClone(m);
  modifiedExpected.cases[0].expected = 15;
  assert.throws(()=>validate_manifest(modifiedExpected),/canonical scalar v1/);
  const reshuffled = structuredClone(m);
  [reshuffled.cases[0],reshuffled.cases[1]] = [reshuffled.cases[1],reshuffled.cases[0]];
  assert.throws(()=>validate_manifest(reshuffled),/canonical scalar v1/);
  const forgedKind = structuredClone(m);
  forgedKind.cases[3].kind = 'value';
  forgedKind.cases[3].expected = 0;
  assert.throws(()=>validate_manifest(forgedKind),/canonical scalar v1/);
  const extraField = structuredClone(m);
  extraField.cases[0].sourceSha256 = '0'.repeat(64);
  assert.throws(()=>validate_manifest(extraField),/canonical scalar v1/);
});

test('forged receipts, mismatched identity and values are rejected',()=>{
  const h='a'.repeat(64), d='b'.repeat(64);
  const valid={backend:'llvm',sourceSha256:h,driverSha256:d,kind:'value',value:14,
    compilerSha256:h,runtimeSha256:h,artifactSha256:h,compilerExitCode:0,guestExitCode:14};
  assert.equal(validate_receipt(valid,m.cases[0],h,d,'llvm'),true);
  for (const bad of [
    {...valid,backend:'java'},{...valid,value:15},{...valid,kind:'reject'},{...valid,sourceSha256:d},
    {...valid,driverSha256:h},{...valid,compilerSha256:''},
    {...valid,runtimeSha256:'0'},{...valid,artifactSha256:null},
    {...valid,compilerExitCode:1},{...valid,guestExitCode:0},
  ]) assert.throws(()=>validate_receipt(bad,m.cases[0],h,d,'llvm'),/receipt/);
  assert.throws(()=>validate_receipt({...valid,kind:'reject',value:14},m.cases[3],h,d,'llvm'),/receipt/);
  const negative={...valid,kind:'reject',artifactSha256:null,compilerExitCode:1}; delete negative.value; delete negative.guestExitCode;
  assert.equal(validate_receipt(negative,m.cases[3],h,d,'llvm'),true);
  assert.throws(()=>validate_receipt({...negative,artifactSha256:h},m.cases[3],h,d,'llvm'),/receipt/);
  assert.throws(()=>validate_receipt({...negative,compilerExitCode:0},m.cases[3],h,d,'llvm'),/receipt/);
  assert.throws(()=>validate_receipt({...negative,guestExitCode:0},m.cases[3],h,d,'llvm'),/receipt/);

});
test('external driver commands require pinning, no shell interpolation',()=>{
  for (const bad of [
    {},{binary:'sh',sha256:'a'.repeat(64),args:['{source}']},
    {binary:'/bin/echo',sha256:'wrong',args:['{source}']},
    {binary:'/bin/echo',sha256:'a'.repeat(64),args:[]},
  ]) assert.throws(()=>validate_driver(bad));
  assert.throws(()=>verify_with_drivers({schemaVersion:1,drivers:{}}),/six independent/);
});
test('independent host oracle covers checkpoint, generation and retry guards',()=>{
  // Deliberately a host reference; NOT a substitute for compiling .ores.
  const checkpoint=(durable,applied,next)=>durable>=0 && applied>=durable && next>=durable && next<=applied;
  const generation=(observed,current,claim)=>current>0 && observed===current && claim===current;
  const retry=(started,deadline,now)=>started>=0 && deadline>=started && now>=started && now<deadline;
  for(const [a,b,c,expected] of [[2,5,5,true],[2,5,2,true],[2,5,1,false],[2,5,6,false],[-1,5,3,false],[6,5,6,false]])
    assert.equal(checkpoint(a,b,c),expected);
  for(const [a,b,c,expected] of [[7,7,7,true],[6,7,7,false],[7,7,6,false],[0,0,0,false]])
    assert.equal(generation(a,b,c),expected);
  for(const [a,b,c,expected] of [[100,200,100,true],[100,200,199,true],[100,200,200,false],[100,200,99,false],[100,99,100,false],[-1,200,100,false]])
    assert.equal(retry(a,b,c),expected);
});
