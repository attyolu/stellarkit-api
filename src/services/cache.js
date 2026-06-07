const NodeCache = require("node-cache");

/**
 * Centralised in-memory TTL cache service.
 * Used to cache Horizon responses and other frequently requested data.
 */
class CacheService {
  constructor(defaultTtlSeconds = 60) {
    this.cache = new NodeCache({
      stdTTL: defaultTtlSeconds,
      checkperiod: defaultTtlSeconds * 0.2,
      useClones: false, // For performance since we're just caching JSON response data
    });
  }

  /**
   * Get a value from the cache.
   * 
   * @param {string} key - Cache key
   * @returns {any|undefined} Cached value or undefined if missing/expired
   */
  get(key) {
    return this.cache.get(key);
  }

  /**
   * Set a value in the cache with a specific TTL.
   * 
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - TTL in seconds
   * @returns {boolean} True if successfully set
   */
  set(key, value, ttlSeconds) {
    return this.cache.set(key, value, ttlSeconds);
  }

  /**
   * Delete a specific key from the cache.
   * 
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.del(key);
  }

  /**
   * Flush all data from the cache.
   */
  flush() {
    this.cache.flushAll();
  }
}

// Export a singleton instance
module.exports = new CacheService();
