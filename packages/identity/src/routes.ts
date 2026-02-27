import { Hono } from "hono";
import { cors } from "hono/cors";

import { getCAPublicJwk } from "./keys.js";
import { verifyKeycloakToken } from "./keycloak.js";
import { issueCertificate } from "./certificate.js";

export const app = new Hono();

app.use("*", cors());

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/.well-known/jwks.json", async (c) => {
  const publicJwk = await getCAPublicJwk();
  return c.json({ keys: [publicJwk] });
});

app.post("/api/v1/certificate", async (c) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "missing_token", message: "Authorization header with Bearer token required." }, 401);
  }

  const keycloakToken = authHeader.slice(7);

  let user;
  try {
    user = await verifyKeycloakToken(keycloakToken);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: "invalid_token", message: `Keycloak token validation failed: ${msg}` }, 401);
  }

  let body: { jwk?: JsonWebKey };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_body", message: "JSON body with jwk field required." }, 400);
  }

  const { jwk } = body;
  if (!jwk || typeof jwk !== "object" || jwk.kty !== "EC" || (jwk as Record<string, string>).crv !== "P-256") {
    return c.json({
      error: "invalid_jwk",
      message: "Body must contain a jwk field with an EC P-256 public key (kty: EC, crv: P-256).",
    }, 400);
  }

  if ((jwk as Record<string, string>).d) {
    return c.json({ error: "invalid_jwk", message: "Do not send private key material. Send the public key only." }, 400);
  }

  try {
    const certificate = await issueCertificate(user, jwk);
    return c.json({ certificate });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Certificate issuance failed:", msg);
    return c.json({ error: "issuance_failed", message: "Failed to issue certificate." }, 500);
  }
});
