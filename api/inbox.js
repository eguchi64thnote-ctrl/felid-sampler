import { list, issueSignedToken, presignUrl } from '@vercel/blob';

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
async function listAll(prefix) {
  const blobs=[];
  let cursor;
  do {
    const page=await list({prefix,limit:1000,cursor});
    blobs.push(...page.blobs);
    cursor=page.cursor;
  } while(cursor);
  return blobs;
}
function shell(body,title='FeLid Daily Tracks Inbox'){
  return `<!doctype html><html lang="ja"><head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090909"><title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#090909;color:#f2f2f2;margin:0;padding:22px 16px 48px}.wrap{max-width:820px;margin:auto}a{color:inherit}header{margin-bottom:24px}h1{font-size:23px;margin:0 0 7px}.meta{color:#999;font-size:13px}.accent{color:#dfffb5}.toolbar{display:flex;gap:8px;align-items:center;margin:18px 0 26px;flex-wrap:wrap}.button{display:inline-block;color:#ddd;text-decoration:none;border:1px solid #333;padding:10px 12px;border-radius:9px;background:#111;font-size:13px}.days{display:grid;gap:10px}.day{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:16px;border:1px solid #292929;border-radius:12px;background:#111;text-decoration:none}.day:hover{border-color:#555}.dayDate{font-size:17px;font-weight:700}.dayMeta{font-size:12px;color:#888;text-align:right}.ready{color:#dfffb5}.slot{border-top:1px solid #292929;padding:18px 0 8px}.slotHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.slotHead h2{font-size:14px;letter-spacing:.08em;margin:0;color:#cfcfcf}.slotHead span{font-size:12px;color:#777}.tracks{display:grid;gap:10px}.track{background:#111;border:1px solid #292929;border-radius:12px;padding:13px}.trackTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.trackTop strong{font-size:20px;color:#e8ffc8}.trackTop span{font-size:11px;color:#888;text-align:right;word-break:break-all}.track audio{width:100%;height:38px}.download{display:inline-block;margin-top:9px;color:#bddd97;font-size:11px;text-decoration:none}.pending{min-height:58px;opacity:.5}.pending .trackTop{margin:0}.empty{padding:22px;border:1px solid #292929;border-radius:12px;color:#777;background:#111}.foot{color:#666;font-size:11px;margin-top:22px;line-height:1.5}@media(min-width:700px){body{padding-top:38px}.days{grid-template-columns:repeat(2,1fr)}.tracks{grid-template-columns:repeat(3,1fr)}.trackTop{display:block}.trackTop span{display:block;text-align:left;margin-top:4px;min-height:30px}}
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
      const all=await listAll('daily/');
      const days=new Map();
      for(const blob of all){
        const m=blob.pathname.match(/^daily\/(\d{4}-\d{2}-\d{2})\//);
        if(!m)continue;
        const date=m[1];
        if(!days.has(date))days.set(date,{wavs:0,files:0,bytes:0});
        const d=days.get(date);
        d.files++;
        d.bytes+=Number(blob.size||0);
        if(blob.pathname.endsWith('.wav'))d.wavs++;
      }
      const sorted=[...days.entries()].sort((a,b)=>b[0].localeCompare(a[0]));
      const cards=sorted.length?sorted.map(([date,d])=>{
        const mb=d.bytes/1e6;
        return `<a class="day" href="/inbox?key=${keyQ}&date=${date}">
          <div><div class="dayDate">${esc(date)}</div><div class="meta">Daily Tracks archive</div></div>
          <div class="dayMeta"><span class="${d.wavs>=9?'ready':''}">${d.wavs}/9 tracks</span><br>${mb.toFixed(1)} MB stored</div>
        </a>`;
      }).join(''):'<div class="empty">まだDaily Tracksのアーカイブはありません。</div>';
      res.setHeader('content-type','text/html; charset=utf-8');
      res.setHeader('cache-control','no-store');
      return res.status(200).send(shell(`
        <header><h1>FeLid Daily Tracks Inbox</h1><div class="meta">Archive · <span class="accent">${sorted.length} day${sorted.length===1?'':'s'}</span> · private</div></header>
        <div class="toolbar"><a class="button" href="/inbox?key=${keyQ}&date=${tokyoDate()}">TODAY</a><a class="button" href="/video-lab">VIDEO LAB</a></div>
        <div class="days">${cards}</div>
        <div class="foot">過去ファイルは自動削除しません。日付をタップすると、その日の06:00 / 12:00 / 16:00に生成されたA・B・Cを確認できます。</div>
      `));
    }

    const date=dateParam;
    const blobs=await listAll('daily/'+date+'/');
    const slotOrder=['0600','1200','1600'];
    const profileOrder=['AmbientSpace','GrooveRhythm','ExperimentalMutation'];
    const profileLetter={AmbientSpace:'A',GrooveRhythm:'B',ExperimentalMutation:'C'};
    const found=new Map();

    for(const blob of blobs.filter(b=>b.pathname.endsWith('.wav'))){
      const name=blob.pathname.split('/').pop()||'';
      const slotMatch=blob.pathname.match(/\/daily\/[^/]+\/(0600|1200|1600)\//)||name.match(/_(0600|1200|1600)_/);
      if(!slotMatch)continue;
      let profile=profileOrder.find(p=>name.includes('_'+p+'_'));
      let letter=profile?profileLetter[profile]:null;
      if(!letter){
        const legacy=name.match(/_([ABC])(?:_|\.)/i);
        if(legacy){letter=legacy[1].toUpperCase();profile=letter==='A'?'AmbientSpace':letter==='B'?'GrooveRhythm':'ExperimentalMutation'}
      }
      if(!letter||!profile)continue;
      const slot=slotMatch[1],validUntil=Date.now()+24*60*60*1000;
      const token=await issueSignedToken({pathname:blob.pathname,operations:['get'],validUntil});
      const signed=await presignUrl(token,{operation:'get',pathname:blob.pathname,access:'private',validUntil});
      found.set(slot+':'+letter,{name,url:signed.presignedUrl,slot,letter,profile});
    }

    const rows=[];
    for(const slot of slotOrder){
      for(const profile of profileOrder){
        const letter=profileLetter[profile],item=found.get(slot+':'+letter);
        if(!item)continue;
        rows.push(`<div class="track"><div class="trackTop"><strong>${esc(profile)}</strong><span>${esc(item.name)}</span></div>
          <audio controls preload="none" src="${esc(item.url)}"></audio>
          <a class="download" href="${esc(item.url)}">OPEN / DOWNLOAD WAV</a></div>`);
      }
    }
    const sections=rows.length?`<div class="tracks">${rows.join('')}</div>`:`<div class="empty">まだこの日のトラックはありません。</div>`;
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
      ${sections}
      <div class="foot">06:00 / 12:00 / 16:00 に各3曲を自動生成。1日9曲を日付単位でまとめて表示します。WAVはこの日付アーカイブに残り続けます。署名URLはページを開いた時点から24時間有効です。</div>
    `));
  } catch(e) {
    console.error(e);
    return res.status(500).send('Archive lookup failed');
  }
}
