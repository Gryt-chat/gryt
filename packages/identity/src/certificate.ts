import { SignJWT } from "jose";

import { getCAPrivateKey, getCAKid, CA_ALG } from "./keys.js";
import type { VerifiedUser } from "./keycloak.js";

const DEFAULT_LIFETIME_DAYS = 30;

function getCertLifetimeSeconds(): number {
  const days = parseInt(process.env.GRYT_CERT_LIFETIME_DAYS || "", 10);
  return (days > 0 ? days : DEFAULT_LIFETIME_DAYS) * 86400;
}

function getIssuer(): string {
  return (
    process.env.GRYT_IDENTITY_ORIGIN?.replace(/\/+$/, "") ||
    "https://id.gryt.chat"
  );
}

export interface CertificatePayload {
  iss: string;
  sub: string;
  preferred_username?: string;
  jwk: JsonWebKey;
  iat: number;
  exp: number;
}

export async function issueCertificate(
  user: VerifiedUser,
  clientPublicJwk: JsonWebKey,
): Promise<string> {
  const privateKey = await getCAPrivateKey();
  const kid = await getCAKid();
  const lifetimeSeconds = getCertLifetimeSeconds();
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({
    jwk: clientPublicJwk,
    preferred_username: user.preferredUsername,
  })
    .setProtectedHeader({ alg: CA_ALG, kid, typ: "JWT" })
    .setIssuer(getIssuer())
    .setSubject(user.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetimeSeconds)
    .sign(privateKey);

  return jwt;
}
