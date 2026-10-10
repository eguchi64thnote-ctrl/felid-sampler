import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { encryptWav } from '../lib/wav-encryption.js';

const wav = Buffer.alloc(44 + 10240);
wav.write('RIFF', 0, 'ascii');
wav.write('WAVE', 8, 'ascii');
wav.write('fmt ', 12, 'ascii');
wav.write('data', 36, 'ascii');
for (let i = 44; i < wav.length; i++) wav[i] = (i * 17) % 256;

const result = encryptWav(wav);
const bytes = new Uint8Array(result.data);
assert.equal(Buffer.from(bytes.slice(0, 9)).toString(), 'FELIDWAV1');
assert.match(result.key, /^[A-Za-z0-9_-]{43}$/);
assert.equal(result.data.length, wav.length + 37);
const keyBytes = Buffer.from(result.key, 'base64url');
const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
const iv = bytes.slice(9, 21);
const tag = bytes.slice(21, 37);
const payload = bytes.slice(37);
const ciphertextWithTag = new Uint8Array(payload.length + tag.length);
ciphertextWithTag.set(payload);
ciphertextWithTag.set(tag, payload.length);
const restored = Buffer.from(await webcrypto.subtle.decrypt({ name:'AES-GCM', iv, tagLength:128 }, key, ciphertextWithTag));
assert.deepEqual(restored, wav, 'Browser-compatible decryption must reproduce the original WAV exactly');

const damaged = ciphertextWithTag.slice();
damaged[0] ^= 0x01;
await assert.rejects(
  webcrypto.subtle.decrypt({ name:'AES-GCM', iv, tagLength:128 }, key, damaged),
  'Tampered ciphertext should fail authentication',
);
assert.throws(() => encryptWav(Buffer.from('bad')), /Invalid WAV source/);
console.log('WAV archive encryption, round-trip, and tampering checks passed');
