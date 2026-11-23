import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function encryptionKey(): Buffer {
  const seed = Buffer.from(process.env.AGENTWIKI_DEPLOYMENT_SEED ?? '', 'base64');
  if (seed.length !== 32) throw new Error('Invalid AgentWiki deployment seed');
  return Buffer.from(hkdfSync('sha256', seed, '', 'agentwiki:personal-api-key:v1', 32));
}

function associatedData(userId: string, keyHash: string): Buffer {
  return Buffer.from(JSON.stringify([userId, keyHash]));
}

export function encryptPersonalApiKey(token: string, userId: string, keyHash: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), nonce);
  cipher.setAAD(associatedData(userId, keyHash));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [VERSION, ...[nonce, cipher.getAuthTag(), encrypted].map((buffer) => buffer.toString('base64url'))].join('.');
}

export function decryptPersonalApiKey(envelope: string, userId: string, keyHash: string): string {
  const [version, nonce, tag, encrypted, extra] = envelope.split('.');
  if (version !== VERSION || !nonce || !tag || !encrypted || extra !== undefined) {
    throw new Error('Invalid encrypted personal access token');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(nonce, 'base64url'), { authTagLength: 16 });
  decipher.setAAD(associatedData(userId, keyHash));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
