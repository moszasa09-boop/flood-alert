const UA = 'flood-alert/0.1 (home flood warning; contact via GitHub)';

// fetch พร้อม timeout และลองใหม่เมื่อเจอ error ชั่วคราว (429 / 5xx / network)
export async function fetchWithRetry(url, opts = {}, { tries = 3, timeoutMs = 45000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': UA, ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return res;
    } catch (err) {
      lastErr = err;
      if (err.fatal) break;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}
