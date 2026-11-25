export function createRateLimit({ windowMs, max, message }) {
  const entries = new Map();
  let lastCleanup = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastCleanup > windowMs) {
      for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
      lastCleanup = now;
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) return res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
    next();
  };
}
