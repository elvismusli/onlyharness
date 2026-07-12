import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  managedCapabilityIndexSchema,
  managedCapabilityHistorySchema,
  revocationTombstoneSchema,
  selectedShowroomListResponseSchema,
  showroomPreviewSchema,
  type ManagedCapability,
  type ManagedCapabilityIndex,
  type ManagedCapabilityHistory,
  type RevocationTombstone,
  type SelectedShowroomListResponse,
  type ShowroomCapability,
  type ShowroomListResponse
} from "@harnesshub/capability-schema/browser";
import { workspaceRoot } from "./registry.js";
import { evaluateManagedEligibility } from "./trust-policy.js";

export type ManagedCatalogOptions = {
  indexPath?: string;
  historyPath?: string;
  revocationsPath?: string;
  previewsPath?: string;
};

export class ManagedCatalogError extends Error {
  readonly reasonCode = "CATALOG_NOT_READY";
}

export class ManagedCatalog {
  readonly indexPath: string;
  readonly historyPath?: string;
  readonly revocationsPath?: string;
  readonly previewsPath: string;
  private loaded?: ManagedCapabilityIndex;
  private history?: ManagedCapabilityHistory;
  private loadError?: Error;
  private readonly revoked = new Map<string, RevocationTombstone>();

  constructor(options: ManagedCatalogOptions = {}) {
    this.indexPath = path.resolve(options.indexPath ?? process.env.SUPERSKILL_INDEX_PATH ?? path.join(workspaceRoot, "data/superskill/index.json"));
    const configuredHistory = options.historyPath
      ?? process.env.SUPERSKILL_HISTORY_PATH
      ?? (options.indexPath ? undefined : path.join(workspaceRoot, "data/superskill/history.json"));
    this.historyPath = configuredHistory ? path.resolve(configuredHistory) : undefined;
    const revokePath = options.revocationsPath ?? process.env.SUPERSKILL_REVOCATIONS_PATH;
    this.revocationsPath = revokePath ? path.resolve(revokePath) : undefined;
    this.previewsPath = path.resolve(options.previewsPath ?? path.join(workspaceRoot, "data/superskill/showroom-previews"));
    this.reload();
  }

  reload(): void {
    this.loaded = undefined;
    this.history = undefined;
    this.loadError = undefined;
    this.revoked.clear();
    try {
      this.loaded = managedCapabilityIndexSchema.parse(JSON.parse(readFileSync(this.indexPath, "utf8")));
      this.history = this.historyPath && existsSync(this.historyPath)
        ? managedCapabilityHistorySchema.parse(JSON.parse(readFileSync(this.historyPath, "utf8")))
        : { schemaVersion: "superskill.history.v1", generatedAt: this.loaded.generatedAt, capabilities: [] };
      const ids = new Set<string>();
      const releases = new Set<string>();
      for (const capability of this.loaded.capabilities) {
        if (ids.has(capability.id)) throw new Error(`Duplicate capability id: ${capability.id}`);
        const release = `${capability.release.ref}@${capability.release.version}`;
        if (releases.has(release)) throw new Error(`Duplicate managed release: ${release}`);
        ids.add(capability.id);
        releases.add(release);
      }
      const historyReleases = new Set<string>();
      for (const capability of this.history.capabilities) {
        const release = `${capability.id}\0${capability.release.version}`;
        if (historyReleases.has(release)) throw new Error(`Duplicate managed history release: ${capability.release.ref}@${capability.release.version}`);
        historyReleases.add(release);
      }
      this.loadRevocations();
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error));
    }
  }

  ready(): boolean {
    return Boolean(this.loaded) && !this.loadError;
  }

  error(): Error | undefined {
    return this.loadError;
  }

  generatedAt(): string {
    return this.index().generatedAt;
  }

  listApproved(job?: string): ManagedCapability[] {
    return this.index().capabilities
      .map((item) => this.withRevocationOverlay(item))
      .filter((item) => item.trust.status === "approved" && (!job || item.jobs.some((candidate) => candidate.id === job)));
  }

  listAll(): ManagedCapability[] {
    return this.index().capabilities.map((item) => this.withRevocationOverlay(item));
  }

  listSelected(job?: string): ManagedCapability[] {
    return this.index().capabilities
      .map((item) => this.withRevocationOverlay(item))
      .filter((item) => item.trust.status === "candidate" && (!job || item.jobs.some((candidate) => candidate.id === job)));
  }

  detail(id: string): ManagedCapability | undefined {
    const capability = this.index().capabilities.find((item) => item.id === id);
    return capability ? this.withRevocationOverlay(capability) : undefined;
  }

  exact(id: string, version: string): ManagedCapability | undefined {
    const capability = this.index().capabilities.find((item) => item.id === id && item.release.version === version)
      ?? this.history?.capabilities.find((item) => item.id === id && item.release.version === version);
    return capability ? this.withRevocationOverlay(capability) : undefined;
  }

  revocation(digest: string): RevocationTombstone | undefined {
    return this.revoked.get(digest);
  }

  showroomList(limit: number, job?: string, now = new Date()): ShowroomListResponse {
    const capabilities = this.listApproved(job).filter((capability) => eligibleForBothClients(capability, now));
    return {
      items: capabilities.slice(0, limit).map((capability) => this.showroomItem(capability, now)),
      total: capabilities.length,
      generatedAt: this.generatedAt()
    };
  }

  selectedShowroomList(limit: number, job?: string): SelectedShowroomListResponse {
    const capabilities = this.listSelected(job);
    return selectedShowroomListResponseSchema.parse({
      items: capabilities.slice(0, limit).map((capability) => ({
        capability,
        status: "selected_unreviewed",
        managedHandoff: { status: "blocked", reason: "review_required" }
      })),
      total: capabilities.length,
      generatedAt: this.generatedAt()
    });
  }

  showroomDetail(id: string, now = new Date()): ShowroomCapability | undefined {
    const capability = this.detail(id);
    if (!capability || capability.trust.status === "candidate") return undefined;
    return this.showroomItem(capability, now);
  }

  private showroomItem(capability: ManagedCapability, now: Date): ShowroomCapability {
    const clientHandoff = publicClientHandoff(capability, now);
    const previewPath = path.join(this.previewsPath, `${capability.id}.json`);
    if (!existsSync(previewPath)) return { capability, clientHandoff };
    try {
      const preview = showroomPreviewSchema.parse(JSON.parse(readFileSync(previewPath, "utf8")));
      if (preview.capabilityId !== capability.id || preview.artifactDigest !== capability.release.artifactDigest) return { capability, clientHandoff };
      return { capability, clientHandoff, preview };
    } catch {
      return { capability, clientHandoff };
    }
  }

  private index(): ManagedCapabilityIndex {
    if (!this.loaded || this.loadError) {
      throw new ManagedCatalogError(this.loadError ? `Managed catalog is not ready: ${this.loadError.message}` : "Managed catalog is not ready");
    }
    return this.loaded;
  }

  private withRevocationOverlay(capability: ManagedCapability): ManagedCapability {
    const tombstone = this.revoked.get(capability.release.artifactDigest);
    if (!tombstone) return capability;
    return {
      ...capability,
      trust: {
        ...capability.trust,
        status: "revoked",
        limitations: [...new Set([
          ...capability.trust.limitations,
          `Revoked: ${tombstone.reasonCode}`,
          ...(tombstone.replacement ? [`Replacement: ${tombstone.replacement.ref}@${tombstone.replacement.version} (${tombstone.replacement.artifactDigest})`] : [])
        ])]
      }
    };
  }

  private loadRevocations(): void {
    if (!this.revocationsPath || !existsSync(this.revocationsPath)) return;
    const eventDigests = new Map<string, string>();
    for (const [index, line] of readFileSync(this.revocationsPath, "utf8").split("\n").entries()) {
      if (!line.trim()) continue;
      const tombstone = revocationTombstoneSchema.parse(JSON.parse(line));
      const existingDigest = eventDigests.get(tombstone.eventId);
      if (existingDigest && existingDigest !== tombstone.artifactDigest) {
        throw new Error(`Revocation event ${tombstone.eventId} conflicts at line ${index + 1}`);
      }
      eventDigests.set(tombstone.eventId, tombstone.artifactDigest);
      const existing = this.revoked.get(tombstone.artifactDigest);
      if (!existing) {
        this.revoked.set(tombstone.artifactDigest, tombstone);
        continue;
      }
      const aliases = [...existing.aliases];
      for (const alias of tombstone.aliases) {
        if (!aliases.some((item) => item.capabilityId === alias.capabilityId && item.ref === alias.ref && item.version === alias.version)) aliases.push(alias);
      }
      this.revoked.set(tombstone.artifactDigest, { ...existing, aliases });
    }
  }
}

function eligibleForBothClients(capability: ManagedCapability, now: Date): boolean {
  return evaluateManagedEligibility(capability, "claude-code", now).eligible
    && evaluateManagedEligibility(capability, "codex", now).eligible;
}

function publicClientHandoff(capability: ManagedCapability, now: Date): ShowroomCapability["clientHandoff"] {
  if (capability.trust.status === "revoked") return { status: "blocked", reason: "revoked" };
  if (capability.trust.status === "quarantined") return { status: "blocked", reason: "quarantined" };
  if (!eligibleForBothClients(capability, now)) return { status: "blocked", reason: "stale_or_ineligible_evidence" };
  return { status: "available" };
}
