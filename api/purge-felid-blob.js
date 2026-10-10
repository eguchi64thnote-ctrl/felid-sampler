import { list, del } from '@vercel/blob';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const audience = 'felid-blob-purge-v1';
const expectedWorkflow = 'eguchi64thnote-ctrl/felid-sampler/.github/workflows/purge-felid-blob.yml@refs/heads/main';
const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));

// One-off maintenance endpoint; not an ordinary user-accessible delete button.
// Only a signed OIDC identity from our exact GitHub Actions workflow on main can run it.
// It expires automatically after the scheduled cleanup window.
export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (Date.now() >= Date.parse('2026-10-14T00:00:00Z')) {
    return res.status(410).json({ error: 'This one-time maintenance endpoint has expired' });
  }

  const authorization = req.headers.authorization || '';
  const token = authorization.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (!token) return res.status(401).json({ error: 'Missing authorized workflow identity' });

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: 'https://token.actions.githubusercontent.com',
      audience,
    });
    if (
      payload.repository !== 'eguchi64thnote-ctrl/felid-sampler' ||
      payload.ref !== 'refs/heads/main' ||
      payload.workflow_ref !== expectedWorkflow ||
      !['push', 'schedule', 'workflow_dispatch'].includes(String(payload.event_name || ''))
    ) {
      return res.status(403).json({ error: 'Workflow not authorized' });
    }
  } catch (error) {
    console.error('Blob cleanup workflow authentication failed:', error?.message);
    return res.status(401).json({ error: 'Workflow authentication failed' });
  }

  const confirm = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (confirm?.action !== 'DELETE_ALL_FELID_BLOB_FILES') {
    return res.status(400).json({ error: 'Exact deletion intent is required' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Existing Blob store is not connected' });
  }

  try {
    // NO PREFIX FILTER: the user explicitly asked to empty the entire attached Blob store.
    // Re-list from the beginning after every deletion to avoid pagination gaps.
    const page = await list({ limit: 60 });
    if (!Array.isArray(page.blobs)) throw new Error('Unexpected Blob list response');
    if (page.blobs.length === 0) {
      console.log('FeLid Blob purge verification: zero objects remain');
      return res.status(200).json({ deleted: 0, empty: true });
    }
    const urls = page.blobs.map(item => item.url);
    if (urls.some(url => !/^https:\/\/[^/\s]+\/.+/.test(url))) {
      throw new Error('Unexpected stored file URL');
    }
    await del(urls);
    const after = await list({ limit: 1 });
    const empty = Array.isArray(after.blobs) && after.blobs.length === 0;
    console.log('FeLid Blob purge: deleted ' + urls.length + ' file(s); empty=' + empty);
    return res.status(200).json({ deleted: urls.length, empty });
  } catch (error) {
    // Do not include private Blob paths or credentials in the response.
    console.error('FeLid Blob purge failed:', error);
    return res.status(503).json({
      error: 'Blob store unavailable or deletion failed; retry after access resumes',
    });
  }
}
