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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const accessKey = String(req.query.key || '');
  if (!process.env.DAILY_ACCESS_KEY || accessKey !== process.env.DAILY_ACCESS_KEY) {
    return res.status(401).send('Unauthorized');
  }

  const date = String(req.query.date || tokyoDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).send('Invalid date');

  try {
    const prefix = 'daily/' + date + '/';
    const result = await list({ prefix, limit: 100 });
    const slots = [
      { id: '0600', label: 'MORNING · 06:00' },
      { id: '1200', label: 'NOON · 12:00' },
      { id: '1600', label: 'AFTERNOON · 16:00' },
    ];
    const tracks = ['A', 'B', 'C'];
    const found = new Map();

    for (const blob of result.blobs.filter(b => b.pathname.endsWith('.wav'))) {
      const name = blob.pathname.split('/').pop() || '';
      const slotMatch = blob.pathname.match(/\/daily\/[^/]+\/(0600|1200|1600)\//) || name.match(/_(0600|1200|1600)_/);
      if (!slotMatch) continue;
      const letterMatch = name.match(/_([ABC])(?:_|\.)/i);
      if (!letterMatch) continue;
      const slot = slotMatch[1];
      const track = letterMatch[1].toUpperCase();
      const validUntil = Date.now() + 24 * 60 * 60 * 1000;
      const token = await issueSignedToken({ pathname: blob.pathname, operations: ['get'], validUntil });
      const signed = await presignUrl(token, {
        operation: 'get',
        pathname: blob.pathname,
        access: 'private',
        validUntil
      });
      found.set(slot + ':' + track, {
        name,
        url: signed.presignedUrl,
        uploadedAt: blob.uploadedAt || null
      });
    }

    const keyQ = encodeURIComponent(accessKey);
    const prev = addDays(date, -1);
    const next = addDays(date, 1);
    const today = tokyoDate();

    const sections = slots.map(slot => {
      const rows = tracks.map(track => {
        const item = found.get(slot.id + ':' + track);
        if (!item) {
          return `<div class="track pending"><div class="trackTop"><strong>${track}</strong><span>not generated yet</span></div></div>`;
        }
        return `<div class="track">
          <div class="trackTop"><strong>${track}</strong><span>${esc(item.name)}</span></div>
          <audio controls preload="none" src="${esc(item.url)}"></audio>
          <a class="download" href="${esc(item.url)}">OPEN / DOWNLOAD WAV</a>
        </div>`;
      }).join('');
      const count = tracks.filter(track => found.has(slot.id + ':' + track)).length;
      return `<section class="slot"><div class="slotHead"><h2>${slot.label}</h2><span>${count}/3</span></div><div class="tracks">${rows}</div></section>`;
    }).join('');

    const total = [...found.keys()].length;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    return res.status(200).send(`<!doctype html>
<html lang="ja">
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#090909">
<title>FeLid Daily Tracks Inbox</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#090909;color:#f2f2f2;margin:0;padding:22px 16px 48px}.wrap{max-width:780px;margin:auto}header{margin-bottom:24px}h1{font-size:23px;margin:0 0 7px}.meta{color:#999;font-size:13px}.count{color:#dfffb5}.nav{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:center;margin:18px 0 26px}.nav a{color:#ddd;text-decoration:none;border:1px solid #333;padding:10px 12px;border-radius:9px;background:#111}.nav a:last-child{text-align:right}.nav .date{text-align:center;font-size:14px;font-weight:700}.slot{border-top:1px solid #292929;padding:18px 0 8px}.slotHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.slotHead h2{font-size:14px;letter-spacing:.08em;margin:0;color:#cfcfcf}.slotHead span{font-size:12px;color:#777}.tracks{display:grid;gap:10px}.track{background:#111;border:1px solid #292929;border-radius:12px;padding:13px}.trackTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:10px}.trackTop strong{font-size:20px;color:#e8ffc8}.trackTop span{font-size:11px;color:#888;text-align:right;word-break:break-all}.track audio{width:100%;height:38px}.download{display:inline-block;margin-top:9px;color:#bddd97;font-size:11px;text-decoration:none}.pending{min-height:58px;opacity:.5}.pending .trackTop{margin:0}.foot{color:#666;font-size:11px;margin-top:22px;line-height:1.5}@media(min-width:700px){body{padding-top:38px}.tracks{grid-template-columns:repeat(3,1fr)}.trackTop{display:block}.trackTop span{display:block;text-align:left;margin-top:4px;min-height:30px}}
</style>
</head>
<body><div class="wrap">
<header><h1>FeLid Daily Tracks Inbox</h1><div class="meta">${esc(date)} · <span class="count">${total}/9 tracks ready</span> · private archive</div></header>
<div class="nav">
<a href="/inbox?key=${keyQ}&date=${prev}">← PREV</a>
<div class="date">${esc(date)}</div>
<a href="/inbox?key=${keyQ}&date=${next}">NEXT →</a>
</div>
${sections}
<div class="foot">06:00 / 12:00 / 16:00 に各3曲を自動生成。夜、このページを開くだけで当日の9曲を確認できます。WAVへの署名URLはページを開いた時点から24時間有効です。</div>
</div></body></html>`);
  } catch (e) {
    console.error(e);
    return res.status(500).send('Archive lookup failed');
  }
}
