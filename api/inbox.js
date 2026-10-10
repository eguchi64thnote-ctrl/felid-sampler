import { listArchive, signedArchiveUrl } from '../lib/daily-storage.js';

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function addDays(date, days) {
  const d = new Date(date + 'T12:00:00+09:00');
  d.setUTCDate(d.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}
function shell(body,title='FeLid Daily Tracks Inbox'){
  return `<!doctype html><html lang="ja"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090909"><title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#090909;color:#f2f2f2;margin:0;padding:22px 16px 48px}.wrap{max-width:820px;margin:auto}a{color:inherit}header{margin-bottom:24px}h1{font-size:23px;margin:0 0 7px}.meta{color:#999;font-size:13px}.accent{color:#dfffb5}.toolbar{display:flex;gap:8px;align-items:center;margin:18px 0 26px;flex-wrap:wrap}.button{display:inline-block;color:#ddd;text-decoration:none;border:1px solid #333;padding:10px 12px;border-radius:9px;background:#111;font-size:13px}.days{display:grid;gap:10px}.day{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px;border:1px solid #292929;border-radius:12px;background:#111;text-decoration:none}.day:hover{border-color:#555}.dayDate{font-size:17px;font-weight:700}.dayMeta{font-size:12px;color:#888;text-align:right}.ready{color:#dfffb5}.slot{border-top:1px solid #292929;padding:18px 0 8px}.slotHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.slotHead h2{font-size:14px;letter-spacing:.08em;margin:0;color:#cfcfcf}.slotHead span{font-size:12px;color:#777}.tracks{display:grid;gap:10px}.track{background:#111;border:1px solid #292929;border-radius:12px;padding:13px}.trackTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.trackTop strong{font-size:20px;color:#e8ffc8}.trackTop span{font-size:11px;color:#888;text-align:right;word-break:break-all}.track audio{width:100%;height:38px}.download{display:inline-block;margin-top:9px;margin-right:10px;color:#bddd97;font-size:11px;text-decoration:none}.help{font-size:11px;color:#aaa;line-height:1.5;margin-top:8px}.wavHelp{font-size:12px;color:#c8c8c8;line-height:1.65;margin:16px 0;background:#151515;border:1px solid #333;border-radius:10px;padding:13px}.pending{min-height:58px;opacity:.5}.pending .trackTop{margin:0}.empty{padding:22px;border:1px solid #292929;border-radius:12px;color:#777;background:#111}.foot{color:#666;font-size:11px;margin-top:22px;line-height:1.5}@media(min-width:700px){body{padding-top:38px}.days{grid-template-columns:repeat(2,1fr)}.tracks{grid-template-columns:repeat(3,1fr)}.trackTop{display:block}.trackTop span{display:block;text-align:left;margin-top:4px;min-height:30px}}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const accessKey = String(req.query.key || '');
  if (!process.env.DAILY_ACCESS_KEY || accessKey !== process.env.DAILY_ACCESS_KEY) {
    return res.status(401).send('Unauthorized');
  }

  const dateParam = req.query.date ? String(req.query.date) : '';
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return res.status(400).send('Invalid date');

  try {
    const keyQ=encodeURIComponent(accessKey);

    // Archive home: date folders, newest first.
    if (!dateParam) {
      const { blobs: all, unavailable } = await listArchive('daily/');
      const days=new Map();
      for(const blob of all){
        const m=blob.pathname.match(/^daily\/(\d{4}-\d{2}-\d{2})\//);
        if(!m)continue;
        const date=m[1];
        if(!days.has(date))days.set(date,{tracks:new Set(),files:0,bytes:0});
        const d=days.get(date);
        d.files++;
        d.bytes+=Number(blob.size||0);
        if(/\.(?:mp3|wav)$/i.test(blob.pathname)) {
          const slot=blob.pathname.match(/\/(0600|1200|1600)\//)?.[1];
          const name=blob.pathname.split('/').pop()||'';
          const profile=['AmbientSpace','GrooveRhythm','ExperimentalMutation'].find(p=>name.includes('_'+p+'_')) ||
            (name.match(/_([ABC])(?:_|\.)/i)?.[1]?.toUpperCase() || '');
          if(slot&&profile)d.tracks.add(slot+':'+profile);
        }
      }
      const sorted=[...days.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
      const cards=sorted.length?sorted.map(([date,d])=>{
        const mb=d.bytes/1e6;
        return `<a class="day" href="/inbox?key=${keyQ}&date=${date}">
          <div><div class="dayDate">${esc(date)}</div><div class="meta">Daily Tracks archive</div></div>
          <div class="dayMeta"><span class="${d.tracks.size>=9?'ready':''}">${d.tracks.size}/9 tracks</span><br>${mb.toFixed(1)} MB stored</div>
        </a>`;
      }).join(''):'<div class="empty">まだDaily Tracksのアーカイブはありません。</div>';
      res.setHeader('content-type','text/html; charset=utf-8');
      res.setHeader('cache-control','no-store');
      return res.status(200).send(shell(`
        <header><h1>FeLid Daily Tracks Inbox</h1><div class="meta">Archive · <span class="accent">${sorted.length} day${sorted.length===1?'':'s'}</span> · private</div></header>
        <div class="toolbar"><a class="button" href="/inbox?key=${keyQ}&date=${tokyoDate()}">TODAY</a><a class="button" href="/video-lab">VIDEO LAB</a></div>
        <div class="days">${cards}</div>
        ${unavailable.length ? '<div class="foot">一部の旧アーカイブを現在取得できません。復旧後に再表示されます。</div>' : ''}
        <div class="foot">既存WAVはバックアップ確認前に削除しません。今後の新作は試聴用MP3を日付別に保存し、WAVは生成後約24時間以内に暗号化ファイルから保存できます。</div>
      `));
    }

    const date=dateParam;
    const { blobs, unavailable }=await listArchive('daily/'+date+'/');
    const slotOrder=['0600','1200','1600'];
    const profileOrder=['AmbientSpace','GrooveRhythm','ExperimentalMutation'];
    const profileLetter={AmbientSpace:'A',GrooveRhythm:'B',ExperimentalMutation:'C'};
    const found=new Map();
    const accessMap=new Map();

    // WAV decryption keys live in private Blob metadata. Never put a plaintext
    // WAV in a GitHub artifact: this GitHub repository is public.
    for(const meta of blobs.filter(b=>b.pathname.endsWith('_wav-access.json'))){
      try {
        const metaUrl=await signedArchiveUrl(meta);
        const response=await fetch(metaUrl,{cache:'no-store'});
        if(!response.ok)throw new Error('Access metadata response '+response.status);
        const info=await response.json();
        if(!/^\d+$/.test(String(info.runId||''))||!Array.isArray(info.files))continue;
        for(const e of info.files){
          if(typeof e.wavName !== 'string'||!/^[-.\w]+\.wav$/i.test(e.wavName))continue;
          if(!/^[0-9a-f]{32}\.wav\.enc$/.test(String(e.encryptedName||'')))continue;
          if(!/^[A-Za-z0-9_-]{43}$/.test(String(e.key||'')))continue;
          accessMap.set(e.wavName,{...e,runId:info.runId,artifactName:info.artifactName});
        }
      }catch(error){
        console.error('Encrypted WAV access metadata unavailable:',meta.pathname,error);
      }
    }

    for(const blob of blobs.filter(b=>/\.(?:wav|mp3)$/i.test(b.pathname))){
      const name=blob.pathname.split('/').pop()||'';
      const slotMatch=blob.pathname.match(/^daily\/[^/]+\/(0600|1200|1600)\//)||name.match(/_(0600|1200|1600)_/);
      if(!slotMatch)continue;
      let profile=profileOrder.find(p=>name.includes('_'+p+'_'));
      let letter=profile?profileLetter[profile]:null;
      if(!letter){
        const legacy=name.match(/_([ABC])(?:_|\.)/i);
        if(legacy){letter=legacy[1].toUpperCase();profile=letter==='A'?'AmbientSpace':letter==='B'?'GrooveRhythm':'ExperimentalMutation'}
      }
      if(!letter||!profile)continue;
      const slot=slotMatch[1], id=slot+':'+letter;
      try{
        const url=await signedArchiveUrl(blob);
        const item=found.get(id)||{slot,letter,profile};
        if(name.toLowerCase().endsWith('.mp3')){
          item.mp3={name,url};
        }else{
          item.wav={name,url};
        }
        found.set(id,item);
      }catch(error){
        console.error('Could not sign archived track:',blob.pathname,error);
        if(!unavailable.includes(blob.source))unavailable.push(blob.source);
      }
    }

    const rows=[];
    for(const slot of slotOrder){
      for(const profile of profileOrder){
        const letter=profileLetter[profile],item=found.get(slot+':'+letter);
        if(!item)continue;
        const player=item.mp3||item.wav;
        const originalName=item.wav?.name||(item.mp3?.name.replace(/\.mp3$/i,'.wav')||'');
        const access=accessMap.get(originalName);
        let wavActions='';
        if(item.wav){
          wavActions='<a class="download" href="'+esc(item.wav.url)+'" download>WAVをMacに保存</a>';
        }else if(access){
          const runUrl='https://github.com/eguchi64thnote-ctrl/felid-sampler/actions/runs/'+access.runId;
          const restore='/wav-restore.html#'+
            'name='+encodeURIComponent(access.wavName)+'&'+
            'file='+encodeURIComponent(access.encryptedName)+'&'+
            'key='+encodeURIComponent(access.key);
          wavActions='<div class="help">WAVは約24時間だけ保存可能（GitHubログインが必要）</div>'+
            '<a class="download" target="_blank" rel="noopener" href="'+esc(runUrl)+'">① WAV暗号化ZIPを入手</a>'+
            '<a class="download" href="'+esc(restore)+'">② WAVを復元して保存</a>'+
            '<div class="help">ZIPを解凍し、「'+esc(access.encryptedName)+'」を復元ページで選択してください。</div>';
        }else if(item.mp3){
          wavActions='<div class="help">このトラックのWAV一時保存期限は終了したか、未登録です。試聴用MP3は引き続き利用できます。</div>';
        }
        rows.push('<div class="track"><div class="trackTop"><strong>'+esc(profile)+'</strong><span>'+esc(player.name)+'</span></div>'+
          '<audio controls preload="none" src="'+esc(player.url)+'"></audio>'+
          (item.mp3?'<a class="download" href="'+esc(item.mp3.url)+'" download>試聴用MP3を保存</a>':'')+
          wavActions+'</div>');
      }
    }
    const sections=rows.length?'<div class="tracks">'+rows.join('')+'</div>':'<div class="empty">まだこの日のトラックはありません。</div>';
    const total=[...found.keys()].length;
    const prev=addDays(date,-1),next=addDays(date,1);
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.status(200).send(shell(`
      <header><h1>FeLid Daily Tracks Inbox</h1><div class="meta">${esc(date)} · <span class="accent">${total}/9 tracks ready</span> · private archive</div></header>
      <div class="toolbar">
        <a class="button" href="/inbox?key=${keyQ}">← ALL DATES</a>
        <a class="button" href="/video-lab">VIDEO LAB</a>
        <a class="button" href="/inbox?key=${keyQ}&date=${prev}">PREV</a>
        <a class="button" href="/inbox?key=${keyQ}&date=${next}">NEXT</a>
      </div>
      <div class="wavHelp">【WAVの保存】新しい曲は「① 暗号化ZIPを入手」→ ZIPを解凍 →「② WAVを復元して保存」の順に操作してください。暗号化WAVの一時保管は約24時間です。旧WAVは引き続き直接保存できます。鍵はこの非公開ページから開く復元画面だけで使用します。</div>
      ${sections}
      ${unavailable.length ? '<div class="foot">一部の旧アーカイブはストレージの利用制限により現在表示できません。</div>' : ''}
      <div class="foot">06:00 / 12:00 / 16:00 に各3曲を自動生成。1日9曲を日付単位でまとめて表示します。今後の試聴用MP3を長期保存し、新規WAVは暗号化した一時ファイルからMacに保存します。旧WAVはバックアップを確認するまで削除しません。試聴URLは約6時間有効です。</div>
    `));
  } catch(e) {
    console.error(e);
    return res.status(503).send('Archive storage is temporarily unavailable');
  }
}
