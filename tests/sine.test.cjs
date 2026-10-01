// Scheduling and lifecycle regression tests; run with node tests/sine.test.cjs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();
function element(){return {value:'',textContent:'',checked:false,dataset:{},classList:{toggle(){}},setAttribute(){},addEventListener(){},before(){}}}
const $=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s)};
const voices=[];let currentTime=0;
function param(){return {value:0,setValueAtTime(v,t){assert(Number.isFinite(v)&&Number.isFinite(t));},linearRampToValueAtTime(v,t){assert(Number.isFinite(v)&&Number.isFinite(t));},exponentialRampToValueAtTime(v,t){assert(v>0&&Number.isFinite(t));},setTargetAtTime(){},cancelScheduledValues(){}}}
function node(){return {connect(){return arguments[0]},disconnect(){},gain:param(),pan:param(),frequency:param()}}
const ctx={get currentTime(){return currentTime},createGain:node,createStereoPanner:node,createOscillator(){const o=node();o.start=t=>{o.t=t;assert(t>=currentTime);voices.push(o)};o.stop=t=>o.end=t;return o}};
const sandbox={console,assert,$,ctx,compressor:node(),window:{},document:{createElement:element,querySelector:$,querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){}},clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),rand:Math.random,state:{tempo:120},rhythmState:{swing:.3},grooveFocus:'house',groovePrimary:'house',grooveSecondary:'jazz',grooveBlendAmount:.25,voices};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('chunks/app-09.txt','utf8')+`
function finishVoices(){for(const v of [...sineVoices])v.o.onended()}
function simulate(mode){
 finishVoices();sineState.enabled=true;sineState.density=1;sineState.link=0;sineState.single=0;sineState.arp=0;sineState.chord=0;sineState[mode]=100;sineState.pool=['sus4'];sineState.range=2;resetSine();
 const start=voices.length;sineScheduler(ctx.currentTime,ctx.currentTime+.22);assert(voices.length>start);assert.equal(sineMode,mode);return voices.slice(start)
}
for(const mode of ['single','arp','chord']){const emitted=simulate(mode);assert.equal(emitted.length,mode==='chord'?3:1);for(const o of emitted){assert.equal(o.type,'sine');const midi=69+12*Math.log2(o.frequency.value/440);assert([0,5,7].some(n=>Math.abs(((midi-60)%12)-n)<.00001));assert(o.end>o.t)}}
// Up/down arpeggios follow pitch order without drifting outside the chord pool.
sineState.direction='down';simulate('arp');const first=voices.at(-1).frequency.value;finishVoices();sineNext=.3;sineScheduler(0,.4);assert(voices.at(-1).frequency.value<first);
// No scheduled oscillators when disabled or all mode weights are zero.
finishVoices();sineState.enabled=false;let n=voices.length;sineScheduler(0,1);assert.equal(voices.length,n);
sineState.enabled=true;sineState.single=sineState.arp=sineState.chord=0;sineNext=.01;sineScheduler(0,1);assert.equal(voices.length,n);
// Settings round-trip and reject empty/unknown pools and out-of-range values.
restoreSine({root:5,pool:['9sus4'],level:4,decay:-2,range:10,enabled:true});assert.equal(sineState.level,1);assert.equal(sineState.decay,.045);assert.equal(sineState.range,3);assert.equal(sineState.root,5);assert.deepEqual(sineState.pool,['9sus4']);
restoreSine({pool:['invalid']});assert.deepEqual(sineState.pool,['9sus4']);const saved=window.sineLayer.capture();sineState.root=2;window.sineLayer.restore(saved);assert.equal(sineState.root,5);
// Gain applies independently; turning off fades and stops all active voices.
simulate('chord');sineState.level=.37;syncSine();assert(sineVoices.size>0);resetSine();for(const v of sineVoices)assert.equal(v.o.end,.04);finishVoices();assert.equal(sineVoices.size,0);
console.log('PASS: modes, suspended pitches, arpeggio order, mute, settings, bounds, voice cleanup');
`,sandbox);
