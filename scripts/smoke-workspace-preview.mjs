import { createHash } from "node:crypto";

const apiUrl = (process.env.SMOKE_API_URL ?? "https://superskill.sh/api").replace(/\/$/, "");
const token = process.env.DEPLOY_SMOKE_ACCESS_TOKEN;
if (!token) throw new Error("DEPLOY_SMOKE_ACCESS_TOKEN is required");

const api = new URL(apiUrl);
if (api.protocol !== "https:" && !["127.0.0.1", "localhost", "::1"].includes(api.hostname)) {
  throw new Error("Workspace preview smoke requires HTTPS or a local endpoint");
}

const jwtParts = token.split(".");
if (jwtParts.length !== 3) throw new Error("Workspace preview smoke requires a confirmed user JWT");
let subject;
try {
  subject = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString("utf8")).sub;
} catch {
  throw new Error("Workspace preview smoke received an invalid user JWT");
}
if (typeof subject !== "string" || subject.length < 8) throw new Error("Workspace preview smoke JWT has no stable subject");

const slug = `superskill-preview-${createHash("sha256").update(subject).digest("hex").slice(0, 10)}`;
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const workspaceResponse = await fetch(`${apiUrl}/workspaces`, {
  method: "POST",
  headers,
  body: JSON.stringify({ slug, name: "SuperSkill Preview QA", type: "team", visibility: "private", description: "Bounded production preview verification workspace." })
});
if (![200, 201].includes(workspaceResponse.status)) {
  throw new Error(`Workspace preview smoke could not create or replay workspace: ${workspaceResponse.status}`);
}

const inviteResponse = await fetch(`${apiUrl}/workspaces/${encodeURIComponent(slug)}/invites`, {
  method: "POST",
  headers,
  body: JSON.stringify({ role: "viewer", maxUses: 1, expiresInSeconds: 120 })
});
const inviteBody = await inviteResponse.json().catch(() => undefined);
if (inviteResponse.status !== 201 || typeof inviteBody?.shareUrl !== "string" || typeof inviteBody?.code !== "string") {
  throw new Error(`Workspace preview smoke could not create bounded invite: ${inviteResponse.status}`);
}

const share = new URL(inviteBody.shareUrl);
const publicOrigin = api.origin;
if (share.origin !== publicOrigin || !/^\/w\/[A-Za-z0-9_-]{8,100}$/.test(share.pathname)) {
  throw new Error("Workspace preview smoke received a non-canonical share URL");
}
if (!share.hash.startsWith("#invite=") || !share.hash.includes(encodeURIComponent(inviteBody.code))) {
  throw new Error("Workspace preview smoke did not keep the invite code in the URL fragment");
}

const previewResponse = await fetch(`${publicOrigin}${share.pathname}`, { headers: { "user-agent": "TelegramBot (like TwitterBot)" } });
const previewHtml = await previewResponse.text();
if (previewResponse.status !== 200) throw new Error(`Workspace preview HTML returned ${previewResponse.status}`);
if (!/private\s*,\s*no-store/i.test(previewResponse.headers.get("cache-control") ?? "")) throw new Error("Workspace preview HTML is not private/no-store");
if (!previewHtml.includes('name="robots" content="noindex,nofollow,noarchive"')) throw new Error("Workspace preview HTML is indexable");
if (!previewHtml.includes("SuperSkill Preview QA")) throw new Error("Workspace preview HTML does not identify the workspace");
if (previewHtml.includes(inviteBody.code) || previewHtml.includes("ohwi_")) throw new Error("Workspace preview HTML leaked the raw invite code");

const imageMatch = previewHtml.match(/<meta property="og:image" content="([^"]+)">/);
if (!imageMatch) throw new Error("Workspace preview HTML has no OG image");
const imageUrl = new URL(imageMatch[1]);
if (imageUrl.origin !== publicOrigin || imageUrl.hash || imageUrl.href.includes(inviteBody.code) || !imageUrl.pathname.startsWith("/og/w/")) {
  throw new Error("Workspace OG image URL is unsafe");
}
const imageResponse = await fetch(imageUrl);
const image = Buffer.from(await imageResponse.arrayBuffer());
if (imageResponse.status !== 200 || imageResponse.headers.get("content-type") !== "image/png") throw new Error(`Workspace OG image returned ${imageResponse.status}`);
if (!/private\s*,\s*no-store/i.test(imageResponse.headers.get("cache-control") ?? "")) throw new Error("Workspace OG image is not private/no-store");
if (image.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || image.readUInt32BE(16) !== 1200 || image.readUInt32BE(20) !== 630) {
  throw new Error("Workspace OG image is not a 1200x630 PNG");
}
if (image.includes(Buffer.from(inviteBody.code))) throw new Error("Workspace OG image leaked the raw invite code");

const missingResponse = await fetch(`${publicOrigin}/w/invite_missingPreviewSmoke`, { headers: { "user-agent": "TelegramBot (like TwitterBot)" } });
const missingHtml = await missingResponse.text();
if (missingResponse.status !== 404 || !missingHtml.includes('name="robots" content="noindex,nofollow,noarchive"')) {
  throw new Error("Unknown workspace preview does not fail noindex");
}

console.log("Production workspace share preview smoke passed");
