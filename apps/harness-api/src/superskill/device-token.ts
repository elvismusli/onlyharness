import { createHmac, timingSafeEqual } from "node:crypto";

export const SUPERSKILL_DEVICE_TOKEN_PREFIX = "ohdt_" as const;
export const SUPERSKILL_DEVICE_TOKEN_AUDIENCE = "superskill.sh" as const;
export const SUPERSKILL_DEVICE_TOKEN_MAX_TTL_SECONDS = 30 * 60;
const SUPERSKILL_MANAGED_SCOPE = "superskill:managed" as const;

type DeviceTokenClaims = {
  v: 1;
  kind: "superskill_device";
  aud: typeof SUPERSKILL_DEVICE_TOKEN_AUDIENCE;
  sub: string;
  uid: string;
  scope: typeof SUPERSKILL_MANAGED_SCOPE;
  iat: number;
  exp: number;
  jti: string;
};

export type VerifiedDeviceToken = {
  userId: string;
  subject: string;
  scope: typeof SUPERSKILL_MANAGED_SCOPE;
  issuedAt: Date;
  expiresAt: Date;
  tokenId: string;
};

export function issueSuperskillDeviceToken(input: {
  userId: string;
  subjectSalt: string;
  issuedAt: Date;
  expiresAt: Date;
  tokenId: string;
}): string | undefined {
  const key = deriveDeviceSigningKey(input.subjectSalt);
  if (!key || !isUuid(input.userId) || !isTokenId(input.tokenId)) return undefined;
  const issuedAt = Math.floor(input.issuedAt.getTime() / 1_000);
  const expiresAt = Math.floor(input.expiresAt.getTime() / 1_000);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > SUPERSKILL_DEVICE_TOKEN_MAX_TTL_SECONDS) return undefined;
  const claims: DeviceTokenClaims = {
    v: 1,
    kind: "superskill_device",
    aud: SUPERSKILL_DEVICE_TOKEN_AUDIENCE,
    sub: deviceUserSubject(input.userId, input.subjectSalt),
    uid: input.userId,
    scope: SUPERSKILL_MANAGED_SCOPE,
    iat: issuedAt,
    exp: expiresAt,
    jti: input.tokenId
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signed = `${SUPERSKILL_DEVICE_TOKEN_PREFIX}${payload}`;
  const signature = createHmac("sha256", key).update(signed).digest("base64url");
  return `${signed}.${signature}`;
}

export function verifySuperskillDeviceToken(token: string, subjectSalt: string, now: Date): VerifiedDeviceToken | undefined {
  const key = deriveDeviceSigningKey(subjectSalt);
  if (!key || token.length > 2_048 || !token.startsWith(SUPERSKILL_DEVICE_TOKEN_PREFIX)) return undefined;
  const separator = token.lastIndexOf(".");
  if (separator <= SUPERSKILL_DEVICE_TOKEN_PREFIX.length || separator === token.length - 1) return undefined;
  const signed = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) return undefined;
  const expected = createHmac("sha256", key).update(signed).digest("base64url");
  if (!safeEqual(signature, expected)) return undefined;
  const encoded = signed.slice(SUPERSKILL_DEVICE_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{16,1800}$/.test(encoded)) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
  if (!validClaims(claims, subjectSalt, now)) return undefined;
  return {
    userId: claims.uid,
    subject: claims.sub,
    scope: claims.scope,
    issuedAt: new Date(claims.iat * 1_000),
    expiresAt: new Date(claims.exp * 1_000),
    tokenId: claims.jti
  };
}

export function deriveDeviceSigningKey(subjectSalt: string): Buffer | undefined {
  if (Buffer.byteLength(subjectSalt, "utf8") < 32) return undefined;
  return createHmac("sha256", subjectSalt).update("superskill-device-auth-signing:v1").digest();
}

function validClaims(value: unknown, subjectSalt: string, now: Date): value is DeviceTokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Partial<DeviceTokenClaims>;
  if (
    claims.v !== 1
    || claims.kind !== "superskill_device"
    || claims.aud !== SUPERSKILL_DEVICE_TOKEN_AUDIENCE
    || claims.scope !== SUPERSKILL_MANAGED_SCOPE
    || typeof claims.uid !== "string"
    || !isUuid(claims.uid)
    || typeof claims.sub !== "string"
    || !/^user:[a-f0-9]{64}$/.test(claims.sub)
    || typeof claims.iat !== "number"
    || !Number.isSafeInteger(claims.iat)
    || typeof claims.exp !== "number"
    || !Number.isSafeInteger(claims.exp)
    || typeof claims.jti !== "string"
    || !isTokenId(claims.jti)
  ) return false;
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (claims.iat > nowSeconds + 30 || claims.exp <= nowSeconds || claims.exp <= claims.iat) return false;
  if (claims.exp - claims.iat > SUPERSKILL_DEVICE_TOKEN_MAX_TTL_SECONDS) return false;
  return safeEqual(claims.sub, deviceUserSubject(claims.uid, subjectSalt));
}

function deviceUserSubject(userId: string, salt: string): string {
  return `user:${createHmac("sha256", salt).update(`superskill-user:${userId}`).digest("hex")}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isTokenId(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(value);
}
