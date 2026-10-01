// Scheduling and lifecycle regression tests; run with node tests/sine.test.cjs.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();
function element(){return {value:'',textContent:'',checked:false,dataset:{},classList:{toggle(){},add(){}},closest(){return null},setAttribute(){},addEventListener(){},before(){}}}
const $=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s)};
const voices=[];let currentTime=0;
function param(){return {value:0,setValueAtTime(v,t){this.value=v;assert(Number.isFinite(v)&&Number.isFinite(t));},linearRampToValueAtTime(v,t){this.value=v;assert(Number.isFinite(v)&&Number.isFinite(t));},exponentialRampToValueAtTime(v,t){assert(v>0&&Number.isFinite(t));},setTargetAtTime(v){this.value=v},cancelScheduledValues(){}}}
function node(){return {connect(){return arguments[0]},disconnect(){},gain:param(),pan:param(),frequency:param(),delayTime:param(),Q:param()}}
const ctx={get currentTime(){return currentTime},sampleRate:8000,createGain:node,createStereoPanner:node,createConvolver:node,createDelay:node,createBiquadFilter:node,createPeriodicWave:(real,imag)=>({real,imag}),createBuffer:(channels,length)=>({getChannelData:()=>new Float32Array(length)}),createOscillator(){const o=node();o.setPeriodicWave=wave=>{o.type="custom";o.wave=wave};o.start=t=>{o.t=t;assert(t>=currentTime);voices.push(o)};o.stop=t=>o.end=t;return o}};
const storage=new Map();
const sandbox={console,assert,$,ctx,compressor:node(),window:{},document:{createElement:element,querySelector:$,querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),rand:Math.random,state:{tempo:120},rhythmState:{swing:.3},grooveFocus:'house',groovePrimary:'house',grooveSecondary:'jazz',grooveBlendAmount:.25,voices};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('chunks/app-09.txt','utf8')+`
function finishVoices(){for(const v of [...sineVoices])v.o.onended()}
function simulate(mode){
 finishVoices();sineState.enabled=true;sineState.tone=0;sineState.variation=0;sineState.density=1;sineState.link=0;sineState.single=0;sineState.arp=0;sineState.chord=0;sineState[mode]=100;sineState.pool=['sus4'];sineState.range=2;resetSine();
 const start=voices.length;sineScheduler(ctx.currentTime,ctx.currentTime+.06);assert(voices.length>start);assert.equal(sineMode,mode);return voices.slice(start)
}
for(const mode of ['single','arp','chord']){const emitted=simulate(mode);assert.equal(emitted.length,mode==='chord'?3:1);for(const o of emitted){assert.equal(o.type,'sine');const midi=69+12*Math.log2(o.frequency.value/440);assert([0,5,7].some(n=>Math.abs(((midi-60)%12)-n)<.00001));assert(o.end>o.t)}}
// Up/down arpeggios follow pitch order without drifting outside the chord pool.
sineState.direction='down';simulate('arp');const first=voices.at(-1).frequency.value;finishVoices();sineNext=.3;sineScheduler(0,.4);assert(voices.at(-1).frequency.value<first);
// No scheduled oscillators when disabled or all mode weights are zero.
finishVoices();sineState.enabled=false;let n=voices.length;sineScheduler(0,1);assert.equal(voices.length,n);
sineState.enabled=true;sineState.single=sineState.arp=sineState.chord=0;sineNext=.01;sineScheduler(0,1);assert.equal(voices.length,n);
// Settings round-trip and reject empty/unknown pools and out-of-range values.
restoreSine({chordPalette:2,root:5,pool:['9sus4'],level:4,decay:-2,range:10,enabled:true});assert.equal(sineState.level,1);assert.equal(sineState.decay,.045);assert.equal(sineState.range,3);assert.equal(sineState.root,5);assert.deepEqual(sineState.pool,['9sus4']);
restoreSine({chordPalette:2,pool:['invalid']});assert.deepEqual(sineState.pool,sineDefaults.pool);const saved=window.sineLayer.capture();sineState.root=2;window.sineLayer.restore(saved);assert.equal(sineState.root,5);
// Gain applies independently; turning off fades and stops all active voices.
simulate('chord');sineState.level=.37;syncSine();assert(sineVoices.size>0);resetSine();for(const v of sineVoices)assert.equal(v.o.end,.04);finishVoices();assert.equal(sineVoices.size,0);
// Effects are independent, feedback bounded, delay follows tempo, and pan remains in range.
sineState.reverb=.7;sineState.delay=.6;sineState.feedback=.5;sineState.delayBeats=.75;applySineEffects();assert(Math.abs(sineEcho.delayTime.value-.375)<.00001);assert(Math.abs(sineReverbSend.gain.value-.595)<.00001);assert(Math.abs(sineEchoSend.gain.value-.45)<.00001);
state.tempo=60;applySineEffects();assert.equal(sineEcho.delayTime.value,.75);restoreSine({feedback:9});assert.equal(sineState.feedback,.78);
sineState.tone=.7;sineState.variation=1;sineState.pan=.8;sineState.motion=1;
for(let i=0;i<10;i++){sineNote(60,ctx.currentTime+.01,1,1);const v=[...sineVoices].at(-1);assert.equal(v.o.type,'custom');assert(v.p.pan.value>=-.8&&v.p.pan.value<=.8)}
sineState.enabled=false;syncSine();assert.equal(sineBus.gain.value,0);finishVoices();
sineState.level=.42;sineState.pool=['m11','7sus4♭9'];saveSineDefault();sineState.level=.9;sineState.pool=['sus2'];recallSineDefault();assert.equal(sineState.level,.42);assert.deepEqual(sineState.pool,['m11','7sus4♭9']);assert.equal(Object.keys(sineChords).length,28);
for(const [name,intervals] of Object.entries(sineChords)){assert(intervals[0]===0);assert(intervals.every(x=>Number.isFinite(x)&&x>=0));sineQuality=name;sineState.pool=[name];chooseSineChord();assert(sineNotes().length>=3)}
console.log('PASS: custom defaults, 28 chords, effects, tempo delay, feedback bound, moving pan, harmonics, modes, suspended pitches, arpeggio order, mute, settings, bounds, voice cleanup');
`,sandbox);
