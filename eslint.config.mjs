// ores-lint house config for opto-sync-clients (10 JS packages, 9 crates).
//
// This repo publishes client SDKs in several languages against one shared
// conformance suite, so the conformance fixtures must not be linted as source.
import oresConfig from './.ores-lint/eslint/base.mjs';

export default await oresConfig({
  ignores: [
    'conformance/**/fixtures/**',
    '_apalache-out/**',       // model-checker output
    'adoption/**',
    'clients/**/dist/**',
  ],
  rules: {
    // Published SDKs: an accidental console write shows up in a consumer's logs.
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
});
