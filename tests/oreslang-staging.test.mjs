import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyStagedOreslang} from '../scripts/verify-oreslang-staging.mjs';

const matrix = JSON.parse(readFileSync(new URL('../clients/client-contract-matrix.json',import.meta.url),'utf8'));

test('current Opto Sync target roster does not claim an Oreslang runtime SDK',()=>{
  assert.equal(verifyStagedOreslang({matrix,presentPaths:[]}),true);
});
test('reject Oreslang runtime target even when mislabeled',()=>{
  for(const target of [
    ['oreslang',{dir:'clients/custom',runtime:'oreslang',zed_target:'rust'}],
    ['fake',{dir:'clients/oreslang',runtime:'rust',zed_target:'rust'}],
    ['wasm-bad',{dir:'clients/wasm-oreslang',runtime:'wasm',zed_target:'nodejs'}],
  ]){
    const contaminated={...matrix,targets:{...matrix.targets,[target[0]]:target[1]}};
    assert.throws(()=>verifyStagedOreslang({matrix:contaminated,presentPaths:[]}),/not runtime-admitted/);
  }
});
test('deny unpublished source trees even before they enter target registry',()=>{
  for(const path of ['clients/oreslang','clients/oreslang-js','clients/oreslang-wasm','clients/wasm-oreslang']){
    assert.throws(()=>verifyStagedOreslang({matrix,presentPaths:[path]}),/lacks native admission/);
  }
});
test('deny missing/malformed matrix rather than silently passing',()=>{
  for(const bad of [null,{}, {targets:[]}]) {
    assert.throws(()=>verifyStagedOreslang({matrix:bad,presentPaths:[]}),/invalid client target matrix/);
  }
});
