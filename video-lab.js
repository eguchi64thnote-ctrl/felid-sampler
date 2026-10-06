const $=s=>document.querySelector(s);
const audioInput=$('#audioInput'),imageInput=$('#imageInput'),previewBtn=$('#previewBtn'),recordBtn=$('#recordBtn'),stopBtn=$('#stopBtn'),repickBtn=$('#repickBtn');
const statusEl=$('#status'),segmentInfo=$('#segmentInfo'),progressEl=$('#analysisProgress'),canvas=$('#canvas'),ctx=canvas.getContext('2d'),hud=$('#hud'),downloadLink=$('#downloadLink');
const intensity=$('#intensity'),maxLayers=$('#maxLayers'),zoom=$('#zoom'),shake=$('#shake'),bright=$('#bright'),trail=$('#trail'),blur=$('#blur'),transitionStyle=$('#transitionStyle');
let audioFile=null,audioUrl=null,decodedBuffer=null,audioEl=null,audioCtx=null,sourceNode=null,analyser=null,audioDest=null;
let images=[],raf=0,mediaRecorder=null,chunks=[],previewing=false,recording=false;
let selectedStart=0,selectedDuration=30,analysisCandidates=[];
let visualLayers=[],lastEnergy=0,lastHigh=0,beatFloor=.08,lastSpawn=0,lastBgSwap=0,currentBackground=-1,flashAlpha=0;

function fmt(sec){sec=Math.max(0,sec||0);const m=Math.floor(sec/60),s=Math.floor(sec%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function std(a){const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)*(v-m))))}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rand(a=1,b=null){if(b===null){b=a;a=0}return a+Math.random()*(b-a)}
function updateLabels(){
  $('#intensityOut').textContent=intensity.value+'%';$('#layersOut').textContent=maxLayers.value;$('#zoomOut').textContent=zoom.value+'%';
  $('#shakeOut').textContent=shake.value+'%';$('#brightOut').textContent=bright.value+'%';$('#trailOut').textContent=trail.value+'%';$('#blurOut').textContent=blur.value+'%';
}
[intensity,maxLayers,zoom,shake,bright,trail,blur].forEach(x=>x.addEventListener('input',updateLabels));updateLabels();

function ready(){
  const ok=!!audioUrl&&!!decodedBuffer&&images.length>0&&!previewing;
  previewBtn.disabled=!ok;recordBtn.disabled=!ok;repickBtn.disabled=!decodedBuffer||previewing;
}

async function decodeAudioFile(file){
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  const ab=await file.arrayBuffer();
  return await audioCtx.decodeAudioData(ab.slice(0));
}
function mixToMono(buf){
  const out=new Float32Array(buf.length),n=buf.numberOfChannels;
  for(let c=0;c<n;c++){const d=buf.getChannelData(c);for(let i=0;i<out.length;i++)out[i]+=d[i]/n}
  return out;
}
function analyzeFrames(mono,sampleRate){
  const frame=Math.max(256,Math.floor(sampleRate*.05)),hop=Math.max(128,Math.floor(sampleRate*.025));
  const frames=[];let prevRms=0,prevHF=0;
  for(let start=0;start+frame<mono.length;start+=hop){
    let sum=0,diff=0,zc=0,last=mono[start],hf=0;
    for(let i=start;i<start+frame;i+=2){
      const v=mono[i];sum+=v*v;
      const dv=Math.abs(v-last);diff+=dv;hf+=dv*dv;
      if((v>=0)!=(last>=0))zc++;last=v;
    }
    const n=Math.ceil(frame/2),rms=Math.sqrt(sum/Math.max(1,n)),flux=diff/Math.max(1,n),hfe=Math.sqrt(hf/Math.max(1,n));
    const onset=Math.max(0,rms-prevRms*.88),highOnset=Math.max(0,hfe-prevHF*.90);
    frames.push({time:start/sampleRate,rms,flux,hfe,zcr:zc/Math.max(1,n),onset,highOnset});
    prevRms=rms;prevHF=hfe;
  }
  return frames;
}
function scoreWindow(frames,start,dur=30){
  const seg=frames.filter(f=>f.time>=start&&f.time<start+dur);if(seg.length<10)return -1e9;
  const rms=seg.map(f=>f.rms),flux=seg.map(f=>f.flux),onsets=seg.map(f=>f.onset),high=seg.map(f=>f.highOnset);
  const meanR=avg(rms),stdR=std(rms),meanF=avg(flux);
  const onsetTh=avg(onsets)+std(onsets)*.75,highTh=avg(high)+std(high)*.8;
  const onsetRate=seg.filter(f=>f.onset>Math.max(.002,onsetTh)).length/seg.length;
  const highRate=seg.filter(f=>f.highOnset>Math.max(.002,highTh)).length/seg.length;
  const quiet=seg.filter(f=>f.rms<Math.max(.001,meanR*.48)).length/seg.length;
  const quietScore=1-clamp(Math.abs(quiet-.18)/.35,0,1);
  const overBusyPenalty=onsetRate>.22?(onsetRate-.22)*1.8:0;
  const tooFlatPenalty=stdR<meanR*.08?.18:0;
  return meanR*.9+stdR*2.4+meanF*.7+onsetRate*.9+highRate*.65+quietScore*.38-overBusyPenalty-tooFlatPenalty;
}
async function autoPickExcerpt(randomAmongTop=false){
  if(!decodedBuffer)return;
  progressEl.style.width='20%';statusEl.textContent='Analyzing WAV…';
  await new Promise(r=>setTimeout(r,20));
  const mono=mixToMono(decodedBuffer);progressEl.style.width='45%';
  const frames=analyzeFrames(mono,decodedBuffer.sampleRate);progressEl.style.width='70%';
  const maxStart=Math.max(0,decodedBuffer.duration-selectedDuration),step=decodedBuffer.duration<45?1:2.5;
  const candidates=[];
  for(let start=0;start<=maxStart;start+=step)candidates.push({start,score:scoreWindow(frames,start,selectedDuration)});
  candidates.sort((a,b)=>b.score-a.score);analysisCandidates=candidates.slice(0,Math.min(8,candidates.length));
  let pick=analysisCandidates[0]||{start:0,score:0};
  if(randomAmongTop&&analysisCandidates.length>1)pick=analysisCandidates[Math.floor(Math.random()*Math.min(4,analysisCandidates.length))];
  selectedStart=clamp(pick.start,0,maxStart);
  progressEl.style.width='100%';
  segmentInfo.textContent='AUTO SELECTED  '+fmt(selectedStart)+' – '+fmt(selectedStart+Math.min(selectedDuration,decodedBuffer.duration-selectedStart))+'  /  total '+fmt(decodedBuffer.duration);
  statusEl.textContent='30秒区間を自動選択しました。写真を選ぶとプレビューできます。';
  setTimeout(()=>progressEl.style.width='0%',500);ready();
}

audioInput.addEventListener('change',async()=>{
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioFile=audioInput.files?.[0]||null;audioUrl=audioFile?URL.createObjectURL(audioFile):null;decodedBuffer=null;
  if(!audioFile){ready();return}
  try{
    statusEl.textContent='Loading WAV…';decodedBuffer=await decodeAudioFile(audioFile);
    await autoPickExcerpt(false);
  }catch(e){console.error(e);statusEl.textContent='WAVの解析に失敗しました。';segmentInfo.textContent='解析できませんでした。'}
});
repickBtn.onclick=()=>autoPickExcerpt(true);

imageInput.addEventListener('change',async()=>{
  images.forEach(x=>URL.revokeObjectURL(x.url));images=[];
  for(const f of [...(imageInput.files||[])]){
    const url=URL.createObjectURL(f),img=new Image();img.src=url;await img.decode().catch(()=>{});
    if(img.naturalWidth)images.push({img,url,name:f.name});
  }
  $('#thumbs').innerHTML='';images.slice(0,30).forEach(x=>{const im=document.createElement('img');im.src=x.url;$('#thumbs').appendChild(im)});
  statusEl.textContent=images.length+' photos ready';ready();
});

async function ensurePlaybackAudio(){
  if(audioEl){audioEl.pause();audioEl.src=''}
  audioEl=new Audio(audioUrl);audioEl.preload='auto';
  if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  analyser=audioCtx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.78;
  audioDest=audioCtx.createMediaStreamDestination();
  sourceNode=audioCtx.createMediaElementSource(audioEl);
  sourceNode.connect(analyser);analyser.connect(audioCtx.destination);analyser.connect(audioDest);
  await audioCtx.resume();
}
function spectrum(){
  const a=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(a);
  const band=(s,e)=>{let sum=0,n=0;for(let i=s;i<Math.min(e,a.length);i++){sum+=a[i];n++}return n?sum/n/255:0};
  const low=band(0,26),mid=band(26,120),high=band(120,380),total=band(0,a.length);
  const energy=low*.48+mid*.34+high*.18,onset=Math.max(0,energy-lastEnergy),highOnset=Math.max(0,high-lastHigh);
  beatFloor=beatFloor*.985+energy*.015;lastEnergy=energy;lastHigh=high;
  return {low,mid,high,total,energy,onset,highOnset};
}
function randomImage(exclude=-1){if(images.length<=1)return 0;let i=exclude;for(let n=0;n<10&&i===exclude;n++)i=Math.floor(Math.random()*images.length);return i<0?0:i}
const anchors=[[.17,.18],[.5,.2],[.82,.23],[.22,.48],[.5,.5],[.78,.52],[.18,.78],[.52,.78],[.82,.78],[.34,.34],[.67,.66]];
function spawnLayer(type,s,now){
  const style=transitionStyle.value,inten=Number(intensity.value)/100;
  const anchor=anchors[Math.floor(Math.random()*anchors.length)];
  let scale=.42,life=3200,rot=rand(-7,7),alpha=.94;
  if(type==='background'){scale=1.08;life=9000;rot=rand(-1.5,1.5);alpha=1}
  if(type==='accent'){scale=rand(.18,.38)+(s.high*.12);life=style==='sparse'?1700:rand(900,1900);rot=rand(-13,13)}
  if(type==='overlay'){scale=rand(.30,.62)+(s.low*.18);life=style==='dynamic'?rand(1800,3300):rand(2800,5200)}
  if(style==='sparse'){scale*=.9;life*=1.25}if(style==='dynamic'){rot*=1.3;life*=.8}
  const imgIndex=randomImage(type==='background'?currentBackground:-1);
  if(type==='background')currentBackground=imgIndex;
  visualLayers.push({
    imgIndex,type,x:type==='background'?.5:clamp(anchor[0]+rand(-.06,.06),.08,.92),y:type==='background'?.5:clamp(anchor[1]+rand(-.06,.06),.08,.92),
    scale:scale*(.82+inten*.35),rot,alpha,born:now,life,blurStart:(Number(blur.value)/100)*(type==='accent'?22:14),driftX:rand(-.025,.025),driftY:rand(-.025,.025),grow:rand(.01,.055)
  });
  const max=Number(maxLayers.value);
  while(visualLayers.length>max){
    const idx=visualLayers.findIndex(l=>l.type!=='background');visualLayers.splice(idx>=0?idx:0,1);
  }
}
function ensureBackground(now,s){
  const bg=visualLayers.find(l=>l.type==='background'&&now-l.born<l.life);
  if(!bg){spawnLayer('background',s,now);lastBgSwap=now}
}
function updateEvents(s,now){
  ensureBackground(now,s);
  const beatTh=Math.max(.028,beatFloor*.20),beatHit=s.onset>beatTh&&s.energy>beatFloor*1.04;
  const fxHit=s.highOnset>.045||(s.high>.40&&s.onset>.018);
  const strong=s.low>.38&&s.onset>.022;
  const inten=Number(intensity.value)/100,style=transitionStyle.value;
  const minGap=style==='dynamic'?170:style==='sparse'?620:320;
  if(now-lastSpawn>minGap){
    if(fxHit){spawnLayer('accent',s,now);lastSpawn=now;flashAlpha=Math.max(flashAlpha,.04+.05*inten)}
    else if(beatHit||strong){if(Math.random()<.45+.5*inten)spawnLayer('overlay',s,now);lastSpawn=now}
  }
  const bgGap=style==='sparse'?8500:style==='dynamic'?4200:6200;
  if(now-lastBgSwap>bgGap&&s.energy>beatFloor*.92){spawnLayer('background',s,now);lastBgSwap=now}
  return {beatHit,fxHit,strong};
}
function drawCover(img,cx,cy,scale,rot,alpha,blurPx,driftX=0,driftY=0){
  const W=canvas.width,H=canvas.height;
  const isBg=scale>.95,fit=isBg?Math.max(W/img.naturalWidth,H/img.naturalHeight):Math.min((W*scale)/img.naturalWidth,(H*scale)/img.naturalHeight);
  const w=img.naturalWidth*fit,h=img.naturalHeight*fit;
  ctx.save();ctx.translate(W*(cx+driftX),H*(cy+driftY));ctx.rotate(rot*Math.PI/180);ctx.globalAlpha=alpha;
  ctx.filter=blurPx>0?'blur('+blurPx.toFixed(1)+'px)':'none';
  if(!isBg){ctx.shadowColor='rgba(0,0,0,.35)';ctx.shadowBlur=22}
  ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();
}
function renderLayers(now,s){
  const W=canvas.width,H=canvas.height,trailAmt=Number(trail.value)/100;
  ctx.fillStyle='rgba(0,0,0,'+(1-(trailAmt*.42)).toFixed(3)+')';ctx.fillRect(0,0,W,H);
  visualLayers=visualLayers.filter(l=>now-l.born<l.life);
  for(const l of visualLayers){
    const age=now-l.born,t=clamp(age/l.life,0,1);
    const fadeIn=clamp(t*7,0,1),fadeOut=clamp((1-t)*3.2,0,1),a=l.alpha*Math.min(fadeIn,fadeOut);
    const attack=Math.min(1,s.onset*9+s.highOnset*5),motion=(Number(zoom.value)/100)*(.02+s.low*.05+attack*.025);
    const scale=l.scale*(1+l.grow*t+motion),blurPx=l.blurStart*(1-clamp(t*5,0,1));
    const shakeAmt=(Number(shake.value)/100)*(s.low*.55+attack*.45);
    const jx=rand(-.006,.006)*shakeAmt,jy=rand(-.006,.006)*shakeAmt;
    const brightness=1+(Number(bright.value)/100)*(s.high*.22-s.low*.06);
    ctx.save();ctx.filter='brightness('+brightness.toFixed(3)+')';
    drawCover(images[l.imgIndex].img,l.x,l.y,scale,l.rot*(1-t*.25),a,blurPx,l.driftX*t+jx,l.driftY*t+jy);
    ctx.restore();
  }
  if(flashAlpha>.002){ctx.fillStyle='rgba(255,255,255,'+flashAlpha.toFixed(3)+')';ctx.fillRect(0,0,W,H);flashAlpha*=.82}
}
function drawFrame(now){
  if(!previewing||!analyser||!images.length)return;
  const s=spectrum(),ev=updateEvents(s,now);renderLayers(now,s);
  const elapsed=audioEl?audioEl.currentTime-selectedStart:0;
  hud.textContent=fmt(Math.max(0,elapsed))+' / 00:30 · LOW '+Math.round(s.low*100)+' MID '+Math.round(s.mid*100)+' HIGH '+Math.round(s.high*100)+(ev.beatHit?' · BEAT':'')+(ev.fxHit?' · FX':'');
  if(audioEl&&audioEl.currentTime>=selectedStart+selectedDuration-.03){stopAll(true);return}
  raf=requestAnimationFrame(drawFrame);
}
async function startPreview(doRecord=false){
  if(previewing)stopAll(false);
  await ensurePlaybackAudio();
  visualLayers=[];lastEnergy=0;lastHigh=0;beatFloor=.08;lastSpawn=0;lastBgSwap=0;currentBackground=-1;flashAlpha=0;
  previewing=true;recording=doRecord;stopBtn.disabled=false;previewBtn.disabled=true;recordBtn.disabled=true;repickBtn.disabled=true;downloadLink.classList.remove('show');
  audioEl.currentTime=selectedStart;
  if(doRecord){
    if(!canvas.captureStream||!window.MediaRecorder){statusEl.textContent='このブラウザでは動画録画に対応していません。';previewing=false;ready();return}
    const cvs=canvas.captureStream(30),stream=new MediaStream([...cvs.getVideoTracks(),...audioDest.stream.getAudioTracks()]);
    const types=['video/mp4;codecs=h264,aac','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    const mime=types.find(x=>MediaRecorder.isTypeSupported(x))||'';
    try{mediaRecorder=new MediaRecorder(stream,mime?{mimeType:mime,videoBitsPerSecond:8000000}:undefined)}
    catch(e){console.error(e);statusEl.textContent='動画レコーダーを開始できません。';previewing=false;ready();return}
    chunks=[];mediaRecorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    mediaRecorder.onstop=()=>{
      const type=mediaRecorder.mimeType||'video/webm',blob=new Blob(chunks,{type}),url=URL.createObjectURL(blob);
      downloadLink.href=url;downloadLink.download='FeLid_story_'+Date.now()+(type.includes('mp4')?'.mp4':'.webm');
      downloadLink.classList.add('show');downloadLink.textContent='VIDEO DOWNLOAD ('+Math.round(blob.size/1e6)+' MB)';
      statusEl.textContent='30秒のStory動画を書き出しました。';
    };
    mediaRecorder.start(1000);
  }
  audioEl.onended=()=>stopAll(true);
  await audioEl.play();
  statusEl.textContent=doRecord?'Recording Story 30s…':'Previewing auto-selected 30s…';
  raf=requestAnimationFrame(drawFrame);
}
function stopAll(natural=false){
  if(!previewing&&!recording)return;
  previewing=false;cancelAnimationFrame(raf);stopBtn.disabled=true;
  if(audioEl){audioEl.pause()}
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.stop()}
  recording=false;ready();
  if(!natural)statusEl.textContent='Stopped.';
}
previewBtn.onclick=()=>startPreview(false);recordBtn.onclick=()=>startPreview(true);stopBtn.onclick=()=>stopAll(false);
$('#randomizeBtn').onclick=()=>{
  intensity.value=Math.round(rand(38,88));maxLayers.value=Math.round(rand(4,9));zoom.value=Math.round(rand(18,62));shake.value=Math.round(rand(2,24));
  bright.value=Math.round(rand(12,48));trail.value=Math.round(rand(8,34));blur.value=Math.round(rand(8,48));
  transitionStyle.value=['soft','dynamic','sparse'][Math.floor(Math.random()*3)];updateLabels();
};
canvas.width=1080;canvas.height=1920;ready();