const $=s=>document.querySelector(s);
const audioInput=$('#audioInput'),imageInput=$('#imageInput'),previewBtn=$('#previewBtn'),recordBtn=$('#recordBtn'),stopBtn=$('#stopBtn'),repickBtn=$('#repickBtn');
const statusEl=$('#status'),segmentInfo=$('#segmentInfo'),progressEl=$('#analysisProgress'),canvas=$('#canvas'),ctx=canvas.getContext('2d'),hud=$('#hud'),downloadLink=$('#downloadLink');
const intensity=$('#intensity'),maxLayers=$('#maxLayers'),zoom=$('#zoom'),shake=$('#shake'),bright=$('#bright'),trail=$('#trail'),blur=$('#blur'),transitionStyle=$('#transitionStyle');
let audioFile=null,audioUrl=null,decodedBuffer=null,audioEl=null,audioCtx=null,sourceNode=null,analyser=null,audioDest=null;
let images=[],raf=0,mediaRecorder=null,chunks=[],previewing=false,recording=false;
let selectedStart=0,selectedDuration=30,analysisCandidates=[];
let visualLayers=[],gridRects=[],lastEnergy=0,lastHigh=0,beatFloor=.08,lastSpawn=0,flashAlpha=0,energyHistory=[],lastImageIndex=-1;

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
function randomImage(exclude=-1){
  if(images.length<=1)return 0;
  let i=exclude;
  for(let n=0;n<12&&i===exclude;n++)i=Math.floor(Math.random()*images.length);
  lastImageIndex=i<0?0:i;
  return lastImageIndex;
}
function rectArea(r){return r.w*r.h}
function splitRect(r,vertical,ratio){
  if(vertical){
    return [
      {x:r.x,y:r.y,w:r.w*ratio,h:r.h},
      {x:r.x+r.w*ratio,y:r.y,w:r.w*(1-ratio),h:r.h}
    ];
  }
  return [
    {x:r.x,y:r.y,w:r.w,h:r.h*ratio},
    {x:r.x,y:r.y+r.h*ratio,w:r.w,h:r.h*(1-ratio)}
  ];
}
function subdivideZone(zone,count){
  let cells=[{...zone}],guard=0;
  while(cells.length<count&&guard++<80){
    const candidates=cells
      .map((r,i)=>({r,i,score:rectArea(r)*(0.45+Math.random()*1.3)}))
      .filter(o=>o.r.w>.11||o.r.h>.11)
      .sort((a,b)=>b.score-a.score);
    if(!candidates.length)break;
    const {r,i}=candidates[0];

    let vertical;
    const ar=r.w/r.h;
    if(ar>1.7)vertical=true;
    else if(ar<.58)vertical=false;
    else vertical=Math.random()<.5;

    let ratio;
    const extreme=Math.random()<.46;
    ratio=extreme?pick([rand(.16,.30),rand(.70,.84)]):rand(.34,.66);

    const parts=splitRect(r,vertical,ratio);
    if(parts.some(p=>p.w<.055||p.h<.045)){
      ratio=rand(.38,.62);
      const retry=splitRect(r,vertical,ratio);
      if(retry.some(p=>p.w<.05||p.h<.04))continue;
      cells.splice(i,1,...retry);
    }else{
      cells.splice(i,1,...parts);
    }
  }
  return cells;
}
function decorateCell(r,zoneIndex){
  const area=rectArea(r),ar=r.w/r.h;
  let sizeClass='m';
  if(area<.045)sizeClass='xs';
  else if(area<.09)sizeClass='s';
  else if(area>.28)sizeClass='xl';
  else if(area>.17)sizeClass='l';

  const strip=(ar>3.2||ar<.31);
  let out={...r,zoneIndex,sizeClass,strip};

  // Occasionally let edge pieces continue beyond the frame, while staying axis-aligned.
  if(Math.random()<.22){
    const bleed=rand(.025,.085);
    if(out.x<.03){out.x-=bleed;out.w+=bleed}
    else if(out.x+out.w>.97){out.w+=bleed}
    if(Math.random()<.55){
      if(out.y<.03){out.y-=bleed;out.h+=bleed}
      else if(out.y+out.h>.97){out.h+=bleed}
    }
  }
  return out;
}
function generateRandomGrid(){
  const zoneCount=Math.floor(rand(2,5));
  let zones=[{x:0,y:0,w:1,h:1}],guard=0;

  while(zones.length<zoneCount&&guard++<40){
    const idx=Math.floor(Math.random()*zones.length);
    const r=zones[idx];
    const ar=r.w/r.h;
    let vertical=ar>1.25?true:ar<.8?false:Math.random()<.5;
    const ratio=Math.random()<.55?pick([rand(.22,.36),rand(.64,.78)]):rand(.4,.6);
    const parts=splitRect(r,vertical,ratio);
    if(parts.some(p=>p.w<.16||p.h<.13))continue;
    zones.splice(idx,1,...parts);
  }

  const target=clamp(Math.round(Number(maxLayers.value)+rand(1,5)),5,14);
  let remaining=target;
  let cells=[];

  zones.forEach((z,zi)=>{
    const zonesLeft=zones.length-zi;
    const minForRest=zonesLeft-1;
    let n=zi===zones.length-1?remaining:clamp(Math.round(rand(1,Math.max(2,remaining-minForRest+1))),1,5);
    // Give some zones dense clusters and others very sparse hero areas.
    if(Math.random()<.35)n=1;
    else if(Math.random()<.45)n=clamp(n+2,2,6);
    n=Math.min(n,remaining-minForRest);
    remaining-=n;
    const local=subdivideZone(z,n).map(r=>decorateCell(r,zi));
    cells.push(...local);
  });

  // Add occasional large spanning pieces that borrow a neighboring zone edge.
  if(cells.length&&Math.random()<.7){
    const heroSource=pick(cells.filter(r=>rectArea(r)>.08)||cells);
    const growX=rand(.05,.18),growY=rand(.04,.16);
    const hero={
      x:clamp(heroSource.x-growX*(Math.random()<.5?1:0),-.08,.92),
      y:clamp(heroSource.y-growY*(Math.random()<.5?1:0),-.08,.92),
      w:clamp(heroSource.w+growX,.18,.82),
      h:clamp(heroSource.h+growY,.14,.72),
      zoneIndex:heroSource.zoneIndex,
      sizeClass:'xl',
      strip:false,
      spanning:true
    };
    cells.push(hero);
  }

  gridRects=cells.map((r,i)=>({...r,id:i}));
}
function chooseGridCell(mode='neutral'){
  if(!gridRects.length)generateRandomGrid();

  const occupied=new Set(visualLayers.filter(l=>l.releaseStart===null).map(l=>l.cellId));
  const inten=Number(intensity.value)/100;
  const pool=gridRects.map(r=>{
    const area=rectArea(r);
    let w=.18+Math.random()*.55;

    if(mode==='sharp'){
      w+=(1-clamp(area/.34,0,1))*2.8;
      if(r.strip)w+=2.2;
      if(r.sizeClass==='xs'||r.sizeClass==='s')w+=1.5;
      if(r.sizeClass==='xl')w*=.55;
    }else if(mode==='soft'){
      w+=clamp(area/.25,0,1)*3.0;
      if(r.sizeClass==='l'||r.sizeClass==='xl')w+=1.8;
      if(r.strip)w*=.62;
    }else{
      w+=.5+Math.abs(.12-area)*1.2;
    }

    // Higher intensity deliberately allows repeated use / overlap of occupied cells.
    if(!occupied.has(r.id))w*=1.2+(1-inten)*.8;
    else w*=.45+inten*1.45;
    if(r.spanning)w*=mode==='soft'?1.7:1.0;

    return {r,w:Math.max(.02,w)};
  });

  const total=pool.reduce((s,o)=>s+o.w,0);
  let p=Math.random()*total;
  for(const o of pool){p-=o.w;if(p<=0)return o.r}
  return pool[pool.length-1].r;
}
function computeCoverCrop(img,targetAspect,mode){
  const iw=img.naturalWidth,ih=img.naturalHeight;
  let sw=iw,sh=ih;
  if(iw/ih>targetAspect)sw=ih*targetAspect;
  else sh=iw/targetAspect;

  const extraZoom=mode==='sharp'?rand(1.10,1.85):mode==='soft'?rand(1.02,1.42):rand(1.05,1.55);
  sw/=extraZoom;sh/=extraZoom;
  sw=Math.min(iw,Math.max(24,sw));sh=Math.min(ih,Math.max(24,sh));

  const maxX=Math.max(0,iw-sw),maxY=Math.max(0,ih-sh);
  const biasX=rand(.08,.92),biasY=rand(.08,.92);
  return {sx:maxX*biasX,sy:maxY*biasY,sw,sh};
}
function releaseCell(cellId,mode,now){
  for(const l of visualLayers){
    if(l.cellId!==cellId||l.releaseStart!==null)continue;
    l.releaseStart=now;
    l.fadeOutMs=mode==='sharp'?0:Math.max(180,l.fadeOutMs);
  }
}
function spawnLayer(mode,s,now,kind='main'){
  if(!gridRects.length)generateRandomGrid();
  const baseCell=chooseGridCell(mode),style=transitionStyle.value,inten=Number(intensity.value)/100;

  // Create an axis-aligned display rect derived from the grid but with much wider scale range.
  // It may overlap neighboring cells, but it never rotates.
  const chaos=.35+inten*.95;
  let cell={...baseCell};

  if(Math.random()<.72*chaos){
    const growX=mode==='soft'?rand(.04,.28):rand(-.08,.18);
    const growY=mode==='soft'?rand(.04,.24):rand(-.08,.16);
    const anchorX=Math.random()<.5?0:1,anchorY=Math.random()<.5?0:1;
    if(growX>=0){
      if(anchorX===0){cell.x-=growX;cell.w+=growX}else cell.w+=growX;
    }else{
      const shrink=-growX;cell.x+=shrink*.5;cell.w-=shrink;
    }
    if(growY>=0){
      if(anchorY===0){cell.y-=growY;cell.h+=growY}else cell.h+=growY;
    }else{
      const shrink=-growY;cell.y+=shrink*.5;cell.h-=shrink;
    }
  }

  if(mode==='sharp'&&Math.random()<.40){
    // Tiny strip / shard, still perfectly horizontal or vertical.
    if(Math.random()<.5){
      cell.h=clamp(cell.h*rand(.18,.48),.035,.26);
    }else{
      cell.w=clamp(cell.w*rand(.18,.48),.045,.30);
    }
  }
  if(mode==='soft'&&Math.random()<.34){
    // Oversized hero piece.
    cell.w=clamp(cell.w*rand(1.25,2.15),.28,.92);
    cell.h=clamp(cell.h*rand(1.18,1.85),.22,.82);
  }

  cell.x=clamp(cell.x,-.12,.94);cell.y=clamp(cell.y,-.12,.96);
  cell.w=clamp(cell.w,.045,1.02);cell.h=clamp(cell.h,.035,.92);

  // Only some events replace an existing cell; many are allowed to stack.
  if(Math.random()>(.48+.38*inten))releaseCell(baseCell.id,mode,now);

  const imgIndex=randomImage(lastImageIndex),img=images[imgIndex].img;
  const W=canvas.width,H=canvas.height;

  // Each photo gets its own spacing; negative values intentionally create overlaps.
  const gapPx=rand(-18,42)*(0.55+inten*.9);
  const leftGap=rand(Math.min(-6,gapPx),Math.max(8,gapPx));
  const topGap=rand(Math.min(-6,gapPx),Math.max(8,gapPx));
  const rightGap=rand(Math.min(-6,gapPx),Math.max(8,gapPx));
  const bottomGap=rand(Math.min(-6,gapPx),Math.max(8,gapPx));

  const cellW=Math.max(18,W*cell.w-leftGap-rightGap),cellH=Math.max(18,H*cell.h-topGap-bottomGap);
  const targetAspect=cellW/cellH,crop=computeCoverCrop(img,targetAspect,mode);
  const sharp=mode==='sharp',soft=mode==='soft';

  let fadeInMs=sharp?0:soft?rand(130,440):rand(30,110);
  let life=sharp?rand(320,920):soft?rand(1150,3000):rand(700,1500);
  let fadeOutMs=sharp?0:soft?rand(240,760)*(1+Number(trail.value)/140):rand(60,220);
  if(style==='dynamic'){life*=.68;fadeInMs*=.65;fadeOutMs*=.65}
  if(style==='sparse'){life*=1.18;fadeInMs*=1.05;fadeOutMs*=1.12}

  visualLayers.push({
    imgIndex,mode,kind,cellId:baseCell.id,rect:cell,crop,
    gaps:{left:leftGap,top:topGap,right:rightGap,bottom:bottomGap},
    born:now,life,fadeInMs,fadeOutMs,releaseStart:null,spawnEnergy:s.energy,
    blurStart:(Number(blur.value)/100)*(sharp?1:soft?10:5)
  });

  const hardMax=Math.max(Number(maxLayers.value)+8,18);
  while(visualLayers.length>hardMax)visualLayers.shift();
}
function updateReleases(s,now){
  for(const l of visualLayers){
    if(l.releaseStart!==null)continue;
    const age=now-l.born;if(age<120)continue;
    const drop=l.spawnEnergy-s.energy;
    const fastDrop=drop>.08&&s.slope<-.018,softDrop=drop>.035&&s.slope<-.005;
    if(l.mode==='sharp'&&fastDrop){l.releaseStart=now;l.fadeOutMs=0}
    else if(l.mode==='soft'&&softDrop&&age>500){l.releaseStart=now;l.fadeOutMs=rand(320,850)*(1+Number(trail.value)/130)}
    else if(age>l.life){l.releaseStart=now}
  }
}
function updateEvents(s,now){
  const env=classifyEnvelope(s);
  const beatTh=Math.max(.020,beatFloor*.155),beatHit=s.onset>beatTh&&s.energy>beatFloor*1.015;
  const fxHit=s.highOnset>.030||(s.high>.34&&s.onset>.011),strong=s.low>.30&&s.onset>.015;
  const inten=Number(intensity.value)/100,style=transitionStyle.value;
  const activity=clamp((s.energy/(beatFloor+.001)-.75)*.9+s.high*.55+s.onset*7,0,1.8);
  const minGap=style==='dynamic'?55:style==='sparse'?180:95;

  function burst(mode,count,kind='main'){
    for(let i=0;i<count;i++)spawnLayer(mode,s,now+i*.01,kind);
  }

  if(now-lastSpawn>minGap){
    if(fxHit){
      const n=Math.max(1,Math.min(4,Math.round(1+inten*1.8+activity*.8+Math.random())));
      burst('sharp',n,'accent');
      lastSpawn=now;
      flashAlpha=Math.max(flashAlpha,.006+.012*inten);
    }else if(beatHit||strong){
      const baseMode=env==='soft'?'soft':'sharp';
      const n=Math.max(1,Math.min(3,Math.round(1+inten*.9+activity*.55)));
      burst(baseMode,n,'main');
      lastSpawn=now;
    }else if(env==='soft'&&s.energy>beatFloor*.88&&Math.random()<.065+.09*inten){
      burst('soft',Math.random()<.28+inten*.25?2:1,'main');
      lastSpawn=now;
    }
  }

  if(!visualLayers.length&&images.length){
    burst(env==='sharp'?'sharp':'soft',2,'main');lastSpawn=now;
  }

  updateReleases(s,now);
  return {beatHit,fxHit,strong,env,activity};
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
function drawGalleryPiece(layer,now,s){
  const img=images[layer.imgIndex].img,W=canvas.width,H=canvas.height;
  const a=layerAlpha(layer,now);if(a<=.001)return;
  const r=layer.rect,g=layer.gaps||{left:12,top:12,right:12,bottom:12};
  const dx=W*r.x+g.left,dy=H*r.y+g.top,dw=Math.max(2,W*r.w-g.left-g.right),dh=Math.max(2,H*r.h-g.top-g.bottom);
  const age=now-layer.born,blurPx=layer.blurStart*(1-clamp(age/Math.max(80,layer.fadeInMs||100),0,1));
  const attack=Math.min(1,s.onset*10+s.highOnset*6);
  const br=1+(Number(bright.value)/100)*(s.high*.10-s.low*.025+attack*.018);
  const c=layer.crop;

  ctx.save();
  ctx.globalAlpha=a;
  ctx.filter='brightness('+br.toFixed(3)+')'+(blurPx>.1?' blur('+blurPx.toFixed(1)+'px)':'');
  ctx.shadowColor='rgba(0,0,0,.10)';ctx.shadowBlur=10;ctx.shadowOffsetY=2;
  ctx.drawImage(img,c.sx,c.sy,c.sw,c.sh,dx,dy,dw,dh);
  ctx.restore();
}
function renderLayers(now,s){
  const W=canvas.width,H=canvas.height;
  ctx.save();ctx.globalAlpha=1;ctx.filter='none';ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.restore();

  visualLayers=visualLayers.filter(l=>{
    if(l.releaseStart===null)return now-l.born<l.life+2500;
    return now-l.releaseStart<Math.max(20,l.fadeOutMs+40);
  });
  for(const l of visualLayers)drawGalleryPiece(l,now,s);

  if(flashAlpha>.002){
    ctx.fillStyle='rgba(255,255,255,'+flashAlpha.toFixed(3)+')';
    ctx.fillRect(0,0,W,H);flashAlpha*=.62;
  }
}
function drawFrame(now){
  if(!previewing||!analyser||!images.length)return;
  const s=spectrum(now),ev=updateEvents(s,now);renderLayers(now,s);
  const elapsed=audioEl?audioEl.currentTime-selectedStart:0;
  hud.textContent=fmt(Math.max(0,elapsed))+' / 00:30 · '+ev.env.toUpperCase()+' · LOW '+Math.round(s.low*100)+' MID '+Math.round(s.mid*100)+' HIGH '+Math.round(s.high*100)+(ev.beatHit?' · BEAT':'')+(ev.fxHit?' · FX':'')+' · CHAOS '+Math.round((ev.activity||0)*100);
  if(audioEl&&audioEl.currentTime>=selectedStart+selectedDuration-.03){stopAll(true);return}
  raf=requestAnimationFrame(drawFrame);
}
async function startPreview(doRecord=false){
  if(previewing)stopAll(false);
  await ensurePlaybackAudio();
  visualLayers=[];gridRects=[];lastEnergy=0;lastHigh=0;beatFloor=.08;lastSpawn=0;flashAlpha=0;energyHistory=[];lastImageIndex=-1;generateRandomGrid();
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
  intensity.value=Math.round(rand(68,100));maxLayers.value=Math.round(rand(7,14));zoom.value=Math.round(rand(18,58));shake.value=Math.round(rand(1,14));
  bright.value=Math.round(rand(10,38));trail.value=Math.round(rand(8,42));blur.value=Math.round(rand(0,38));
  transitionStyle.value=['soft','dynamic','sparse'][Math.floor(Math.random()*3)];updateLabels();
};
canvas.width=1080;canvas.height=1920;ready();