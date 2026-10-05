import { list, issueSignedToken, presignUrl } from '@vercel/blob';

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.DAILY_ACCESS_KEY || req.query.key !== process.env.DAILY_ACCESS_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const date = String(req.query.date || tokyoDate());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
    const prefix = 'daily/' + date + '/';
    const result = await list({ prefix, limit: 30 });
    const wavs = result.blobs.filter(b => b.pathname.endsWith('.wav')).sort((a,b)=>a.pathname.localeCompare(b.pathname));
    const files = [];
    for (const blob of wavs) {
      const validUntil = Date.now() + 24 * 60 * 60 * 1000;
      const token = await issueSignedToken({ pathname: blob.pathname, operations: ['get'], validUntil });
      const signed = await presignUrl(token, {
        operation: 'get', pathname: blob.pathname, access: 'private', validUntil
      });
      files.push({ name: blob.pathname.split('/').pop(), pathname: blob.pathname, url: signed.presignedUrl });
    }
    return res.status(200).json({ date, count: files.length, files });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Archive lookup failed' });
  }
}
