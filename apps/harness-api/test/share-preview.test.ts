import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import {
  decodeResourceShareKey,
  encodeResourceShareKey,
  registerSharePreviewRoutes,
  renderShareHtml,
  renderSharePng,
  renderSharePngAsync,
  safeText,
  type SharePreviewModel,
  type SharePreviewResolvers
} from "../src/share-preview.js";

const skill: SharePreviewModel = {
  kind: "resource",
  title: "Research navigator",
  summary: "Turns a broad question into a source-backed research workflow.",
  eyebrow: "skill · exact release",
  badge: "skill",
  facts: ["v1.2.3", "scan pass", "sha256 1234…cdef"],
  canonicalPath: "/r/Z2l0aHViOmFjbWUvc2tpbGw/1.2.3",
  imagePath: "/og/r/Z2l0aHViOmFjbWUvc2tpbGw?version=1.2.3",
  redirectHash: "#/superskill/resources/github%3Aacme%2Fskill/releases/1.2.3",
  immutable: true
};

const workspace: SharePreviewModel = {
  kind: "workspace",
  title: "Research team",
  summary: "Join @research-team on SuperSkill. Sign in to verify this private workspace invitation.",
  eyebrow: "private workspace · invitation",
  badge: "invite only",
  facts: ["private catalog"],
  canonicalPath: "/w/invite_safeHandle123",
  imagePath: "/og/w/invite_safeHandle123",
  redirectHash: "#/superskill/workspaces?workspace=research-team",
  workspaceSlug: "research-team",
  noIndex: true
};

test("resource share keys round-trip exact machine coordinates and reject controls", () => {
  const id = "onlyharness:packages/my-agent-skill";
  const key = encodeResourceShareKey(id);
  assert.equal(decodeResourceShareKey(key), id);
  assert.equal(decodeResourceShareKey(encodeResourceShareKey("bad\u202eresource")), undefined);
  assert.equal(decodeResourceShareKey("../bad"), undefined);
});

test("share HTML is crawler-visible, escaped and workspace noindex", () => {
  const html = renderShareHtml({ ...workspace, title: "Research <script>alert(1)</script>" });
  assert.match(html, /<meta property="og:title" content="Research &lt;script&gt;alert\(1\)&lt;\/script&gt; — SuperSkill">/);
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(html, /location\.hash/);
  assert.doesNotMatch(html, /ohwi_/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal(safeText("safe\u202etext\u0000here", 100), "safe text here");
});

test("share PNGs are 1200x630 and vary per card", () => {
  const skillPng = renderSharePng(skill);
  const workspacePng = renderSharePng(workspace);
  assert.equal(skillPng.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(skillPng.readUInt32BE(16), 1200);
  assert.equal(skillPng.readUInt32BE(20), 630);
  assert.notDeepEqual(skillPng, workspacePng);
});

test("async share PNG rendering leaves the API event loop responsive", async () => {
  const startedAt = Date.now();
  const rendering = renderSharePngAsync({ ...skill, title: "Unique off-thread rendering probe" });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(Date.now() - startedAt < 750, "share image rendering blocked the event loop");
  const png = await rendering;
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});

test("share routes keep latest, exact and workspace previews distinct without leaking invite codes", async () => {
  const app = Fastify({ logger: false });
  const seen: Array<{ id: string; version?: string }> = [];
  const resolvers: SharePreviewResolvers = {
    resource: async (id, version) => {
      seen.push({ id, version });
      return { ok: true, value: version ? skill : { ...skill, title: "Latest research navigator", canonicalPath: skill.canonicalPath.replace("/1.2.3", ""), immutable: false } };
    },
    capability: async (id) => ({ ok: true, value: { ...skill, kind: "capability", title: `Capability ${id}`, canonicalPath: `/c/${id}`, imagePath: `/og/c/${id}` } }),
    workspace: async () => ({ ok: true, value: workspace })
  };
  await registerSharePreviewRoutes(app, resolvers);

  const key = encodeResourceShareKey("github:acme/skill");
  const latest = await app.inject({ method: "GET", url: `/r/${key}` });
  const exact = await app.inject({ method: "GET", url: `/r/${key}/1.2.3` });
  const invite = await app.inject({ method: "GET", url: "/w/invite_safeHandle123" });
  const image = await app.inject({ method: "GET", url: `/og/r/${key}?version=1.2.3` });

  assert.equal(latest.statusCode, 200);
  assert.equal(exact.statusCode, 200);
  assert.match(latest.body, /Latest research navigator/);
  assert.match(exact.body, /Research navigator/);
  assert.match(exact.headers["cache-control"] ?? "", /immutable/);
  assert.equal(invite.statusCode, 200);
  assert.match(invite.headers["cache-control"] ?? "", /no-store/);
  assert.doesNotMatch(invite.body, /ohwi_/);
  assert.equal(image.headers["content-type"], "image/png");
  assert.deepEqual(seen, [
    { id: "github:acme/skill", version: undefined },
    { id: "github:acme/skill", version: "1.2.3" },
    { id: "github:acme/skill", version: "1.2.3" }
  ]);
  await app.close();
});

test("expired workspace preview is generic and never redirects to an empty workspace", async () => {
  const app = Fastify({ logger: false });
  await registerSharePreviewRoutes(app, {
    resource: async () => ({ ok: false, status: 404, code: "SHARE_NOT_FOUND" }),
    capability: async () => ({ ok: false, status: 404, code: "SHARE_NOT_FOUND" }),
    workspace: async () => ({ ok: false, status: 410, code: "SHARE_EXPIRED" })
  });
  const response = await app.inject({ method: "GET", url: "/w/invite_expiredHandle" });
  assert.equal(response.statusCode, 410);
  assert.match(response.body, /Workspace invite unavailable/);
  assert.match(response.body, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(response.body, /location\.replace\("https:\/\/superskill\.sh\/#\/superskill"\)/);
  assert.doesNotMatch(response.body, /workspace=/);
  await app.close();
});

test("unknown workspace preview is noindex and shares one cached failure image", async () => {
  const app = Fastify({ logger: false });
  await registerSharePreviewRoutes(app, {
    resource: async () => ({ ok: false, status: 404, code: "SHARE_NOT_FOUND" }),
    capability: async () => ({ ok: false, status: 404, code: "SHARE_NOT_FOUND" }),
    workspace: async () => ({ ok: false, status: 404, code: "SHARE_NOT_FOUND" })
  });
  const page = await app.inject({ method: "GET", url: "/w/invite_unknownHandle" });
  const firstImage = await app.inject({ method: "GET", url: "/og/w/invite_unknownHandle" });
  const secondImage = await app.inject({ method: "GET", url: "/og/w/invite_anotherUnknown" });
  assert.equal(page.statusCode, 404);
  assert.match(page.body, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.equal(firstImage.statusCode, 404);
  assert.equal(secondImage.statusCode, 404);
  assert.deepEqual(firstImage.rawPayload, secondImage.rawPayload);
  await app.close();
});
