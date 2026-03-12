import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

// Ensure .env is loaded from the root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ALGORITHM = 'aes-256-cbc';
const ENCODING = 'hex';
const IV_LENGTH = 16;

// Get key from environment (Strictly requires ENCRYPTION_KEY)
const getEncryptionKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('Critical Security Error: ENCRYPTION_KEY is missing in .env file. System cannot start safely.');
  }

  // If key is provided, ensure it's 32 bytes (64 hex chars) or hash it to fit AES-256
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }
  
  // Hash whatever string provided to get a 32-byte key
  return crypto.createHash('sha256').update(key).digest();
};

const KEY = getEncryptionKey();

export const encrypt = (text: string): string => {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(text, 'utf8', ENCODING);
    encrypted += cipher.final(ENCODING);
    return `${iv.toString(ENCODING)}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    return text; // Fallback to original text if encryption fails (should not happen)
  }
};

export const decrypt = (text: string): string => {
  if (!text) return text;
  
  // Check if text is in iv:encrypted format
  const parts = text.split(':');
  if (parts.length !== 2) {
    // Not encrypted or invalid format, return as is (useful for migration)
    return text;
  }

  try {
    const iv = Buffer.from(parts[0], ENCODING);
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encryptedText, ENCODING, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // If decryption fails (e.g. wrong key or invalid data), return original
    // This might be dangerous if we display encrypted data, but safer than crashing
    // console.error('Decryption error:', error);
    return text;
  }
};

// Helper to check if string looks encrypted
export const isEncrypted = (text: string): boolean => {
  if (!text) return false;
  const parts = text.split(':');
  return parts.length === 2 && parts[0].length === 32; // 16 bytes hex = 32 chars
};
