// static/evidence_test.js — H5aT1 contract: formatDelta, confidence, deltasExtended
const mod = require('./app.js');
const { HistoryStore } = mod;
const formatDelta = mod.formatDelta || (typeof window !== 'undefined' ? window.formatDelta : null);
const confidenceForSampleCount = mod.confidenceForSampleCount || (typeof window !== 'undefined' ? window.confidenceForSampleCount : null);

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
}

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// formatDelta(0.7GB) -> "+0.70 GB"
assert(typeof formatDelta === 'function', 'formatDelta missing');
let fd = formatDelta(0.7 * GB);
assert(fd === '+0.70 GB', 'formatDelta(0.7GB) expected "+0.70 GB" got "' + fd + '"');

// negative MB
let fdNeg = formatDelta(-220 * MB);
assert(fdNeg === '-220 MB' || fdNeg === '−220 MB', 'formatDelta(-220MB) got "' + fdNeg + '"');

// zero -> ±0 GB or 0 variant
let fdZero = formatDelta(0);
assert(fdZero === '±0 GB' || fdZero === '±0.00 GB' || fdZero === '+0 GB' || fdZero === '0 GB', 'formatDelta(0) got "' + fdZero + '"');

// confidenceForSampleCount
assert(typeof confidenceForSampleCount === 'function', 'confidenceForSampleCount missing');
let c1 = confidenceForSampleCount(1);
assert(c1.label === 'Low' && c1.class === 'confidence-low', 'confidence 1 expected Low/confidence-low got ' + JSON.stringify(c1));
assert(typeof c1.elapsedSec === 'number', 'confidence missing elapsedSec for 1');
let c10 = confidenceForSampleCount(10);
assert(c10.label === 'Med' && c10.class === 'confidence-med', 'confidence 10 expected Med/confidence-med got ' + JSON.stringify(c10));
let c30 = confidenceForSampleCount(30);
assert(c30.label === 'High' && c30.class === 'confidence-high', 'confidence 30 expected High/confidence-high got ' + JSON.stringify(c30));

// deltasExtended on 2-item store returns availableDelta
assert(typeof HistoryStore === 'function', 'HistoryStore missing');
let store = new HistoryStore(10);
assert(typeof store.deltasExtended === 'function', 'HistoryStore.deltasExtended missing');
let env1 = { data: { Memory: { AvailableBytes: 6.8 * GB, InUseBytes: 4 * GB, NonpagedPoolBytes: 200 * MB, StandbyBytes: 1 * GB, ModifiedBytes: 100 * MB } } };
let env2 = { data: { Memory: { AvailableBytes: 6.1 * GB, InUseBytes: 4.5 * GB, NonpagedPoolBytes: 250 * MB, StandbyBytes: 0.9 * GB, ModifiedBytes: 110 * MB } } };
store.push(env1);
store.push(env2);
let d = store.deltasExtended();
assert(d !== null, 'deltasExtended returned null for 2 items');
assert(typeof d.availableDelta === 'number', 'deltasExtended missing availableDelta');
let expectedAvail = 6.1 * GB - 6.8 * GB;
assert(Math.abs(d.availableDelta - expectedAvail) < 1, 'availableDelta mismatch: got ' + d.availableDelta + ' expected ' + expectedAvail);
assert(typeof d.inUseDelta === 'number', 'missing inUseDelta');
assert(typeof d.poolDelta === 'number', 'missing poolDelta');
assert(typeof d.standbyDelta === 'number', 'missing standbyDelta');
assert(typeof d.modifiedDelta === 'number', 'missing modifiedDelta');

// window exposure check (when run in browser-like env, window may be undefined in Node)
if (typeof window !== 'undefined') {
  assert(typeof window.formatDelta === 'function', 'window.formatDelta missing');
  assert(typeof window.confidenceForSampleCount === 'function', 'window.confidenceForSampleCount missing');
}

console.log('evidence_test PASS');
