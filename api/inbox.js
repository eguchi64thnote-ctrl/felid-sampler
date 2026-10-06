import { list, issueSignedToken, presignUrl } from '@vercel/blob';

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  if (!process.env.DAILY_ACCESS_KEY || req.query.key !== process.env.DAILY_ACCESS_KEY) return res.status(401).send('Unauthorized');
  const date=String(req.query.date||tokyoDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).send('Invalid date');
  try{
    const prefix='daily/'+date+'/';
    const result=await list({prefix,limit:100});
    const profiles=['AmbientSpace','GrooveRhythm','ExperimentalMutation'];
    const slotOrder={0600:0,1200:1,1600:2};
    const items=[];

    for(const blob of result.blobs.filter(b=>b.pathname.endsWith('.wav'))){
      const name=blob.pathname.split('/').pop();
      const slotMatch=blob.pathname.match(/\/daily\/[^/]+\/(0600|1200|1600)\//) || name.match(/^\d{6}_(0600|1200|1600)_/);
      if(!slotMatch)continue;
      const slot=slotMatch[1];
      const profile=profiles.find(p=>name.includes('_'+p+'_'));
      if(!profile)continue;
      items.push({blob,name,slot,profile,uploadedAt:new Date(blob.uploadedAt||0).getTime()});
    }

    items.sort((a,b)=>(slotOrder[a.slot]-slotOrder[b.slot])||(profiles.indexOf(a.profile)-profiles.indexOf(b.profile))||(a.uploadedAt-b.uploadedAt));

    const signedItems=[];
    for(const found of items){
      const validUntil=Date.now()+24*60*60*1000;
      const token=await issueSignedToken({pathname:found.blob.pathname,operations:['get'],validUntil});
      const signed=await presignUrl(token,{operation:'get',pathname:found.blob.pathname,access:'private',validUntil});
      signedItems.push({...found,url:signed.presignedUrl});
    }

    const cards=signedItems.length?signedItems.map(x=>`<a class="card" href="${esc(x.url)}"><strong>${esc(x.profile)}</strong><span>${esc(x.name)}</span></a>`).join(''):`<div class="empty">まだこの日のトラックはありません。</div>`;
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.status(200).send(`<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FeLid Daily Tracks</title><style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#eee;margin:0;padding:28px;max-width:720px}h1{font-size:22px}p{color:#aaa}.grid{display:grid;gap:10px;margin-top:22px}.card{display:flex;justify-content:space-between;gap:18px;padding:16px;border:1px solid #333;color:#eefbdc;text-decoration:none;background:#101010}.card span{color:#aaa;font-size:12px;text-align:right}.empty{padding:20px;border:1px solid #333;color:#777}</style><h1>FeLid Daily Tracks</h1><p>${esc(date)} · 9 tracks/day · 44.1kHz / 16bit WAV · target -10 LUFS / peak -1 dB</p><div class="grid">${cards}</div></html>`);
  }catch(e){console.error(e);return res.status(500).send('Archive lookup failed')}
}
