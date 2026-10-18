'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeTransactionGroup, assertSameTransactionGroup, decideTransactionGroup,
  GroupContractError } = require('../dist/transaction-groups.js');
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const members = [
  {mutationId:'m1',table:'docs',recordId:'x',operation:'insert',payloadDigest:A},
  {mutationId:'m2',table:'notes',recordId:'y',operation:'delete',payloadDigest:B},
];
const group = () => makeTransactionGroup('group-1', members);
const expectCode = (f, code) => assert.throws(f,
  e => e instanceof GroupContractError && e.code === code);

test('group immutable membership is distinct from transport batch identity', () => {
  const g = group();
  assert.equal(Object.isFrozen(g), true);
  assert.equal(Object.isFrozen(g.members[0]), true);
  assertSameTransactionGroup(g, makeTransactionGroup('group-1', members));
  expectCode(() => assertSameTransactionGroup(g, makeTransactionGroup('group-1', [
    members[1],members[0],
  ])), 'group_identity_reused');
  expectCode(() => assertSameTransactionGroup(g, makeTransactionGroup('group-1', [
    members[0],{...members[1],payloadDigest:A},
  ])), 'group_identity_reused');
});
test('atomic server must acknowledge complete exact membership or reject group', () => {
  const g=group();
  const ok=decideTransactionGroup(g, 'atomic', {groupId:'group-1',status:'committed',
    outcomes:members.map(m=>({mutationId:m.mutationId,outcome:'accepted'}))});
  assert.equal(ok.status, 'committed');
  assert.deepEqual(ok.resolvedIds,['m1','m2']);
  expectCode(() => decideTransactionGroup(g,'atomic',{groupId:'group-1',status:'rejected',
    outcomes:[{mutationId:'m1',outcome:'accepted'},{mutationId:'m2',outcome:'rejected'}]}),
    'atomic_partial_ack');
  expectCode(() => decideTransactionGroup(g,'atomic',{groupId:'group-1',status:'committed',
    outcomes:[{mutationId:'m1',outcome:'accepted'}]}), 'non_exact_ack');
});
test('ordered mode reports only exact covered outcomes; unrelated pending is untouched', () => {
  const result=decideTransactionGroup(group(),'ordered',{groupId:'group-1',status:'rejected',
    outcomes:[{mutationId:'m1',outcome:'accepted'},{mutationId:'m2',outcome:'rejected'}]});
  assert.equal(result.status,'partially_resolved');
  assert.deepEqual(result.resolvedIds,['m1']);
  assert.deepEqual(result.rejectedIds,['m2']);
  expectCode(() => decideTransactionGroup(group(),'ordered',{groupId:'group-1',status:'committed',
    outcomes:[{mutationId:'m2',outcome:'accepted'},{mutationId:'m1',outcome:'accepted'}]}),'non_exact_ack');
});
test('lost response stays ambiguous even after server commit and network retry', () => {
  assert.equal(decideTransactionGroup(group(),'atomic',
    {groupId:'group-1',status:'response_lost'}).status,'ambiguous');
  expectCode(()=>decideTransactionGroup(group(),'unsupported',
    {groupId:'group-1',status:'response_lost'}),'atomicity_not_negotiated');
});
test('invalid group identities never silently recycle mutation content', () => {
  expectCode(()=>makeTransactionGroup('group-1',[members[0],members[0]]),'duplicate_mutation_id');
  expectCode(()=>makeTransactionGroup('group-1',[members[0]]),'invalid_group_size');
  expectCode(()=>makeTransactionGroup('group-1',[members[0],{...members[1],payloadDigest:'invalid'}]),
    'invalid_member');
});
