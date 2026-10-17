function createFixedWindowRateLimiter({ limit, windowMs = 60_000, maxKeys = 10_000, now = Date.now }) {
  const buckets = new Map();
  let lastCleanup = 0;

  return (key) => {
    const currentTime = now();
    if (currentTime - lastCleanup >= windowMs) {
      for (const [clientKey, bucket] of buckets) {
        if (currentTime - bucket.startedAt >= windowMs) buckets.delete(clientKey);
      }
      lastCleanup = currentTime;
    }

    const clientKey = String(key || 'unknown');
    let bucket = buckets.get(clientKey);
    if (!bucket || currentTime - bucket.startedAt >= windowMs) {
      bucket = { startedAt: currentTime, count: 0 };
      buckets.delete(clientKey);
    } else {
      // Refresh insertion order so a busy client is not evicted before stale entries.
      buckets.delete(clientKey);
    }
    bucket.count += 1;
    buckets.set(clientKey, bucket);

    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
    return bucket.count <= limit;
  };
}

module.exports = { createFixedWindowRateLimiter };
