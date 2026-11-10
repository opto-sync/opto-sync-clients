// HOST-ONLY independent model for the AttoLang actor candidate.
// It never invokes an AttoLang compiler; these are NON-PROMOTING checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const MAX_I64 = (1n << 63n) - 1n;
const Phase = Object.freeze({idle:0, stage_fsync:1, ready:2, inflight:3, retire_fsync:4});
const policy = {
  valid_next_id(lastAck, nextId, pending) {
    return !pending && lastAck >= 0n && lastAck < MAX_I64 &&
      nextId > 0n && nextId === lastAck + 1n;
  },
  valid_generation(observed, current, claim) {
    return current > 0n && observed === current && claim === current;
  },
  within_retry(start, deadline, now) {
    return start >= 0n && deadline > start && now >= start && now < deadline;
  },
  may_send(s, now) {
    return s.phase === Phase.ready &&
      policy.valid_next_id(s.lastAck,s.pendingId,false) &&
      policy.within_retry(s.started,s.deadline,now);
  },
  valid_ack(s, ack) {
    return s.phase === Phase.inflight && s.pendingId > 0n &&
      ack.mutationId === s.pendingId &&
      policy.valid_generation(ack.observedGen,s.generation,ack.claimedGen) &&
      ack.tenantOk && ack.clientOk && ack.serverDurable;
  },
  may_retire(s, storageGen, fsynced) {
    return s.phase === Phase.retire_fsync && s.generation > 0n &&
      storageGen === s.generation && fsynced &&
      policy.valid_next_id(s.lastAck,s.pendingId,false);
  },
};
const initial = (generation=1n,lastAck=0n) => ({
  generation,lastAck,pendingId:0n,phase:Phase.idle,started:0n,deadline:0n
});
const decline = s => ({accepted:false,state:s});
const accept = state => ({accepted:true,state});
function reserve(s,gen,id,start,deadline) {
  if (s.phase !== Phase.idle ||
      !policy.valid_generation(gen,s.generation,gen) ||
      !policy.valid_next_id(s.lastAck,id,false) ||
      start < 0n || deadline <= start) return decline(s);
  return accept({...s,phase:Phase.stage_fsync,pendingId:id,started:start,deadline});
}
function fsyncStage(s,gen,id,verified) {
  if (!verified || s.phase !== Phase.stage_fsync ||
      gen !== s.generation || id !== s.pendingId) return decline(s);
  return accept({...s,phase:Phase.ready});
}
function dispatch(s,gen,now) {
  if (gen !== s.generation || !policy.may_send(s,now)) return decline(s);
  return accept({...s,phase:Phase.inflight});
}
function unknown(s,gen,id) {
  if (s.phase !== Phase.inflight || gen !== s.generation ||
      id !== s.pendingId) return decline(s);
  return accept({...s,phase:Phase.ready});
}
function ack(s,a) {
  if (!policy.valid_ack(s,a)) return decline(s);
  return accept({...s,phase:Phase.retire_fsync});
}
function retire(s,gen,fsynced) {
  if (!policy.may_retire(s,gen,fsynced)) return decline(s);
  return accept({...s,phase:Phase.idle,lastAck:s.pendingId,
    pendingId:0n,started:0n,deadline:0n});
}
const goodAck = (mutationId=1n,generation=1n) => ({
  mutationId,observedGen:generation,claimedGen:generation,
  tenantOk:true,clientOk:true,serverDurable:true
});

test('actor source owns a sealed state and gates all writes behind critical-write',()=>{
  const src = readFileSync(new URL('../src/durable_sync_actor.ores',import.meta.url),'utf8');
  const policySource = readFileSync(new URL('../src/sync_actor_policy.ores',import.meta.url),'utf8');
  const guest = readFileSync(new URL('./sync_actor_policy_contract.ores',import.meta.url),'utf8');
  assert.match(src,/define actor DurableSyncActor as\s+state\s*\{/);
  assert.equal((src.match(/self\.handle_state\(critical-write \|s\|/g)||[]).length,6);
  assert.doesNotMatch(src,/\bawait\b[^\n]*self\.handle_state/);
  assert.match(src,/s\.last_ack = s\.pending_id;/);
  assert.match(src,/s\.phase = 4;/);
  assert.match(policySource,/pub fnc may_publish_retirement/);
  assert.match(guest,/import module sync_actor_policy/);
  assert.match(guest,/return 0;/);
});

test('cannot send before journal durability, even after stage reservation',()=>{
  const s0=initial();
  const staged=reserve(s0,1n,1n,100n,200n);
  assert.equal(staged.accepted,true);
  assert.equal(staged.state.phase,Phase.stage_fsync);
  assert.equal(policy.may_send(staged.state,150n),false);
  assert.equal(dispatch(staged.state,1n,150n).accepted,false);
  assert.equal(fsyncStage(staged.state,1n,1n,false).accepted,false);
  assert.equal(fsyncStage(staged.state,2n,1n,true).accepted,false);
  const ready=fsyncStage(staged.state,1n,1n,true);
  assert.equal(ready.accepted,true);
  assert.equal(dispatch(ready.state,1n,150n).accepted,true);
});

test('loss of HTTP response never retires pending work or resets deadline',()=>{
  let s=fsyncStage(reserve(initial(),1n,1n,100n,200n).state,1n,1n,true).state;
  s=dispatch(s,1n,150n).state;
  s=unknown(s,1n,1n).state;
  assert.equal(s.lastAck,0n);
  assert.equal(s.pendingId,1n);
  assert.equal(s.started,100n);
  assert.equal(s.deadline,200n);
  assert.equal(reserve(s,1n,2n,160n,300n).accepted,false);
  assert.equal(dispatch(s,1n,200n).accepted,false);
  assert.equal(dispatch(s,1n,199n).accepted,true);
});

test('forged scoped ACKs preserve in-flight journal identity',()=>{
  let s=fsyncStage(reserve(initial(3n),3n,1n,10n,99n).state,3n,1n,true).state;
  s=dispatch(s,3n,11n).state;
  const valid=goodAck(1n,3n);
  for(const forged of [
    {...valid,mutationId:2n},{...valid,observedGen:2n},
    {...valid,claimedGen:4n},{...valid,tenantOk:false},
    {...valid,clientOk:false},{...valid,serverDurable:false}
  ]) {
    const attempt=ack(s,forged);
    assert.equal(attempt.accepted,false);
    assert.deepEqual(attempt.state,s);
  }
  const accepted=ack(s,valid);
  assert.equal(accepted.state.phase,Phase.retire_fsync);
  assert.equal(accepted.state.pendingId,1n);
  assert.equal(accepted.state.lastAck,0n);
});

test('post-ACK crash before local fsync replays identical mutation',()=>{
  let s=fsyncStage(reserve(initial(),1n,1n,0n,100n).state,1n,1n,true).state;
  s=dispatch(s,1n,1n).state;
  s=ack(s,goodAck()).state;
  assert.equal(retire(s,1n,false).accepted,false);
  assert.equal(retire(s,2n,true).accepted,false);
  // Durable journal still has pending=1 and lastAck=0. Supervisor restarts
  // with a new fenced generation and a verified copy of the same journal.
  const recovered={...s,generation:2n,phase:Phase.ready};
  assert.equal(policy.may_send(recovered,2n),true);
  assert.equal(ack({...recovered,phase:Phase.inflight},goodAck(1n,1n)).accepted,false);
  const replay=dispatch(recovered,2n,2n).state;
  const duplicate=ack(replay,goodAck(1n,2n));
  assert.equal(duplicate.accepted,true);
  const durable=retire(duplicate.state,2n,true);
  assert.equal(durable.accepted,true);
  assert.equal(durable.state.lastAck,1n);
  assert.equal(durable.state.pendingId,0n);
});

test('sequential IDs do not overflow signed i64; duplicate stage is blocked',()=>{
  assert.equal(policy.valid_next_id(MAX_I64,MAX_I64,false),false);
  assert.equal(policy.valid_next_id(MAX_I64,0n,false),false);
  assert.equal(policy.valid_next_id(MAX_I64-1n,MAX_I64,false),true);
  assert.equal(policy.valid_next_id(0n,1n,true),false);
  assert.equal(reserve(initial(2n,MAX_I64),2n,0n,1n,2n).accepted,false);
  let s=reserve(initial(),1n,1n,0n,20n).state;
  assert.equal(reserve(s,1n,1n,0n,20n).accepted,false);
  assert.equal(reserve(s,1n,2n,0n,20n).accepted,false);
});

test('exhaustive bounded admission safety for phases, generations, and identities',()=>{
  let checks=0;
  for (let phase=0;phase<=4;phase++)
    for(let last=0n;last<=2n;last++)
      for(let pending=0n;pending<=4n;pending++)
        for(let gen=1n;gen<=2n;gen++) {
          const s={...initial(gen,last),phase,pendingId:pending,started:10n,deadline:20n};
          const send=policy.may_send(s,11n);
          if(send) {
            assert.equal(phase,Phase.ready);
            assert.equal(pending,last+1n);
            assert.ok(pending>0n);
          }
          for(let storage=0n;storage<=3n;storage++){
            const can=policy.may_retire(s,storage,true);
            if(can){
              assert.equal(phase,Phase.retire_fsync);
              assert.equal(storage,gen);
              assert.equal(pending,last+1n);
            }
            checks++;
          }
        }
  assert.ok(checks>=300);
});
