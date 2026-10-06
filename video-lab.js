const $=s=>document.querySelector(s);
const audioInput=$('#audioInput'),imageInput=$('#imageInput'),previewBtn=$('#previewBtn'),recordBtn=$('#recordBtn'),stopBtn=$('#stopBtn'),repickBtn=$('#repickBtn');
const statusEl=$('#status'),segmentInfo=$('#segmentInfo'),progressEl=$('#analysisProgress'),canvas=$('#canvas'),ctx=canvas.getContext('2d'),hud=$('#hud'),downloadLink=$('#downloadLink');
const intensity=$('#intensity'),maxLayers=$('#maxLayers'),zoom=$('#zoom'),shake=$('#shake'),bright=$('#bright'),trail=$('#trail'),blur=$('#blur'),transitionStyle=$('#transitionStyle');
let audioFile=null,audioUrl=null,decodedBuffer=null,audioEl=null,audioCtx=null,sourceNode=null,analyser=null,audioDest=null;
let images=[],raf=0,mediaRecorder=null,chunks=[],previewing=false,recording=false;
let selectedStart=0,selectedDuration=30,analysisCandidates=[];
let visualLayers=[],lastEnergy=0,lastHigh=0,beatFloor=.08,lastSpawn=0,flashAlpha=0,energyHistory=[];

function fmt(sec){sec=Math.max(0,sec||0);const m=Math.floor(sec/60),s=Math.floor(sec%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0}
function std(a){const m=avg(a);return Math.sqrt(avg(a.map(v=>(v-m)*(v-m))))}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function rand(a=1,b=null){if(b===null){b=a;a=0}return a+Math.random()*(b-a)}
function pick(arr){return arr[Math.floor(Math.random()*arr.length)]}
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
      const v=mono[i];sum+=v*v;const dv=Math.abs(v-last);diff+=dv;hf+=dv*dv;
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
  const overBusyPenalty=onsetRate>.22?(onsetRate-.22)*1.8:0,tooFlatPenalty=stdR<meanR*.08?.18:0;
  return meanR*.9+stdR*2.4+meanF*.7+onsetRate*.9+highRate*.65+quietScore*.38-overBusyPenalty-tooFlatPenalty;
}
async function autoPickExcerpt(randomAmongTop=false){
  if(!decodedBuffer)return;
  progressEl.style.width='20%';statusEl.textContent='Analyzing WAV…';await new Promise(r=>setTimeout(r,20));
  const mono=mixToMono(decodedBuffer);progressEl.style.width='45%';
  const frames=analyzeFrames(mono,decodedBuffer.sampleRate);progressEl.style.width='70%';
  const maxStart=Math.max(0,decodedBuffer.duration-selectedDuration),step=decodedBuffer.duration<45?1:2.5,candidates=[];
  for(let start=0;start<=maxStart;start+=step)candidates.push({start,score:scoreWindow(frames,start,selectedDuration)});
  candidates.sort((a,b)=>b.score-a.score);analysisCandidates=candidates.slice(0,Math.min(8,candidates.length));
  let chosen=analysisCandidates[0]||{start:0,score:0};
  if(randomAmongTop&&analysisCandidates.length>1)chosen=analysisCandidates[Math.floor(Math.random()*Math.min(4,analysisCandidates.length))];
  selectedStart=clamp(chosen.start,0,maxStart);progressEl.style.width='100%';
  segmentInfo.textContent='AUTO SELECTED  '+fmt(selectedStart)+' – '+fmt(selectedStart+Math.min(selectedDuration,decodedBuffer.duration-selectedStart))+'  /  total '+fmt(decodedBuffer.duration);
  statusEl.textContent='30秒区間を自動選択しました。写真を選ぶとプレビューできます。';
  setTimeout(()=>progressEl.style.width='0%',500);ready();
}
audioInput.addEventListener('change',async()=>{
  if(audioUrl)URL.revokeObjectURL(audioUrl);
  audioFile=audioInput.files?.[0]||null;audioUrl=audioFile?URL.createObjectURL(audioFile):null;decodedBuffer=null;
  if(!audioFile){ready();return}
  try{statusEl.textContent='Loading WAV…';decodedBuffer=await decodeAudioFile(audioFile);await autoPickExcerpt(false)}
  catch(e){console.error(e);statusEl.textContent='WAVの解析に失敗しました。';segmentInfo.textContent='解析できませんでした。'}
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
  analyser=audioCtx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.68;
  audioDest=audioCtx.createMediaStreamDestination();
  sourceNode=audioCtx.createMediaElementSource(audioEl);
  sourceNode.connect(analyser);analyser.connect(audioCtx.destination);analyser.connect(audioDest);
  await audioCtx.resume();
}
function spectrum(now){
  const a=new Uint8Array(analyser.frequencyBinCount);analyser.getByteFrequencyData(a);
  const band=(s,e)=>{let sum=0,n=0;for(let i=s;i<Math.min(e,a.length);i++){sum+=a[i];n++}return n?sum/n/255:0};
  const low=band(0,26),mid=band(26,120),high=band(120,380),total=band(0,a.length);
  const energy=low*.48+mid*.34+high*.18,onset=Math.max(0,energy-lastEnergy),highOnset=Math.max(0,high-lastHigh);
  const slope=energy-lastEnergy,highSlope=high-lastHigh;
  beatFloor=beatFloor*.985+energy*.015;
  energyHistory.push({t:now,e:energy,h:high});while(energyHistory.length&&now-energyHistory[0].t>450)energyHistory.shift();
  const recent=energyHistory.filter(x=>now-x.t<180),older=energyHistory.filter(x=>now-x.t>=180&&now-x.t<420);
  const recentAvg=avg(recent.map(x=>x.e)),olderAvg=older.length?avg(older.map(x=>x.e)):recentAvg;
  const attackSlope=recentAvg-olderAvg;
  lastEnergy=energy;lastHigh=high;
  return {low,mid,high,total,energy,onset,highOnset,slope,highSlope,attackSlope};
}
function classifyEnvelope(s){
  const sharpScore=s.onset*8+s.highOnset*6+Math.max(0,s.slope)*5+Math.max(0,s.highSlope)*2.5;
  const softScore=Math.max(0,s.attackSlope)*7+Math.max(0,s.slope)*2+(s.energy>beatFloor*.9?.08:0);
  if(sharpScore>.44||(s.highOnset>.05&&s.onset>.015))return 'sharp';
  if(softScore>.15&&s.onset<.055)return 'soft';
  return 'neutral';
}
function randomImage(exclude=-1){if(images.length<=1)return 0;let i=exclude;for(let n=0;n<10&&i===exclude;n++)i=Math.floor(Math.random()*images.length);return i<0?0:i}
const anchors=[[.18,.18],[.5,.18],[.82,.2],[.2,.48],[.5,.5],[.8,.5],[.18,.8],[.5,.8],[.82,.8],[.34,.34],[.66,.66]];
function makeCrop(img,mode){
  const cropZoom=mode==='sharp'?rand(1.65,3.2):rand(1.25,2.5);
  const sw=Math.max(32,img.naturalWidth/cropZoom),sh=Math.max(32,img.naturalHeight/cropZoom);
  return {sx:rand(0,Math.max(1,img.naturalWidth-sw)),sy:rand(0,Math.max(1,img.naturalHeight-sh)),sw,sh};
}
function spawnLayer(mode,s,now,kind='main'){
  const style=transitionStyle.value,inten=Number(intensity.value)/100,anchor=pick(anchors),imgIndex=randomImage(),img=images[imgIndex].img;
  const sharp=mode==='sharp',soft=mode==='soft';
  let width=sharp?rand(.58,.98):soft?rand(.52,.90):rand(.50,.84);
  if(kind==='accent')width*=rand(.72,.94);
  width*=.88+inten*.24;
  const aspect=pick([.58,.72,.86,1,1.18,1.38,1.62]);
  let height=clamp(width/aspect,.28,.82);
  if(style==='dynamic'){width=clamp(width*1.08,.35,1.05);height=clamp(height*1.05,.26,.88)}
  if(style==='sparse'){width*=.92;height*=.92}
  const releaseControl=Number(trail.value)/100;
  const fadeInMs=sharp?0:soft?rand(180,520):rand(50,160);
  const life=sharp?rand(520,1250):soft?rand(1600,3600):rand(1000,2100);
  const fadeOutMs=sharp?rand(0,90):soft?rand(280,900)*(1+releaseControl*.8):rand(120,360);
  const crop=makeCrop(img,mode);
  visualLayers.push({
    imgIndex,mode,kind,x:clamp(anchor[0]+rand(-.09,.09),.05,.95),y:clamp(anchor[1]+rand(-.09,.09),.05,.95),
    width:clamp(width,.34,1.05),height:clamp(height,.26,.88),rot:sharp?rand(-11,11):rand(-5,5),
    born:now,life,fadeInMs,fadeOutMs,releaseStart:null,spawnEnergy:s.energy,
    blurStart:(Number(blur.value)/100)*(sharp?3:soft?16:8),driftX:soft?rand(-.025,.025):rand(-.008,.008),driftY:soft?rand(-.025,.025):rand(-.008,.008),
    crop
  });
  trimLayers(now,mode);
}
function trimLayers(now,newMode){
  const max=Number(maxLayers.value);
  while(visualLayers.length>max){
    const idx=visualLayers.findIndex(l=>l.mode==='sharp');
    if(newMode==='sharp'||idx<0)visualLayers.splice(0,1);
    else{
      const target=visualLayers[idx];
      if(target.releaseStart===null){target.releaseStart=now;target.fadeOutMs=Math.min(target.fadeOutMs,120)}
      else visualLayers.splice(idx,1);
      if(visualLayers.length>max)visualLayers.splice(0,1);
    }
  }
}
function updateReleases(s,now){
  for(const l of visualLayers){
    if(l.releaseStart!==null)continue;
    const age=now-l.born;
    if(age<120)continue;
    const drop=(l.spawnEnergy-s.energy);
    const fastDrop=drop>.08&&s.slope<-.018,softDrop=drop>.035&&s.slope<-.005;
    if(l.mode==='sharp'&&fastDrop){l.releaseStart=now;l.fadeOutMs=rand(0,75)}
    else if(l.mode==='soft'&&softDrop&&age>500){l.releaseStart=now;l.fadeOutMs=rand(320,850)*(1+Number(trail.value)/130)}
    else if(age>l.life){l.releaseStart=now}
  }
}
function updateEvents(s,now){
  const env=classifyEnvelope(s);
  const beatTh=Math.max(.024,beatFloor*.18),beatHit=s.onset>beatTh&&s.energy>beatFloor*1.025;
  const fxHit=s.highOnset>.038||(s.high>.38&&s.onset>.014),strong=s.low>.34&&s.onset>.018;
  const inten=Number(intensity.value)/100,style=transitionStyle.value;
  const minGap=style==='dynamic'?105:style==='sparse'?360:180;
  if(now-lastSpawn>minGap){
    if(fxHit){
      spawnLayer('sharp',s,now,'accent');lastSpawn=now;flashAlpha=Math.max(flashAlpha,.018+.035*inten);
      if(inten>.72&&Math.random()<.38)spawnLayer('sharp',s,now,'main');
    }else if(beatHit||strong){
      spawnLayer(env==='soft'?'soft':'sharp',s,now,'main');lastSpawn=now;
    }else if(env==='soft'&&s.energy>beatFloor*.92&&Math.random()<.055+.08*inten){
      spawnLayer('soft',s,now,'main');lastSpawn=now;
    }
  }
  if(!visualLayers.length&&images.length){spawnLayer(env==='sharp'?'sharp':'soft',s,now,'main');lastSpawn=now}
  updateReleases(s,now);
  return {beatHit,fxHit,strong,env};
}
function layerAlpha(l,now){
  const age=now-l.born;
  let a=1;
  if(l.fadeInMs>0)a*=clamp(age/l.fadeInMs,0,1);
  if(l.releaseStart!==null){
    const outAge=now-l.releaseStart;
    if(l.fadeOutMs<=8)return outAge>0?0:a;
    a*=1-clamp(outAge/l.fadeOutMs,0,1);
  }
  return a;
}
function drawFragment(layer,now,s){
  const img=images[layer.imgIndex].img,W=canvas.width,H=canvas.height;
  const a=layerAlpha(layer,now);if(a<=.001)return;
  const age=now-layer.born,t=clamp(age/Math.max(1,layer.life),0,1);
  const attack=Math.min(1,s.onset*10+s.highOnset*6),zoomResp=Number(zoom.value)/100;
  const scale=1+zoomResp*(layer.mode==='sharp'?attack*.055:(.012+s.low*.025));
  const dw=W*layer.width*scale,dh=H*layer.height*scale;
  const shakeAmt=(Number(shake.value)/100)*(layer.mode==='sharp'?(s.low*.5+attack*.8):(s.low*.22+attack*.15));
  const jx=rand(-.01,.01)*shakeAmt,jy=rand(-.01,.01)*shakeAmt;
  const cx=W*(layer.x+layer.driftX*t+jx),cy=H*(layer.y+layer.driftY*t+jy);
  const blurPx=layer.blurStart*(1-clamp(age/Math.max(80,layer.fadeInMs||120),0,1));
  const br=1+(Number(bright.value)/100)*(s.high*.16-s.low*.04+attack*.025);
  ctx.save();ctx.translate(cx,cy);ctx.rotate(layer.rot*Math.PI/180);ctx.globalAlpha=a;
  ctx.filter='brightness('+br.toFixed(3)+')'+(blurPx>.1?' blur('+blurPx.toFixed(1)+'px)':'');
  ctx.shadowColor='rgba(0,0,0,.28)';ctx.shadowBlur=18;
  const c=layer.crop;
  ctx.drawImage(img,c.sx,c.sy,c.sw,c.sh,-dw/2,-dh/2,dw,dh);
  ctx.restore();
}
function renderLayers(now,s){
  const W=canvas.width,H=canvas.height;
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
  visualLayers=visualLayers.filter(l=>{
    if(l.releaseStart===null)return now-l.born<l.life+2500;
    return now-l.releaseStart<Math.max(20,l.fadeOutMs+40);
  });
  for(const l of visualLayers)drawFragment(l,now,s);
  if(flashAlpha>.002){ctx.fillStyle='rgba(255,255,255,'+flashAlpha.toFixed(3)+')';ctx.fillRect(0,0,W,H);flashAlpha*=.68}
}
function drawFrame(now){
  if(!previewing||!analyser||!images.length)return;
  const s=spectrum(now),ev=updateEvents(s,now);renderLayers(now,s);
  const elapsed=audioEl?audioEl.currentTime-selectedStart:0;
  hud.textContent=fmt(Math.max(0,elapsed))+' / 00:30 · '+ev.env.toUpperCase()+' · LOW '+Math.round(s.low*100)+' MID '+Math.round(s.mid*100)+' HIGH '+Math.round(s.high*100)+(ev.beatHit?' · BEAT':'')+(ev.fxHit?' · FX':'');
  if(audioEl&&audioEl.currentTime>=selectedStart+selectedDuration-.03){stopAll(true);return}
  raf=requestAnimationFrame(drawFrame);
}
async function startPreview(doRecord=false){
  if(previewing)stopAll(false);
  await ensurePlaybackAudio();
  visualLayers=[];lastEnergy=0;lastHigh=0;beatFloor=.08;lastSpawn=0;flashAlpha=0;energyHistory=[];
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
  audioEl.onended=()=>stopAll(true);await audioEl.play();
  statusEl.textContent=doRecord?'Recording Story 30s…':'Previewing audio-envelope collage…';
  raf=requestAnimationFrame(drawFrame);
}
function stopAll(natural=false){
  if(!previewing&&!recording)return;
  previewing=false;cancelAnimationFrame(raf);stopBtn.disabled=true;if(audioEl)audioEl.pause();
  if(mediaRecorder&&mediaRecorder.state!=='inactive')mediaRecorder.stop();
  recording=false;ready();if(!natural)statusEl.textContent='Stopped.';
}
previewBtn.onclick=()=>startPreview(false);recordBtn.onclick=()=>startPreview(true);stopBtn.onclick=()=>stopAll(false);
$('#randomizeBtn').onclick=()=>{
  intensity.value=Math.round(rand(52,95));maxLayers.value=Math.round(rand(4,8));zoom.value=Math.round(rand(20,60));shake.value=Math.round(rand(2,20));
  bright.value=Math.round(rand(10,38));trail.value=Math.round(rand(8,42));blur.value=Math.round(rand(0,38));
  transitionStyle.value=['soft','dynamic','sparse'][Math.floor(Math.random()*3)];updateLabels();
};
canvas.width=1080;canvas.height=1920;ready();