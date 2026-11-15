// HOST-ONLY bounded model. This is NOT compiled AttoLang guest execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const MAX = (1n << 63n) - 1n;
const valid_resume = (active,observed,local,claimed,scope,committed) =>
  active > 0n && active === observed && local >= 0n &&
  claimed === local && scope && committed;
const valid_change = (active,observed,local,prior,next,scope,authoritative) =>
  active > 0n && active === observed && scope && authoritative &&
  local >= 0n && prior === local && next > prior && next <= MAX;
const valid_rotation = (oldGen,newGen,reset,scope,committed) =>
  oldGen > 0n && oldGen < MAX && newGen > oldGen && newGen <= MAX &&
  reset === 0n && scope && committed;

test('AttoLang source defines pure, fenced checkpoint entry points', () => {
  const source = readFileSync(new URL('../src/checkpoint_policy.atto',import.meta.url),'utf8');
  for (const symbol of ['define pub module checkpoint_policy',
    'pub fnc valid_resume(', 'pub fnc valid_change(', 'pub fnc valid_rotation(',
    'observed_checkpoint == local_checkpoint',
    'previous_checkpoint == local_checkpoint',
    'new_generation > old_generation',
    'reset_checkpoint == 0',
    'next_checkpoint <= 9223372036854775807']) {
    assert.ok(source.includes(symbol), 'missing AttoLang policy anchor: '+symbol);
  }
  assert.doesNotMatch(source,/\bawait\b|\bspawn\b|\bcritical-write\b/);
});

test('bounded resume/transition space rejects stale generation, scope and replay', () => {
  let admitted = 0, rejected = 0;
  for (let active=0n;active<=3n;active++)
    for (let observed=0n;observed<=3n;observed++)
      for (let local=0n;local<=3n;local++)
        for (let previous=0n;previous<=3n;previous++)
          for (let next=0n;next<=5n;next++)
            for (const scope of [false,true])
              for (const authoritative of [false,true]) {
                const ok=valid_change(active,observed,local,previous,next,scope,authoritative);
                if (ok) {
                  admitted++;
                  assert.equal(active,observed);
                  assert.ok(active>0n && scope && authoritative);
                  assert.equal(previous,local);
                  assert.ok(next>local);
                } else rejected++;
              }
  assert.ok(admitted>0 && rejected>admitted);
  assert.equal(valid_change(1n,1n,2n,2n,4n,true,true),true,
    'filtered projections may legitimately skip global revisions');
  assert.equal(valid_change(1n,1n,MAX-1n,MAX-1n,MAX,true,true),true);
  assert.equal(valid_change(1n,1n,MAX,MAX,MAX+1n,true,true),false);
});

test('resumes and rotations require committed scoped evidence and fresh cursors', () => {
  assert.ok(valid_resume(2n,2n,10n,10n,true,true));
  for (const value of [
    [2n,1n,10n,10n,true,true],
    [2n,2n,10n,11n,true,true],
    [2n,2n,10n,10n,false,true],
    [2n,2n,10n,10n,true,false],
    [0n,0n,10n,10n,true,true]
  ]) assert.equal(valid_resume(...value),false);
  assert.ok(valid_rotation(2n,3n,0n,true,true));
  for (const value of [
    [2n,2n,0n,true,true], [2n,3n,10n,true,true],
    [2n,3n,0n,false,true], [2n,3n,0n,true,false],
    [MAX,MAX+1n,0n,true,true]
  ]) assert.equal(valid_rotation(...value),false);
});
