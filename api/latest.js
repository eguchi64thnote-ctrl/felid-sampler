import { listArchive, signedArchiveUrl } from '../lib/daily-storage.js';

function tokyoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.DAILY_ACCESS_KEY || String(req.query.key || '') !== process.env.DAILY_ACCESS_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.setHeader('Cache-Control', 'no-store');

  const date = String(req.query.date || tokyoDate());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });

  try {
    // "legacy=1&all=1" is used by the authenticated, manual Blob-to-R2 migration.
    const { blobs, unavailable } = await listArchive('daily/' + date + '/', {
      only: req.query.legacy === '1' ? 'blob' : undefined,
    });
    const includeMetadata = req.query.all === '1';
    const matches = blobs
      .filter(b => includeMetadata || /\.(?:mp3|wav)$/i.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));
    const files = [];
    for (const file of matches) {
      const url = await signedArchiveUrl(file);
      files.push({
        name: file.pathname.split('/').pop(),
        pathname: file.pathname,
        size: file.size,
        source: file.source,
        url,
      });
    }
    return res.status(200).json({ date, count: new Set(files.filter(f => /\.(?:mp3|wav)$/i.test(f.name)).map(f => f.pathname.replace(/\.(?:mp3|wav)$/i, ''))).size, files, unavailable });
  } catch (error) {
    console.error('Daily tracks lookup failed:', error);
    return res.status(503).json({ error: 'Archive storage temporarily unavailable' });
  }
}
