'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {admitPortablePolicy, assertPortablePolicyFrozen, resolvePortableConflict, UnsupportedPortablePolicyError}
  = require('../src/portable-conflict-policy.ts');
const policy={id:'opto.lww.identity.v1',version:1,tieBreaker:'mutation_id_utf16'};
const a={mutationId:'a',logicalTime:'18446744073709551614',tombstone:true,canonicalPayload:'null'};
const b={mutationId:'b',logicalTime:'18446744073709551614',tombstone:false,canonicalPayload:'{"v":1}'};
test('equal timestamp tie and reordered network arrival are deterministic',()=>{
 assert.deepEqual(resolvePortableConflict(policy,a,b),b);
 assert.deepEqual(resolvePortableConflict(policy,b,a),b);
 assert.deepEqual(resolvePortableConflict({...policy,id:'opto.fww.identity.v1'},a,b),a);
});
test('unknown/callback policy fails closed and durable identity cannot drift',()=>{
 assert.throws(()=>admitPortablePolicy({...policy,id:'custom-js-handler'}),UnsupportedPortablePolicyError);
 assert.throws(()=>assertPortablePolicyFrozen(policy,{...policy,id:'opto.fww.identity.v1'}),UnsupportedPortablePolicyError);
 assert.doesNotThrow(()=>assertPortablePolicyFrozen(policy,policy));
});
test('integer epochs are lossless and tombstone is not implicitly resurrected',()=>{
 const later={...a,logicalTime:'18446744073709551615'};
 assert.deepEqual(resolvePortableConflict(policy,b,later),later);
 assert.throws(()=>resolvePortableConflict(policy,a,{...b,logicalTime:'1.5'}),UnsupportedPortablePolicyError);
});
