import NodeCache from 'node-cache';

// TTL: 10 minutes
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

export const getCache = (key: string) => {
  return cache.get(key);
};

export const setCache = (key: string, value: any, ttl?: number) => {
  cache.set(key, value, ttl || 600);
};

export const invalidateCache = (key: string) => {
  cache.del(key);
};

export const flushCache = () => {
  cache.flushAll();
};

export default cache;
