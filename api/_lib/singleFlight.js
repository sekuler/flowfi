// Only one serverless instance at a time rebuilds an expensive cache entry. The others wait a
// moment for its result instead of each paying the upstream again. If Redis is missing or fails,
// callers just continue without the lock (the rate limits still apply).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock(redis, key, ttlSeconds) {
  if (!redis) return true;
  try { return !!(await redis.set(`lock:${key}`, '1', { nx: true, ex: ttlSeconds })); } catch { return true; }
}

async function releaseLock(redis, key) {
  if (!redis) return;
  try { await redis.del(`lock:${key}`); } catch { /* expires on its own */ }
}

// Polls `read` until it returns a value or the wait is over.
async function waitForValue(read, maxWaitMs, stepMs = 300) {
  const end = Date.now() + maxWaitMs;
  while (Date.now() < end) {
    await sleep(stepMs);
    const v = await read();
    if (v) return v;
  }
  return null;
}

module.exports = { acquireLock, releaseLock, waitForValue };
