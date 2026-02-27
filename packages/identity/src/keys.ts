import { exportJWK, generateKeyPair, importPKCS8, type KeyLike } from "jose";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const ALG = "ES256";

let cachedPrivateKey: KeyLike | null = null;
let cachedPublicJwk: JsonWebKey | null = null;
let cachedKid: string | null = null;

function deriveKid(jwk: JsonWebKey): string {
  const material = `${jwk.crv}:${jwk.x}:${jwk.y}`;
  const hash = Bun.hash(material).toString(16);
  return hash.slice(0, 16);
}

async function loadOrGenerateKey(): Promise<{
  privateKey: KeyLike;
  publicJwk: JsonWebKey;
  kid: string;
}> {
  if (cachedPrivateKey && cachedPublicJwk && cachedKid) {
    return { privateKey: cachedPrivateKey, publicJwk: cachedPublicJwk, kid: cachedKid };
  }

  const keyPath = process.env.GRYT_CA_PRIVATE_KEY_FILE;

  if (keyPath) {
    try {
      const pem = await readFile(keyPath, "utf-8");
      const privateKey = await importPKCS8(pem, ALG);
      const jwk = await exportJWK(privateKey);
      const kid = deriveKid(jwk);
      const { d: _, ...publicJwk } = jwk;

      cachedPrivateKey = privateKey;
      cachedPublicJwk = { ...publicJwk, alg: ALG, use: "sig", kid };
      cachedKid = kid;
      return { privateKey, publicJwk: cachedPublicJwk, kid };
    } catch (e) {
      console.error(`Failed to load CA key from ${keyPath}, generating new keypair:`, e);
    }
  }

  const dataDir = process.env.GRYT_IDENTITY_DATA_DIR || "./data";
  const autoKeyPath = `${dataDir}/ca-key.pem`;

  try {
    const pem = await readFile(autoKeyPath, "utf-8");
    const privateKey = await importPKCS8(pem, ALG);
    const jwk = await exportJWK(privateKey);
    const kid = deriveKid(jwk);
    const { d: _, ...publicJwk } = jwk;

    cachedPrivateKey = privateKey;
    cachedPublicJwk = { ...publicJwk, alg: ALG, use: "sig", kid };
    cachedKid = kid;
    console.log(`Loaded existing CA key from ${autoKeyPath}`);
    return { privateKey, publicJwk: cachedPublicJwk, kid };
  } catch {
    // Key doesn't exist yet, generate one
  }

  console.log("Generating new ECDSA P-256 CA keypair...");
  const { privateKey, publicKey } = await generateKeyPair(ALG, {
    extractable: true,
  });

  const privateJwk = await exportJWK(privateKey);
  const pubJwk = await exportJWK(publicKey);
  const kid = deriveKid(pubJwk);

  // Serialize private key to PEM via PKCS8
  const { exportPKCS8 } = await import("jose");
  const pem = await exportPKCS8(privateKey);

  await mkdir(dirname(autoKeyPath), { recursive: true });
  await writeFile(autoKeyPath, pem, { mode: 0o600 });
  console.log(`Saved new CA key to ${autoKeyPath}`);

  cachedPrivateKey = privateKey;
  cachedPublicJwk = { ...pubJwk, alg: ALG, use: "sig", kid };
  cachedKid = kid;

  return { privateKey, publicJwk: cachedPublicJwk, kid };
}

export async function getCAPrivateKey(): Promise<KeyLike> {
  const { privateKey } = await loadOrGenerateKey();
  return privateKey;
}

export async function getCAPublicJwk(): Promise<JsonWebKey & { kid: string }> {
  const { publicJwk, kid } = await loadOrGenerateKey();
  return { ...publicJwk, kid } as JsonWebKey & { kid: string };
}

export async function getCAKid(): Promise<string> {
  const { kid } = await loadOrGenerateKey();
  return kid;
}

export const CA_ALG = ALG;
