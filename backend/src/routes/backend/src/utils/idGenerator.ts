import { createHash, randomBytes } from 'crypto';

export function generateTransactionId(): string {
  const payload = Date.now().toString() + randomBytes(16).toString('hex');
  const hash = createHash('md5').update(payload).digest('base64');
  return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
