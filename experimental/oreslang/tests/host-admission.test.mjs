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
  assert.throws(()=>validate_manifest({...m,cases:[...m.cases,m.cases[0]]}),/invalid fixture/);
  assert.throws(()=>validate_manifest({...m,backends:['java']}),/manifest/);
});
test('forged receipts, mismatched identity and values are rejected',()=>{
  const h='a'.repeat(64), d='b'.repeat(64);
  const valid={sourceSha256:h,driverSha256:d,kind:'value',value:14,
    compilerSha256:h,runtimeSha256:h,artifactSha256:h};
  assert.equal(validate_receipt(valid,m.cases[0],h,d),true);
  for (const bad of [
    {...valid,value:15},{...valid,kind:'reject'},{...valid,sourceSha256:d},
    {...valid,driverSha256:h},{...valid,compilerSha256:''},
    {...valid,runtimeSha256:'0'},{...valid,artifactSha256:null},
  ]) assert.throws(()=>validate_receipt(bad,m.cases[0],h,d),/receipt/);
  assert.throws(()=>validate_receipt({...valid,kind:'reject',value:14},m.cases[3],h,d),/receipt/);
  const negative={...valid,kind:'reject',artifactSha256:null}; delete negative.value;
  assert.equal(validate_receipt(negative,m.cases[3],h,d),true);
  assert.throws(()=>validate_receipt({...negative,artifactSha256:h},m.cases[3],h,d),/receipt/);

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
