import { generateTransactionId, parseTransactionId, getTransactionTimestamp } from './snowflake';

// Re-export for backward compatibility
export {
  generateTransactionId,
  parseTransactionId,
  getTransactionTimestamp
};

// Legacy ID generation for other entities if needed
export function generateLegacyId(): string {
  const { createHash, randomBytes } = require('crypto');
  const payload = Date.now().toString() + randomBytes(16).toString('hex');
  const hash = createHash('md5').update(payload).digest('base64');
  return hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
