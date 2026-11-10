// Real SQLite host execution, not compiled AttoLang. Node 24+.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, lstatSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {open_sqlite_sync_journal} from '../sqlite_journal.host.mjs';

const ID={tenant:'tenant-a',client_id:'client-a'};
const MUTATION={record_id:'record-1',base_revision:'0',payload:{title:'alpha'},started_ms:'100',deadline_ms:'200'};
const good_reply=(e,status='applied',overrides={})=>({
  status:200,json:{
    protocolVersion:1,clientId:e.clientId,
    lastMutationId:e.mutations[0].mutationId,checkpoint:'7',
    results:[{mutationId:e.mutations[0].mutationId,status,
      ...(status==='duplicate'?{originalStatus:'applied'}:{})}],
    ...overrides
  }
});
const mk = (t,exchange=(e)=>good_reply(e))=>{
  const dir=mkdtempSync(join(tmpdir(),'atto-sqlite-exact-'));
  const path=join(dir,'journal.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const open=(ex=exchange)=>open_sqlite_sync_journal(path,{...ID,exchange:ex});
  return {dir,path,open};
};

test('real SQLite WAL and FULL synchronous stage before receipt; reopen preserves exact payload',t=>{
  const {path,open}=mk(t);
  const s=open();
  const original={...MUTATION,payload:{title:'alpha'}};
  const receipt=s.stage_mutation(original);
  assert.equal(Object.keys(receipt).length,0,'receipt has no user-forgeable fields');
  original.payload.title='tampered';
  assert.equal(s.snapshot().pending.payload.title,'alpha');
  assert.equal(s.snapshot().generation,'1');
  const db=new DatabaseSync(path);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  assert.equal(db.prepare('PRAGMA synchronous').get().synchronous,2);
  db.close();
  s.close();
  const recovered=open();
  assert.equal(recovered.snapshot().generation,'2');
  assert.equal(recovered.snapshot().pending.mutationId,'1');
  assert.equal(recovered.snapshot().pending.payload.title,'alpha');
  recovered.close();
});

test('stage receipt is opaque, required for dispatch, and bound to exact session',async t=>{
  let calls=0;
  const {open}=mk(t,e=>{calls++;return good_reply(e);});
  const s=open();
  await assert.rejects(s.dispatch({},'150'),/trusted stage receipt/);
  assert.equal(calls,0);
  const original=s.stage_mutation(MUTATION);
  await assert.rejects(s.dispatch(Object.freeze({session:'forged',generation:'1'}),'150'),/trusted stage receipt/);
  const verified=await s.dispatch(original,'150');
  assert.equal(verified.kind,'verified_response');
  assert.equal(calls,1);
  assert.throws(()=>s.retire_verified({}),/trusted verified ACK receipt/);
  assert.throws(()=>s.retire_verified(original),/trusted verified ACK receipt/);
  const outcome=s.retire_verified(verified.ack_receipt);
  assert.equal(outcome.kind,'durably_retired');
  assert.equal(outcome.lastAck,'1');
  assert.equal(s.snapshot().pending,null);
  assert.throws(()=>s.retire_verified(verified.ack_receipt),/trusted verified ACK receipt/);
  await assert.rejects(s.dispatch(original,'160'),/current durable mutation/);
  s.close();
});

test('unknown transport outcome preserves ID, payload and original deadline',async t=>{
  let calls=0;
  const {open}=mk(t,()=>{calls++;throw new Error('lost HTTP response');});
  const s=open();
  const receipt=s.stage_mutation(MUTATION);
  assert.deepEqual(await s.dispatch(receipt,'150'),{kind:'unknown',mutationId:'1'});
  assert.equal(s.snapshot().pending.mutationId,'1');
  assert.equal(s.snapshot().deadlineMs,'200');
  assert.throws(()=>s.stage_mutation(MUTATION),/previous mutation must retire/);
  await assert.rejects(s.dispatch(receipt,'200'),/retry budget expired/);
  assert.equal(calls,1);
  s.close();
  const recovered=open(e=>good_reply(e,'duplicate'));
  const after=await recovered.dispatch(recovered.recovered_stage_receipt(),'199');
  assert.equal(after.status,'duplicate');
  recovered.retire_verified(after.ack_receipt);
  assert.equal(recovered.snapshot().lastAck,'1');
  recovered.close();
});

test('forged ACK identity, result status or checkpoint never retires durable row',async t=>{
  const cases=[
    e=>good_reply(e,'applied',{clientId:'client-b'}),
    e=>good_reply(e,'applied',{lastMutationId:'2'}),
    e=>good_reply(e,'applied',{results:[]}),
    e=>good_reply(e,'applied',{results:[{mutationId:'2',status:'applied'}]}),
    e=>good_reply(e,'impossible'),
    e=>good_reply(e,'duplicate',{results:[{mutationId:'1',status:'duplicate'}]}),
    e=>good_reply(e,'applied',{checkpoint:'07'}),
    e=>good_reply(e,'applied',{protocolVersion:2})
  ];
  for(const forged of cases){
    const {open}=mk(t,forged);
    const s=open();
    const receipt=s.stage_mutation(MUTATION);
    await assert.rejects(s.dispatch(receipt,'150'));
    assert.equal(s.snapshot().lastAck,'0');
    assert.equal(s.snapshot().pending.mutationId,'1');
    s.close();
  }
});

test('server rejection without ACK keeps pending and does not advance watermark',async t=>{
  const {open}=mk(t,()=>({status:409,json:{error:'MUTATION_ID_REUSED'}}));
  const s=open();
  const receipt=s.stage_mutation(MUTATION);
  assert.deepEqual(await s.dispatch(receipt,'150'),{kind:'not_acknowledged',status:409});
  assert.equal(s.snapshot().pending.mutationId,'1');
  assert.equal(s.snapshot().lastAck,'0');
  s.close();
});

test('real SQLite transaction fences old generation, including already-verified ACKs',async t=>{
  const {open}=mk(t);
  const old=open();
  const stage=old.stage_mutation(MUTATION);
  const ack=await old.dispatch(stage,'150');
  const next=open();
  assert.equal(next.snapshot().generation,'2');
  assert.throws(()=>old.snapshot(),/stale journal generation/);
  assert.throws(()=>old.retire_verified(ack.ack_receipt),/stale journal generation/);
  await assert.rejects(old.dispatch(stage,'155'),/stale journal generation/);
  const replay=await next.dispatch(next.recovered_stage_receipt(),'170');
  next.retire_verified(replay.ack_receipt);
  assert.equal(next.snapshot().lastAck,'1');
  old.close();
  next.close();
});

test('reentrant journal operations during untrusted transport await fail closed',async t=>{
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {open}=mk(t,async e=>{await gate;return good_reply(e);});
  const s=open();
  const receipt=s.stage_mutation(MUTATION);
  const inflight=s.dispatch(receipt,'150');
  assert.throws(()=>s.snapshot(),/reentrant/);
  assert.throws(()=>s.stage_mutation(MUTATION),/reentrant/);
  assert.throws(()=>s.close(),/cannot close journal during dispatch/);
  release();
  const result=await inflight;
  s.retire_verified(result.ack_receipt);
  assert.equal(s.snapshot().lastAck,'1');
  s.close();
});

test('malformed SQLite identity, schema, and noncanonical mutation values fail closed',t=>{
  const {path,open}=mk(t);
  const s=open();
  s.close();
  assert.throws(()=>open_sqlite_sync_journal(path,{...ID,tenant:'another'}),/tenant mismatch/);
  assert.throws(()=>open_sqlite_sync_journal(path,{...ID,client_id:'another'}),/client mismatch/);
  const db=new DatabaseSync(path);
  db.exec("UPDATE journal SET schema_version=2 WHERE singleton=1");
  db.close();
  assert.throws(()=>open(),/unsupported SQLite journal schema/);
});

test('noncanonical pending ID and signed-i64 exhaustion reject on reopen',t=>{
  const {path,open}=mk(t);
  const s=open();
  s.stage_mutation(MUTATION);
  s.close();
  const db=new DatabaseSync(path);
  db.prepare('UPDATE journal SET last_ack=? WHERE singleton=1').run('01');
  db.close();
  assert.throws(()=>open(),/canonical decimal/);
});

test('lastAck MAX_I64 fails closed before next-ID arithmetic',t=>{
  const {path,open}=mk(t);
  const s=open();
  s.close();
  const db=new DatabaseSync(path);
  db.prepare('UPDATE journal SET last_ack=? WHERE singleton=1').run('9223372036854775807');
  db.close();
  const next=open();
  assert.throws(()=>next.stage_mutation(MUTATION),/mutation ID exhausted/);
  assert.equal(next.snapshot().lastAck,'9223372036854775807');
  next.close();
});

test('database path symlink is denied without touching the target',t=>{
  const {dir,path,open}=mk(t);
  const s=open();
  s.close();
  const alias=join(dir,'alias.sqlite');
  symlinkSync(path,alias);
  assert.throws(()=>open_sqlite_sync_journal(alias,{...ID}),/regular file/);
  assert.equal(lstatSync(alias).isSymbolicLink(),true);
});

test('two-process crash after verified server ACK and before local retirement replays same ID',async t=>{
  const {path,open}=mk(t);
  const source=fileURLToPath(new URL('../sqlite_journal.host.mjs',import.meta.url));
  const child=`import {open_sqlite_sync_journal} from ${JSON.stringify(source)};
const j=open_sqlite_sync_journal(${JSON.stringify(path)},{tenant:'tenant-a',client_id:'client-a',
exchange: e => ({status:200,json:{protocolVersion:1,clientId:e.clientId,
 lastMutationId:e.mutations[0].mutationId,checkpoint:'7',
 results:[{mutationId:e.mutations[0].mutationId,status:'applied'}]}})});
const r=j.stage_mutation({record_id:'record-1',base_revision:'0',
 payload:{title:'alpha'},started_ms:'100',deadline_ms:'200'});
const response=await j.dispatch(r,'150');
if(response.kind!=='verified_response')process.exit(88);
process.exit(27); // real separate process exited before local SQLite retirement
`;
  const exited=spawnSync(process.execPath,['--input-type=module','-e',child],{
    encoding:'utf8',timeout:30000,env:{...process.env,NODE_NO_WARNINGS:'1'}});
  assert.equal(exited.status,27,exited.stderr);
  const restarted=open(e=>good_reply(e,'duplicate'));
  assert.equal(restarted.snapshot().generation,'2');
  assert.equal(restarted.snapshot().pending.mutationId,'1');
  assert.equal(restarted.snapshot().lastAck,'0');
  const response=await restarted.dispatch(restarted.recovered_stage_receipt(),'160');
  assert.equal(response.status,'duplicate');
  const done=restarted.retire_verified(response.ack_receipt);
  assert.equal(done.lastAck,'1');
  restarted.close();
  const verify=open();
  assert.equal(verify.snapshot().pending,null);
  assert.equal(verify.snapshot().lastAck,'1');
  verify.close();
});

test('supervisor generation acquired by separate process immediately fences the old owner',async t=>{
  const {path,open}=mk(t);
  const old=open();
  const stage=old.stage_mutation(MUTATION);
  const source=fileURLToPath(new URL('../sqlite_journal.host.mjs',import.meta.url));
  const child=`import {open_sqlite_sync_journal} from ${JSON.stringify(source)};
const j=open_sqlite_sync_journal(${JSON.stringify(path)},{tenant:'tenant-a',client_id:'client-a'});
if(j.snapshot().generation!=='2') process.exit(9);
j.close();
`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',child],{
    encoding:'utf8',timeout:30000,env:{...process.env,NODE_NO_WARNINGS:'1'}});
  assert.equal(result.status,0,result.stderr);
  assert.throws(()=>old.stage_mutation(MUTATION),/stale journal generation/);
  await assert.rejects(old.dispatch(stage,'150'),/stale journal generation/);
  old.close();
});
