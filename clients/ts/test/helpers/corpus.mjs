/**
 * A merge corpus shared by the native/wasm parity test and the real-browser
 * test, so both tiers are held to the exact same inputs.
 *
 * Each entry is [name, baseJson, incomingJson, options]. Options use the
 * camelCase names both engines accept; `undefined` means "send no options at
 * all", which is itself a case worth covering (the core's own defaults differ
 * from the client's).
 */
export const MERGE_CORPUS = [
  ['plain deep merge', '{"a":1,"b":{"c":2}}', '{"b":{"d":3}}', undefined],
  ['no options at all', '{"a":[1,2],"n":1}', '{"a":[3],"n":2}', undefined],
  ['empty objects', '{}', '{}', undefined],
  ['root scalar replace', '{"a":1}', '{"a":"str"}', undefined],
  ['null handling', '{"a":1,"b":null}', '{"a":null,"c":null}', undefined],

  ['REPLACE', '{"a":[1,2,3]}', '{"a":[9]}', { arrayStrategy: 0 }],
  ['APPEND', '{"a":[1,2]}', '{"a":[2,3]}', { arrayStrategy: 1 }],
  ['UNION', '{"a":[1,2]}', '{"a":[2,3]}', { arrayStrategy: 2 }],
  [
    'UNION structural dedup, keys reordered',
    '{"arr":[{"id":1,"meta":{"a":1,"b":[1,2]},"z":true}]}',
    '{"arr":[{"z":true,"meta":{"b":[1,2],"a":1},"id":1}]}',
    { arrayStrategy: 2 },
  ],
  ['UNION order is significant', '{"arr":[[1,2]]}', '{"arr":[[2,1]]}', { arrayStrategy: 2 }],
  [
    'MERGE_BY_INDEX',
    '{"a":[{"x":1,"y":1},{"x":2}]}',
    '{"a":[{"y":9}]}',
    { arrayStrategy: 3 },
  ],
  [
    'MERGE_BY_KEY: merge, keep, append',
    '{"items":[{"id":1,"name":"alpha","qty":5},{"id":2,"name":"beta"}]}',
    '{"items":[{"id":1,"qty":7},{"id":3,"name":"gamma"}]}',
    { arrayStrategy: 4 },
  ],
  [
    'MERGE_BY_KEY: id 42 matches "42"',
    '{"rows":[{"id":42,"v":"old"}]}',
    '{"rows":[{"id":"42","v":"new"}]}',
    { arrayStrategy: 4 },
  ],
  [
    'MERGE_BY_KEY: id-less elements get UNION semantics',
    '{"arr":[1,{"note":"free"},{"id":1,"v":"a"}]}',
    '{"arr":[1,2,{"note":"free"},{"id":1,"v":"b"}]}',
    { arrayStrategy: 4 },
  ],
  [
    'arrayMatchKeys uuid,id',
    '{"rows":[{"uuid":"u-1","v":1},{"id":7,"v":2}]}',
    '{"rows":[{"uuid":"u-1","v":10},{"id":7,"v":20}]}',
    { arrayStrategy: 4, arrayMatchKeys: 'uuid,id' },
  ],
  [
    'per-element LWW with reordered elements',
    '{"rows":[{"id":"a","updatedAt":200,"val":"base-a"},{"id":"b","updatedAt":100,"val":"base-b"}]}',
    '{"rows":[{"id":"b","updatedAt":150,"val":"new-b"},{"id":"a","updatedAt":100,"val":"stale-a"}]}',
    { arrayStrategy: 4, resolveByTimestamp: true, lwwKeys: 'updatedAt,syncedAt' },
  ],
  [
    'fwwKeys createdAt',
    '{"rows":[{"id":1,"createdAt":100,"who":"original"}]}',
    '{"rows":[{"id":1,"createdAt":300,"who":"impostor"}]}',
    { arrayStrategy: 4, resolveByTimestamp: true, fwwKeys: 'createdAt' },
  ],
  [
    'digit-string timestamps compare by magnitude',
    '{"updatedAt":"10","val":"base"}',
    '{"updatedAt":"9","val":"stale"}',
    { resolveByTimestamp: true, lwwKeys: 'updatedAt' },
  ],
  [
    'int64 nanosecond timestamps differ in last digit',
    '{"doc":{"updatedAt":1689940800123456789,"val":"base"}}',
    '{"doc":{"updatedAt":1689940800123456788,"val":"stale"}}',
    { resolveByTimestamp: true, lwwKeys: 'updatedAt' },
  ],
  [
    'negative timestamps',
    '{"doc":{"updatedAt":-50,"val":"base"}}',
    '{"doc":{"updatedAt":-100,"val":"stale"}}',
    { resolveByTimestamp: true, lwwKeys: 'updatedAt' },
  ],
  [
    'lwwKeys explicitly empty (NOT the same as absent)',
    '{"updatedAt":200,"val":"base"}',
    '{"updatedAt":100,"val":"stale"}',
    { resolveByTimestamp: true, lwwKeys: '' },
  ],
  [
    'lwwKeys absent falls back to the core default',
    '{"updatedAt":200,"val":"base"}',
    '{"updatedAt":100,"val":"stale"}',
    { resolveByTimestamp: true },
  ],
  ['maxDepth 1', '{"a":{"b":1,"c":2}}', '{"a":{"b":9}}', { maxDepth: 1 }],
  ['maxDepth 0 = unlimited', '{"a":{"b":1,"c":2}}', '{"a":{"b":9}}', { maxDepth: 0 }],
  ['detectCircularRefs on', '{"a":{"b":1}}', '{"a":{"c":2}}', { detectCircularRefs: true }],

  [
    'unicode keys, escapes and dotted keys',
    '{"héllo":{"wörld":1},"a.b":{"c":1},"q\\"k":1}',
    '{"héllo":{"wörld":2,"日本":3},"a.b":{"d":4},"q\\"k":9}',
    undefined,
  ],
  [
    'unicode identity values under MERGE_BY_KEY',
    '{"a":[{"id":"ключ","v":1}]}',
    '{"a":[{"id":"ключ","v":2}]}',
    { arrayStrategy: 4 },
  ],
  ['astral-plane values', '{"x":"old"}', '{"x":"👨‍👩‍👧‍👦🧬"}', undefined],
  [
    'large integers emitted verbatim',
    '{"a":1}',
    '{"big":9007199254740993,"neg":-9223372036854775807}',
    undefined,
  ],
  ['floats', '{"f":1.5}', '{"f":2.25,"g":1e-7}', undefined],

  ['invalid base JSON', '{oops', '{}', undefined],
  ['invalid incoming JSON', '{}', '{oops', undefined],
  ['empty string base', '', '{"a":1}', undefined],

  [
    // NOTE: no fwwKeys — that IS the client default policy (see
    // DEFAULT_RECONCILE_OPTIONS). FWW is a node-level veto, so it is opt-in.
    'the client default policy',
    '{"id":"d1","updatedAt":300,"rows":[{"id":"r1","label":"local-only"},{"id":"r2","updatedAt":9000,"label":"fresh local"}],"createdAt":100}',
    '{"id":"d1","updatedAt":100,"rows":[{"id":"r2","updatedAt":1,"label":"stale server"}],"createdAt":50}',
    {
      arrayStrategy: 4,
      arrayMatchKeys: 'id',
      resolveByTimestamp: true,
      lwwKeys: 'updatedAt,syncedAt',
    },
  ],
  [
    // The veto the default policy exists to avoid: a newer createdAt sinks the
    // whole node even though updatedAt says it is the newest write anywhere.
    'fwwKeys vetoes a node whose LWW key is newest',
    '{"doc":{"createdAt":100,"updatedAt":100,"v":"base"}}',
    '{"doc":{"createdAt":200,"updatedAt":999999,"v":"NEWEST WRITE"}}',
    { resolveByTimestamp: true, lwwKeys: 'updatedAt,syncedAt', fwwKeys: 'createdAt' },
  ],
  [
    'same inputs under the default policy (no fwwKeys): newest write lands',
    '{"doc":{"createdAt":100,"updatedAt":100,"v":"base"}}',
    '{"doc":{"createdAt":200,"updatedAt":999999,"v":"NEWEST WRITE"}}',
    { resolveByTimestamp: true, lwwKeys: 'updatedAt,syncedAt' },
  ],
];

/**
 * The reconcile-level scenarios, expressed as plain objects so they can be run
 * through reconcileIncoming() on any tier (native, wasm-in-Node, wasm-in-
 * Chromium) and compared.
 *
 * Each entry is [name, localPayload, incomingPayload, options].
 */
export const RECONCILE_SCENARIOS = [
  [
    'stale incoming record rejected by updatedAt (LWW)',
    { id: 'r1', title: 'edited locally', updatedAt: 2000 },
    { id: 'r1', title: 'stale server copy', updatedAt: 1000 },
    undefined,
  ],
  [
    'fresh incoming record accepted, untouched local field survives',
    { id: 'r1', title: 'old local', views: 7, updatedAt: 1000 },
    { id: 'r1', title: 'newer from server', updatedAt: 2000 },
    undefined,
  ],
  [
    'syncedAt participates in LWW',
    { v: 'local', syncedAt: 500 },
    { v: 'server', syncedAt: 400 },
    undefined,
  ],
  [
    // Explicit options: `createdAt` is NOT in the client default policy, so
    // relying on `undefined` here would silently stop covering FWW.
    'explicit fwwKeys rejects a later claimed creation',
    { id: 1, createdAt: 100, author: 'original' },
    { id: 1, createdAt: 300, author: 'impostor' },
    { fwwKeys: 'createdAt' },
  ],
  [
    'default policy accepts a newer write that carries a later createdAt',
    { doc: { createdAt: 100, updatedAt: 100, v: 'base' } },
    { doc: { createdAt: 200, updatedAt: 999999, v: 'NEWEST WRITE' } },
    undefined,
  ],
  [
    'default strategy protects local array elements the server never saw',
    {
      rows: [
        { id: 'r1', label: 'local-only' },
        { id: 'r2', updatedAt: 9000, label: 'fresh local edit' },
      ],
    },
    { rows: [{ id: 'r2', updatedAt: 1, label: 'stale server copy' }] },
    undefined,
  ],
  [
    'mergeByKey arrays with per-element LWW and reordering',
    {
      items: [
        { id: 1, name: 'alpha', qty: 5, updatedAt: 200 },
        { id: 2, name: 'beta', updatedAt: 100 },
      ],
    },
    {
      items: [
        { id: 2, name: 'beta-renamed', updatedAt: 150 },
        { id: 1, name: 'stale-alpha', updatedAt: 50 },
        { id: 3, name: 'gamma', updatedAt: 400 },
      ],
    },
    { arrayStrategy: 4 },
  ],
  [
    'custom arrayMatchKeys',
    { rows: [{ uuid: 'u-1', v: 1 }, { id: 7, v: 2 }] },
    { rows: [{ uuid: 'u-1', v: 10 }, { id: 7, v: 20 }] },
    { arrayStrategy: 4, arrayMatchKeys: 'uuid,id', resolveByTimestamp: false },
  ],
  [
    'numeric/string id normalization',
    { rows: [{ id: 42, v: 'old' }] },
    { rows: [{ id: '42', v: 'new' }] },
    { arrayStrategy: 4, resolveByTimestamp: false },
  ],
  [
    'UNION reachable through options',
    { tags: ['a', 'b'] },
    { tags: ['b', 'c'] },
    { arrayStrategy: 2, resolveByTimestamp: false },
  ],
  [
    'REPLACE stays opt-in-able',
    { tags: ['a', 'b'] },
    { tags: ['c'] },
    { arrayStrategy: 0, resolveByTimestamp: false },
  ],
  [
    'default unions scalar arrays (idempotent resync)',
    { tags: ['a', 'b'] },
    { tags: ['b', 'c'] },
    { resolveByTimestamp: false },
  ],
  [
    'unicode payloads survive the round trip',
    { title: 'héllo wörld', tags: ['日本'], updatedAt: 1 },
    { title: 'ключ 👨‍👩‍👧‍👦', tags: ['🧬'], updatedAt: 2 },
    undefined,
  ],
  [
    // Nanosecond epochs have to travel as digit-strings to survive JS numbers
    // at all; the engine still has to compare them by magnitude, not strcmp.
    'digit-string nanosecond timestamps compare by magnitude',
    { doc: { updatedAt: '1689940800123456789', val: 'base' } },
    { doc: { updatedAt: '1689940800123456788', val: 'stale' } },
    undefined,
  ],
];
