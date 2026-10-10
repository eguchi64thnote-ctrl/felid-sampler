// One-time, non-destructive archive migration. Never deletes legacy Blob files.
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'DAILY_ACCESS_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error('Missing required secret: ' + key);
}

const baseUrl = process.env.DAILY_BASE_URL || 'https://karesansui-in-the-air-gnr-mhver.vercel.app';
const begin = process.env.MIGRATE_FROM || '2026-10-06';
const end = process.env.MIGRATE_THROUGH || new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date ' + s);
  const d = new Date(s + 'T00:00:00Z');
  if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error('Invalid date ' + s);
  }
  return d;
}

const d0 = validDate(begin), d1 = validDate(end);
if (d0 > d1) throw new Error('MIGRATE_FROM must not be after MIGRATE_THROUGH');
const r2 = new S3Client({
  region: 'auto',
  endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const bucket = process.env.R2_BUCKET_NAME;
let copied = 0, skipped = 0, dates = 0;

for (let day = d0; day <= d1; day.setUTCDate(day.getUTCDate() + 1)) {
  const date = day.toISOString().slice(0, 10);
  const url = new URL('/api/latest', baseUrl);
  url.searchParams.set('key', process.env.DAILY_ACCESS_KEY);
  url.searchParams.set('date', date);
  url.searchParams.set('legacy', '1');
  url.searchParams.set('all', '1'); // Include WAV, parameters, and manifests.
  const response = await fetch(url, { headers: { 'cache-control': 'no-store' } });
  if (!response.ok) {
    throw new Error('Legacy archive unavailable for ' + date + ': HTTP ' + response.status +
      '. Wait for Vercel Blob to resume before migrating.');
  }
  const archive = await response.json();
  dates++;
  for (const file of archive.files || []) {
    if (!file.pathname.startsWith('daily/' + date + '/')) {
      throw new Error('Unexpected object path returned for ' + date);
    }
    try {
      await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: file.pathname }));
      skipped++;
      continue;
    } catch (error) {
      if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NotFound') throw error;
    }

    const download = await fetch(file.url);
    if (!download.ok) throw new Error('Could not download ' + file.pathname + ': HTTP ' + download.status);
    const data = Buffer.from(await download.arrayBuffer());
    const contentType = file.pathname.endsWith('.wav') ? 'audio/wav' : 'application/json';
    await r2.send(new PutObjectCommand({
      Bucket: bucket, Key: file.pathname, Body: data,
      ContentLength: data.length, ContentType: contentType,
    }));
    copied++;
    console.log('Copied ' + file.pathname + ' (' + data.length + ' bytes)');
  }
}
console.log(JSON.stringify({ dates, copied, skipped, preservedOriginals: true }));
