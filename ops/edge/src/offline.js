/**
 * When to stand in for the origin, and what to say. Kept apart from index.js so
 * check-offline-page.mjs can import it without Wrangler's text loader.
 */

/* Cloudflare's own codes for "the origin did not answer". 530 is what a tunnel
   with nothing behind it returns, which is the failure that actually happens. */
const ORIGIN_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

/**
 * A 500 the origin itself chose is its own to explain, so only the codes above
 * are replaced. Standing in for every 5xx would hide a real bug behind an apology.
 */
export function isOriginDown(status) {
  return ORIGIN_DOWN.has(status);
}

/**
 * 503 rather than 200. Every status.gryt.chat check asserts on the body, so a
 * friendly page with a success code reads as an outage the monitoring calls fine.
 */
export function offlineResponse(html) {
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "120",
      "x-gryt-offline-page": "1",
    },
  });
}
