import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function read(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

function mustInclude(file: string, needles: string[]) {
  const text = read(file);
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${file} missing workspace contract markers: ${missing.join(", ")}`);
}

mustInclude("apps/harness-api/src/server.ts", [
  "const workspacesEnabled = process.env.WORKSPACES_ENABLED === \"true\"",
  "app.get(\"/workspaces/:slug/workspace\"",
  "app.get(\"/workspaces/:slug/resources\"",
  "app.post(\"/workspaces/:slug/resources/approve\"",
  "app.get(\"/workspaces/:slug/resources/:id\"",
  "app.get(\"/workspaces/:slug/resources/:id/archive\"",
  "app.get(\"/workspaces/:slug/collections\"",
  "app.post(\"/workspaces/:slug/collections\"",
  "app.get(\"/workspaces/:slug/collections/:collection\"",
  "app.post(\"/workspaces/:slug/collections/:collection/items\"",
  "app.post(\"/workspaces/:slug/imports/resource-package\"",
  "workspaceTokenFromRequest"
]);

mustInclude("apps/harness-api/src/workspaces.ts", [
  "authorizeWorkspaceToken",
  "legacy_org_token",
  "workspaceResourceId",
  "upsertWorkspaceResource",
  "workspaceResourceArchivePath",
  "WORKSPACE_RESOURCE_ARCHIVE_DIR",
  "approveWorkspacePublicResource",
  "listWorkspaceCollections"
]);

mustInclude("apps/harness-api/src/openapi.ts", [
  "\"/workspaces/{slug}/workspace\"",
  "\"/workspaces/{slug}/resources\"",
  "\"/workspaces/{slug}/resources/approve\"",
  "\"/workspaces/{slug}/resources/{id}\"",
  "\"/workspaces/{slug}/resources/{id}/archive\"",
  "\"/workspaces/{slug}/collections\"",
  "\"/workspaces/{slug}/collections/{collection}\"",
  "\"/workspaces/{slug}/collections/{collection}/items\"",
  "\"/workspaces/{slug}/imports/resource-package\""
]);

mustInclude("packages/harness-cli/src/index.ts", [
  ".option(\"--workspace <slug>\"",
  "HH_WORKSPACE_TOKEN",
  "workspaceResourceRef",
  "resourcesCommand.command(\"approve\")",
  "/workspaces/${input.workspace}/imports/resource-package"
]);

mustInclude("supabase/migrations/20260708120000_workspaces_layer.sql", [
  "create table if not exists public.workspaces",
  "create table if not exists public.workspace_members",
  "create table if not exists public.workspace_tokens",
  "create table if not exists public.workspace_audit",
  "create table if not exists public.workspace_resources"
]);

mustInclude("supabase/migrations/20260708143000_workspace_collections.sql", [
  "create table if not exists public.workspace_collections",
  "create table if not exists public.workspace_collection_items",
  "collection:write",
  "approved_with_warning",
  "blocked_by_scan"
]);

mustInclude("apps/registry-web/src/core/useWorkspace.ts", [
  "/workspaces/${encodeURIComponent(slug)}/workspace",
  "workspaceHeadersForOwner"
]);

console.log("workspace contract ok");
