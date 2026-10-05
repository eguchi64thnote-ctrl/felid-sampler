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
    const result=await list({prefix,limit:30});
    const wavs=result.blobs.filter(b=>b.pathname.endsWith('.wav')).sort((a,b)=>a.pathname.localeCompare(b.pathname));
    const items=[];
    for(const blob of wavs){
      const validUntil=Date.now()+24*60*60*1000;
      const token=await issueSignedToken({pathname:blob.pathname,operations:['get'],validUntil});
      const signed=await presignUrl(token,{operation:'get',pathname:blob.pathname,access:'private',validUntil});
      items.push({name:blob.pathname.split('/').pop(),url:signed.presignedUrl});
    }
    const cards=items.length?items.map((x,i)=>`<a class="card" href="${esc(x.url)}"><strong>${String.fromCharCode(65+i)} WAV</strong><span>${esc(x.name)}</span></a>`).join(''):`<div class="empty">まだ今日のトラックはありません。生成処理が完了するとここに表示されます。</div>`;
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('cache-control','no-store');
    return res.status(200).send(`<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FeLid Daily Tracks</title><style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#eee;margin:0;padding:28px;max-width:720px}h1{font-size:22px}p{color:#aaa}.grid{display:grid;gap:10px;margin-top:22px}.card{display:flex;justify-content:space-between;gap:18px;padding:16px;border:1px solid #333;color:#eefbdc;text-decoration:none;background:#101010}.card span{color:#aaa;font-size:12px;text-align:right}.empty{padding:20px;border:1px solid #333;color:#aaa}</style><h1>FeLid Daily Tracks</h1><p>${esc(date)} · 44.1kHz / 16bit WAV · target -10 LUFS / peak -1 dB</p><div class="grid">${cards}</div></html>`);
  }catch(e){console.error(e);return res.status(500).send('Archive lookup failed')}
}
