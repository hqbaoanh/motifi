import crypto from 'node:crypto';

// Webhook signing scheme (same idea as Stripe's):
//
//   X-MotiFi-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
//
// Signing the timestamp together with the body means an attacker can't take an
// old valid request and replay it, because the timestamp falls outside the tolerance.

export function sign(secret, rawBody, timestamp = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export function verify(secret, rawBody, header, { toleranceSec = 300, now = Date.now() } = {}) {
  if (typeof header !== 'string') return { ok: false, reason: 'missing signature' };

  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return { ok: false, reason: 'malformed signature' };
  if (Math.abs(now / 1000 - timestamp) > toleranceSec) return { ok: false, reason: 'stale signature' };

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  let given;
  try {
    given = Buffer.from(parts.v1, 'hex');
  } catch {
    return { ok: false, reason: 'malformed signature' };
  }
  // Constant-time comparison, so response timing doesn't leak how many bytes matched.
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true };
}
