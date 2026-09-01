// run with: node static/history_store_test.js
// H1T3 HistoryStore contract – cap 5, push, length, deltas.availableDelta negative
class HistoryStore {
  constructor(cap=450){ this.cap=cap; this.items=[]; }
  push(envelope){ this.items.push({at: Date.now(), envelope}); if(this.items.length>this.cap) this.items.shift(); }
  get length(){ return this.items.length; }
  latest(){ return this.items[this.items.length-1]?.envelope || null; }
  at(i){ return this.items[i]?.envelope || null; }
  deltas(){
    if(this.items.length<2) return null;
    const a=this.items[this.items.length-2].envelope.data||this.items[this.items.length-2].envelope;
    const b=this.items[this.items.length-1].envelope.data||this.items[this.items.length-1].envelope;
    const aMem=a.Memory||{}, bMem=b.Memory||{};
    return {
      availableDelta:(bMem.AvailableBytes||0)-(aMem.AvailableBytes||0),
      inUseDelta:(bMem.InUseBytes||0)-(aMem.InUseBytes||0),
      poolDelta:(bMem.NonpagedPoolBytes||0)-(aMem.NonpagedPoolBytes||0)
    };
  }
}
function assert(cond, msg){ if(!cond){ console.error('FAIL:',msg); process.exit(1); } }

const h = new HistoryStore(5);
h.push({capturedAt: new Date().toISOString(), data:{Memory:{VisiblePhysicalBytes:100, AvailableBytes:40, InUseBytes:60, NonpagedPoolBytes:10}}});
assert(h.length===1, 'push length 1');
h.push({capturedAt: new Date().toISOString(), data:{Memory:{VisiblePhysicalBytes:100, AvailableBytes:30, InUseBytes:65, NonpagedPoolBytes:12}}});
assert(h.length===2, 'push length 2');
const d = h.deltas();
assert(d!==null, 'deltas not null');
assert(d.availableDelta < 0, 'availableDelta negative: '+d.availableDelta);
assert(d.inUseDelta === 5, 'inUseDelta 5');
assert(d.poolDelta === 2, 'poolDelta 2');
// cap test
const h2 = new HistoryStore(5);
for(let i=0;i<7;i++) h2.push({capturedAt: new Date().toISOString(), data:{Memory:{AvailableBytes:i}}});
assert(h2.length===5, 'cap 5');
assert(h2.at(0).data.Memory.AvailableBytes===2, 'cap shift');
assert(typeof h2.latest()==='object', 'latest');
console.log('history_store_test: all assertions passed');
process.exit(0);
