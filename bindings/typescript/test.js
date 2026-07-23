const addon = require('./build/Release/syncer.node');

const j1 = '{"a": 1, "b": {"c": 2}, "override": "no"}';
const j2 = '{"b": {"d": 3}, "override": "yes"}';

const result = addon.mergeJson(j1, j2, (key, v1, v2) => {
    if (key === 'override') {
        return '{"custom": "merged from JS!"}';
    }
    return undefined; // Return undefined to fallback to C default logic
});

console.log("Testing JS Node-API Binding to syncer.c:");
console.log("Merged:", result);
