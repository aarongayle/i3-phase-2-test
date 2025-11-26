// Simple in-memory cache with TTL support
// Can be replaced with Redis for production Coolify deployments

const cache = new Map();

/**
 * Get a value from the cache
 * @param {string} key - Cache key
 * @returns {any|null} - Cached value or null if not found/expired
 */
export function get(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

/**
 * Set a value in the cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {object} options - Options
 * @param {number} options.ex - Expiration time in seconds
 */
export function set(key, value, options = {}) {
  const ttl = options.ex || 300; // Default 5 minutes
  const entry = {
    value,
    expiresAt: Date.now() + ttl * 1000,
  };
  cache.set(key, entry);
}

/**
 * Delete a value from the cache
 * @param {string} key - Cache key
 */
export function del(key) {
  cache.delete(key);
}

/**
 * Clear all entries from the cache
 */
export function clear() {
  cache.clear();
}

/**
 * Get cache stats
 * @returns {object} - Cache statistics
 */
export function stats() {
  let valid = 0;
  let expired = 0;
  const now = Date.now();

  for (const [, entry] of cache) {
    if (now > entry.expiresAt) {
      expired++;
    } else {
      valid++;
    }
  }

  return { valid, expired, total: cache.size };
}

// Periodic cleanup of expired entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000);

export default { get, set, del, clear, stats };

