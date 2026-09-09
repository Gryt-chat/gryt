import html from "./offline.html";

import { isOriginDown, offlineResponse } from "./offline.js";

/**
 * Stands in front of the browser-facing hostnames and swaps Cloudflare's "this
 * service is offline" for one that names Gryt and points at the status page.
 */

/* Everything else passes through untouched, including 4xx and a 500 the origin
   chose for itself. A throw is the origin being unreachable rather than slow. */
export default {
  async fetch(request) {
    let response;
    try {
      response = await fetch(request);
    } catch {
      return offlineResponse(html);
    }

    return isOriginDown(response.status) ? offlineResponse(html) : response;
  },
};
