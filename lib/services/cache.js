// Vercel KV Cache Wrapper
// Provides a consistent cache interface using Vercel KV

import { kv } from "@vercel/kv";

export class CacheService {
  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    try {
      const value = await kv.get(key);
      return value;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - Time to live in seconds (default: 300 = 5 min)
   * @returns {Promise<void>}
   */
  async set(key, value, ttlSeconds = 300) {
    try {
      await kv.set(key, value, { ex: ttlSeconds });
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<void>}
   */
  async delete(key) {
    try {
      await kv.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Delete all keys matching a pattern
   * @param {string} pattern - Pattern to match (e.g., "report:*")
   * @returns {Promise<number>} Number of keys deleted
   */
  async invalidate(pattern) {
    try {
      // Vercel KV doesn't support pattern matching directly
      // You'll need to track keys or use a different approach

      // Option 1: Track keys in a set
      const keysSetName = `_keys:${pattern.replace("*", "")}`;
      const keys = await kv.smembers(keysSetName);

      if (keys && keys.length > 0) {
        await kv.del(...keys);
        await kv.del(keysSetName);
        return keys.length;
      }

      return 0;
    } catch (error) {
      console.error(`Cache invalidate error for pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Check if key exists
   * @param {string} key - Cache key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    try {
      const value = await kv.get(key);
      return value !== null;
    } catch (error) {
      console.error(`Cache has error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get or set pattern: fetch from cache or compute and cache
   * @param {string} key - Cache key
   * @param {Function} fetchFn - Async function to fetch data if not cached
   * @param {number} ttlSeconds - TTL in seconds
   * @returns {Promise<any>}
   */
  async getOrSet(key, fetchFn, ttlSeconds = 300) {
    // Try to get from cache
    let value = await this.get(key);

    if (value !== null) {
      return value;
    }

    // Not in cache, fetch and store
    value = await fetchFn();
    await this.set(key, value, ttlSeconds);

    return value;
  }
}

// Export singleton instance
export const cache = new CacheService();
