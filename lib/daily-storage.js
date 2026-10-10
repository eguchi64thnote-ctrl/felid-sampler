import { list as listVercelBlob, issueSignedToken, presignUrl } from '@vercel/blob';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// The archive is private. These credentials are server-only environment variables.
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
let client;

export function r2Ready() {
  return R2_VARS.every(name => Boolean(process.env[name]));
}

function r2Client() {
  if (!r2Ready()) throw new Error('R2 is not configured');
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: 'https://' + process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

async function listR2(prefix) {
  const blobs = [];
  let token;
  do {
    const result = await r2Client().send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME, Prefix: prefix, MaxKeys: 1000,
      ContinuationToken: token,
    }));
    for (const object of result.Contents || []) {
      if (object.Key) {
        blobs.push({ pathname: object.Key, size: Number(object.Size || 0), source: 'r2' });
      }
    }
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !token) throw new Error('R2 list response is missing a cursor');
  } while (token);
  return blobs;
}

async function listBlob(prefix) {
  const blobs = [];
  let cursor;
  do {
    const result = await listVercelBlob({ prefix, limit: 1000, cursor });
    blobs.push(...result.blobs.map(blob => ({
      pathname: blob.pathname, size: Number(blob.size || 0), source: 'blob',
    })));
    cursor = result.cursor;
  } while (cursor);
  return blobs;
}

// Prefer the R2 copy of a file, but continue to read legacy Blob objects.
// A suspended legacy store must not break R2-backed archive browsing.
export async function listArchive(prefix, { only } = {}) {
  if (only && only !== 'blob' && only !== 'r2') throw new Error('Invalid storage selection');
  const tasks = [];
  if (only !== 'r2') tasks.push({ source: 'blob', run: () => listBlob(prefix) });
  if (only !== 'blob' && r2Ready()) tasks.push({ source: 'r2', run: () => listR2(prefix) });
  if (only === 'r2' && !r2Ready()) throw new Error('R2 is not configured');

  const results = await Promise.allSettled(tasks.map(task => task.run()));
  const merged = new Map();
  const unavailable = [];
  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const source = tasks[i].source;
    if (result.status === 'fulfilled') {
      successCount++;
      for (const file of result.value) merged.set(file.pathname, file);
    } else {
      unavailable.push(source);
      console.error('Archive storage ' + source + ' failed:', result.reason);
    }
  }
  if (!successCount) throw new Error('All archive storage backends are unavailable: ' + unavailable.join(', '));
  return { blobs: [...merged.values()], unavailable };
}

export async function signedArchiveUrl(file, expiresIn = 6 * 60 * 60) {
  if (file.source === 'r2') {
    return getSignedUrl(r2Client(), new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME, Key: file.pathname,
    }), { expiresIn });
  }
  const validUntil = Date.now() + expiresIn * 1000;
  const token = await issueSignedToken({
    pathname: file.pathname, operations: ['get'], validUntil,
  });
  const signed = await presignUrl(token, {
    operation: 'get', pathname: file.pathname, access: 'private', validUntil,
  });
  return signed.presignedUrl;
}
