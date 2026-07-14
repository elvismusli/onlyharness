const CANONICAL_ORIGIN = "https://superskill.sh";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function resourceShareUrl(resourceId: string, version?: string): string {
  const key = encodeBase64Url(resourceId);
  return `${CANONICAL_ORIGIN}/r/${key}${version ? `/${encodeURIComponent(version)}` : ""}`;
}

export function capabilityShareUrl(capabilityId: string): string {
  return `${CANONICAL_ORIGIN}/c/${encodeURIComponent(capabilityId)}`;
}

export function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triplet = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL[(triplet >> 18) & 63];
    output += BASE64URL[(triplet >> 12) & 63];
    if (second !== undefined) output += BASE64URL[(triplet >> 6) & 63];
    if (third !== undefined) output += BASE64URL[triplet & 63];
  }
  return output;
}
