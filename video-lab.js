const $=s=>document.querySelector(s);
const audioInput=$('#audioInput'), imageInput=$('#imageInput'), previewBtn=$('#previewBtn'), recordBtn=$('#recordBtn'), stopBtn=$('#stopBtn');
const statusEl=$('#status'), canvas=$('#canvas'), ctx2d=canvas.getContext('2d'), stage=$('#stage'), hud=$('#hud'), downloadLink=$('#downloadLink');
const change=$('#change'), zoom=$('#zoom'), bright=$('#bright'), shake=$('#shake');
let audioEl=null,audioUrl=null,audioCtx=null,sourceNode=null,analyser=null,audioDest=null,images=[],raf=0,current=0,nextSwitch=0,mediaRecorder=null,chunks=[],recording=false,previewing=false,lastT=0,lastSwitch=0,lastEnergy=0,lastHigh=0,beatFloor=.08;
let orientation='portrait';

function updateLabels(){
  $('#changeOut').textContent=Number(change.value).toFixed(1)+'s';
  $('#zoomOut').textContent=zoom.value+'%';
  $('#brightOut').textContent=bright.value+'%';
  $('#shakeOut').textContent=shake.value+'%';
}
[change,zoom,bright,shake].forEach(x=>x.addEventListener('input',updateLabels)); updateLabels();

function ready(){const ok=!!audioUrl&&images.length>0;previewBtn.disabled=!ok;recordBtn.disabled=!ok}
audioInput.addEventListener('change',()=>{
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  const f=audioInput.files?.[0]; audioUrl=f?URL.createObjectURL(f):null;
  if(f)statusEl.textContent='WAV: '+f.name;
  ready();
});
imageInput.addEventListener('change',async()=>{
  images.forEach(x=>URL.revokeObjectURL(x.url)); images=[];
  const files=[...(imageInput.files||[])];
  for(const f of files){
    const url=URL.createObjectURL(f);
    const img=new Image(); img.src=url; await img.decode().catch(()=>{});
    if(img.naturalWidth)images.push({img,url,name:f.name});
  }
  const thumbs=$('#thumbs'); thumbs.innerHTML='';
  images.slice(0,24).forEach(x=>{const im=document.createElement('img');im.src=x.url;thumbs.appendChild(im)});
  statusEl.textContent=images.length+' photos ready';
  ready();
});

async function ensureAudio(){
  if(audioEl){audioEl.pause();audioEl.currentTime=0}
  audioEl=new Audio(audioUrl); audioEl.crossOrigin='anonymous'; audioEl.preload='auto';
  if(!audioCtx){
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    analyser=audioCtx.createAnalyser(); analyser.fftSize=2048; analyser.smoothingTimeConstant=.82;
    audioDest=audioCtx.createMediaStreamDestination();
  }
  if(sourceNode){try{sourceNode.disconnect()}catch{}}
  sourceNode=audioCtx.createMediaElementSource(audioEl);
  sourceNode.connect(analyser); analyser.connect(audioCtx.destination); analyser.connect(audioDest);
  await audioCtx.resume();
}
function spectrum(){
  const a=new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(a);
  const avg=(s,e)=>{let n=0,sum=0;for(let i=s;i<e;i++){sum+=a[i];n++}return n?sum/n/255:0};
  const low=avg(0,28), mid=avg(28,120), high=avg(120,360);
  let total=0;for(const v of a)total+=v; total/=a.length*255;
  const energy=low*.48+mid*.34+high*.18;
  const onset=Math.max(0,energy-lastEnergy);
  const highOnset=Math.max(0,high-lastHigh);
  beatFloor=beatFloor*.985+energy*.015;
  lastEnergy=energy;lastHigh=high;
  return {low,mid,high,total,energy,onset,highOnset};
}
function pickNext(){if(images.length<2)return;let n=current;for(let i=0;i<8&&n===current;i++)n=Math.floor(Math.random()*images.length);current=n}
function drawFrame(t){
  if(!previewing||!analyser||!images.length)return;
  const s=spectrum();
  const maxHold=Math.max(1400,Number(change.value)*1000);
  const minHold=260;
  const since=t-lastSwitch;

  // Switch primarily on musical events rather than a fixed timer.
  // Strong low/mid attacks act like beats; sharp high-frequency attacks catch FX/transients.
  const beatThreshold=Math.max(.035,beatFloor*.24);
  const beatHit=s.onset>beatThreshold && s.energy>beatFloor*1.06;
  const fxHit=s.highOnset>.055 || (s.high>.42 && s.onset>.025);
  const accentHit=s.low>.42 && s.onset>.028;
  const canSwitch=since>minHold;
  const musicalSwitch=canSwitch && (beatHit || fxHit || accentHit);
  const safetySwitch=since>maxHold;

  if(musicalSwitch || safetySwitch){
    pickNext();
    lastSwitch=t;
  }

  const {img}=images[current]; const W=canvas.width,H=canvas.height;
  ctx2d.fillStyle='#000';ctx2d.fillRect(0,0,W,H);
  const fit=Math.max(W/img.naturalWidth,H/img.naturalHeight);

  // Motion is restrained in quiet passages and wakes up around attacks.
  const attackBoost=Math.min(1,s.onset*10+s.highOnset*5);
  const z=1+(Number(zoom.value)/100)*(.018+s.total*.11+s.low*.055+attackBoost*.028);
  const sc=fit*z,w=img.naturalWidth*sc,h=img.naturalHeight*sc;
  const sh=Number(shake.value)/100;
  const shakeAmt=(s.low*.55+attackBoost*.45);
  const dx=(Math.random()-.5)*W*.022*sh*shakeAmt,dy=(Math.random()-.5)*H*.022*sh*shakeAmt;
  const x=(W-w)/2+dx,y=(H-h)/2+dy;

  const br=1+(Number(bright.value)/100)*(s.high*.28-s.low*.10+attackBoost*.06);
  const sat=.90+s.mid*.18+s.high*.05;
  ctx2d.save();
  ctx2d.filter='brightness('+br+') saturate('+sat+')';
  ctx2d.globalAlpha=.985;
  ctx2d.drawImage(img,x,y,w,h);
  ctx2d.restore();

  // Subtle flash only on genuine transients.
  if(fxHit || (beatHit&&s.high>.28)){
    ctx2d.fillStyle='rgba(255,255,255,'+Math.min(.07,.018+attackBoost*.045)+')';
    ctx2d.fillRect(0,0,W,H);
  }

  hud.textContent=
    'LOW '+Math.round(s.low*100)+
    '  MID '+Math.round(s.mid*100)+
    '  HIGH '+Math.round(s.high*100)+
    (beatHit?'  BEAT':'')+(fxHit?'  FX':'');
  lastT=t;raf=requestAnimationFrame(drawFrame);
}
async function startPreview(doRecord=false){
  if(previewing)stopAll();
  await ensureAudio();
  current=Math.floor(Math.random()*images.length); nextSwitch=0;lastSwitch=performance.now();lastEnergy=0;lastHigh=0;beatFloor=.08;previewing=true;recording=doRecord;
  stopBtn.disabled=false;previewBtn.disabled=true;recordBtn.disabled=true;downloadLink.classList.remove('show');
  if(doRecord){
    const cvs=canvas.captureStream(30);
    const stream=new MediaStream([...cvs.getVideoTracks(),...audioDest.stream.getAudioTracks()]);
    const types=['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    const mime=types.find(x=>window.MediaRecorder&&MediaRecorder.isTypeSupported(x))||'';
    try{mediaRecorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:8000000}:undefined)}
    catch(e){statusEl.textContent='この端末ではブラウザ録画に対応していません。';stopAll();return}
    chunks=[];mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      const type=mediaRecorder.mimeType||'video/webm',blob=new Blob(chunks,{type}),url=URL.createObjectURL(blob);
      downloadLink.href=url;downloadLink.download='FeLid_audio_reactive_'+Date.now()+(type.includes('mp4')?'.mp4':'.webm');
      downloadLink.classList.add('show');downloadLink.textContent='VIDEO DOWNLOAD ('+Math.round(blob.size/1e6)+' MB)';
      statusEl.textContent='動画を書き出しました。';
    };
    mediaRecorder.start(1000);
  }
  audioEl.onended=()=>stopAll();
  await audioEl.play();
  statusEl.textContent=doRecord?'Recording… 曲の終わりまで録画します。':'Previewing…';
  raf=requestAnimationFrame(drawFrame);
}
function stopAll(){
  previewing=false;cancelAnimationFrame(raf);stopBtn.disabled=true;previewBtn.disabled=false;recordBtn.disabled=false;
  if(audioEl){audioEl.pause();audioEl.currentTime=0}
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.stop()}
  recording=false;statusEl.textContent=statusEl.textContent.includes('書き出')?statusEl.textContent:'Stopped.';
}
previewBtn.onclick=()=>startPreview(false);
recordBtn.onclick=()=>startPreview(true);
stopBtn.onclick=stopAll;
$('#portraitBtn').onclick=()=>{orientation='portrait';canvas.width=1080;canvas.height=1920;stage.classList.remove('landscape')};
$('#landscapeBtn').onclick=()=>{orientation='landscape';canvas.width=1920;canvas.height=1080;stage.classList.add('landscape')};
$('#randomizeBtn').onclick=()=>{
  change.value=(4+Math.random()*10).toFixed(1);zoom.value=Math.round(15+Math.random()*60);bright.value=Math.round(10+Math.random()*55);shake.value=Math.round(Math.random()*35);updateLabels()
};
