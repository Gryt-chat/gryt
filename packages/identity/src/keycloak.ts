import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface VerifiedUser {
  sub: string;
  preferredUsername?: string;
  email?: string;
}

function getIssuer(): string {
  const issuer = process.env.GRYT_OIDC_ISSUER;
  if (!issuer) {
    throw new Error("Missing GRYT_OIDC_ISSUER environment variable");
  }
  return issuer.replace(/\/+$/, "");
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (jwks) return jwks;
  const issuer = getIssuer();
  const certsUrl = new URL(`${issuer}/protocol/openid-connect/certs`);
  jwks = createRemoteJWKSet(certsUrl);
  return jwks;
}

function parseStringClaim(payload: JWTPayload, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export async function verifyKeycloakToken(token: string): Promise<VerifiedUser> {
  const issuer = getIssuer();
  const { payload } = await jwtVerify(token, getJwks(), { issuer });

  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("Token missing sub claim");
  }

  return {
    sub: payload.sub,
    preferredUsername: parseStringClaim(payload, "preferred_username"),
    email: parseStringClaim(payload, "email"),
  };
}
