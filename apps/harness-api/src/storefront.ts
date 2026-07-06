import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type StorefrontProfileInput = {
  userId: string;
  handle?: string;
  displayName?: string;
  bio?: string;
};

export type PublicStorefrontProfile = {
  handle: string;
  display_name: string;
  bio: string;
};

export type StorefrontProfile = PublicStorefrontProfile & {
  user_id: string;
  referral_code: string;
};

export type StorefrontHarnessRef = {
  owner: string;
  repo: string;
};

export type StorefrontPage = {
  profile: PublicStorefrontProfile;
  referralCode: string;
  harnesses: StorefrontHarnessRef[];
};

export type CheckoutAttributionInput = {
  owner: string;
  repo: string;
  referralCode?: string;
};

export type CheckoutAttribution = {
  referralCode?: string;
  creatorUserId?: string;
};

type StorefrontResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

type ProfileRow = {
  id?: string;
  user_id?: string;
  handle?: string | null;
  display_name?: string | null;
  bio?: string | null;
};

type ReferralRow = {
  code: string;
  user_id: string;
};

type HarnessCreatorRow = {
  owner: string;
  repo: string;
  user_id: string;
};

type LocalStorefrontState = {
  profiles: Array<Required<Pick<ProfileRow, "user_id" | "handle" | "display_name" | "bio">> & { updated_at?: string }>;
  referralCodes: ReferralRow[];
  harnessCreators: HarnessCreatorRow[];
};

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const supabaseRestKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localStorefrontPath = process.env.HARNESS_LOCAL_STOREFRONT_PATH
  ? path.resolve(process.env.HARNESS_LOCAL_STOREFRONT_PATH)
  : undefined;

export function normalizeHandle(value: string | undefined): string | undefined {
  const handle = value?.trim().replace(/^@/, "").toLowerCase();
  if (!handle || handle.length < 3 || handle.length > 32) return undefined;
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(handle)) return undefined;
  return handle;
}

export function cleanReferralCode(value: string | undefined): string | undefined {
  const code = value?.trim();
  if (!code) return undefined;
  return /^[a-zA-Z0-9_-]{3,64}$/.test(code) ? code : undefined;
}

export async function upsertStorefrontProfile(input: StorefrontProfileInput): Promise<StorefrontResult<StorefrontProfile>> {
  const handle = normalizeHandle(input.handle);
  if (!handle) return { ok: false, status: 400, error: "handle must be 3-32 lowercase letters, numbers or hyphens" };
  if (supabaseUrl && supabaseRestKey) return upsertSupabaseStorefrontProfile(input, handle);
  if (localStorefrontPath) return upsertLocalStorefrontProfile(input, handle);
  return { ok: false, status: 503, error: "Storefront store unavailable" };
}

export async function fetchMyStorefront(userId: string): Promise<StorefrontResult<StorefrontProfile>> {
  if (supabaseUrl && supabaseRestKey) return fetchSupabaseProfileByUser(userId);
  if (localStorefrontPath) return fetchLocalProfileByUser(userId);
  return { ok: false, status: 503, error: "Storefront store unavailable" };
}

export async function fetchStorefrontByHandle(rawHandle: string): Promise<StorefrontResult<StorefrontPage>> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, status: 400, error: "Invalid handle" };
  if (supabaseUrl && supabaseRestKey) return fetchSupabaseStorefrontByHandle(handle);
  if (localStorefrontPath) return fetchLocalStorefrontByHandle(handle);
  return { ok: false, status: 503, error: "Storefront store unavailable" };
}

export async function upsertHarnessCreator(owner: string, repo: string, userId: string): Promise<boolean> {
  if (!isOwnerRepo(owner) || !isOwnerRepo(repo)) return false;
  if (supabaseUrl && supabaseRestKey) return upsertSupabaseHarnessCreator(owner, repo, userId);
  if (localStorefrontPath) {
    const state = readLocalStorefrontState();
    const existing = state.harnessCreators.find((row) => row.owner === owner && row.repo === repo);
    if (existing) existing.user_id = userId;
    else state.harnessCreators.push({ owner, repo, user_id: userId });
    writeLocalStorefrontState(state);
    return true;
  }
  return false;
}

export async function resolveCheckoutAttribution(input: CheckoutAttributionInput): Promise<StorefrontResult<CheckoutAttribution>> {
  const referralCode = input.referralCode ? cleanReferralCode(input.referralCode) : undefined;
  if (input.referralCode && !referralCode) return { ok: false, status: 400, error: "Invalid referral code" };
  if (supabaseUrl && supabaseRestKey) return resolveSupabaseCheckoutAttribution(input.owner, input.repo, referralCode);
  if (localStorefrontPath) return resolveLocalCheckoutAttribution(input.owner, input.repo, referralCode);
  return { ok: true, value: { referralCode } };
}

async function upsertSupabaseStorefrontProfile(input: StorefrontProfileInput, handle: string): Promise<StorefrontResult<StorefrontProfile>> {
  const payload = {
    id: input.userId,
    handle,
    display_name: cleanDisplayName(input.displayName, handle),
    bio: cleanBio(input.bio),
    updated_at: new Date().toISOString()
  };
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 409) return { ok: false, status: 409, error: "Handle is already taken" };
    if (!response.ok) return { ok: false, status: 502, error: `Profile upsert failed: HTTP ${response.status}` };
    const rows = await response.json() as ProfileRow[];
    const profile = rows[0] ?? payload;
    const referral = await ensureSupabaseReferralCode(input.userId, handle);
    if (!referral.ok) return referral;
    return { ok: true, value: profileWithReferral(profile, referral.value) };
  } catch {
    return { ok: false, status: 503, error: "Storefront store unavailable" };
  }
}

async function fetchSupabaseProfileByUser(userId: string): Promise<StorefrontResult<StorefrontProfile>> {
  const profile = await fetchSupabaseProfile(new URLSearchParams({ select: "id,handle,display_name,bio", id: `eq.${userId}`, limit: "1" }));
  if (!profile.ok) return profile;
  const row = profile.value;
  if (!row.handle) return { ok: false, status: 404, error: "Storefront profile not configured" };
  const referral = await ensureSupabaseReferralCode(userId, row.handle);
  if (!referral.ok) return referral;
  return { ok: true, value: profileWithReferral(row, referral.value) };
}

async function fetchSupabaseStorefrontByHandle(handle: string): Promise<StorefrontResult<StorefrontPage>> {
  const profile = await fetchSupabaseProfile(new URLSearchParams({ select: "id,handle,display_name,bio", handle: `eq.${handle}`, limit: "1" }));
  if (!profile.ok) return profile;
  const userId = profile.value.id;
  if (!userId || !profile.value.handle) return { ok: false, status: 404, error: "Storefront not found" };
  const referral = await fetchSupabaseReferralCodeForUser(userId);
  const harnesses = await fetchSupabaseHarnessCreatorRefs(userId);
  return {
    ok: true,
    value: {
      profile: publicProfile(profile.value),
      referralCode: referral ?? "",
      harnesses
    }
  };
}

async function resolveSupabaseCheckoutAttribution(owner: string, repo: string, referralCode: string | undefined): Promise<StorefrontResult<CheckoutAttribution>> {
  const creatorUserId = await fetchSupabaseHarnessCreator(owner, repo);
  if (!referralCode) return { ok: true, value: { creatorUserId } };
  const referral = await fetchSupabaseReferralCode(referralCode);
  if (!referral) return { ok: false, status: 400, error: "Unknown referral code" };
  if (creatorUserId && referral.user_id !== creatorUserId) {
    return { ok: false, status: 400, error: "Referral code does not belong to this harness creator" };
  }
  return { ok: true, value: { referralCode: referral.code, creatorUserId: creatorUserId ?? referral.user_id } };
}

async function fetchSupabaseProfile(params: URLSearchParams): Promise<StorefrontResult<ProfileRow>> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return { ok: false, status: 502, error: `Profile lookup failed: HTTP ${response.status}` };
    const rows = await response.json() as ProfileRow[];
    const row = rows[0];
    if (!row) return { ok: false, status: 404, error: "Storefront not found" };
    return { ok: true, value: row };
  } catch {
    return { ok: false, status: 503, error: "Storefront store unavailable" };
  }
}

async function ensureSupabaseReferralCode(userId: string, handle: string): Promise<StorefrontResult<string>> {
  const existing = await fetchSupabaseReferralCodeForUser(userId);
  if (existing) return { ok: true, value: existing };
  for (const code of referralCodeCandidates(userId, handle)) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/referral_codes`, {
        method: "POST",
        headers: {
          ...supabaseRestHeaders(),
          "content-type": "application/json",
          prefer: "return=minimal"
        },
        body: JSON.stringify({ code, user_id: userId })
      });
      if (response.ok) return { ok: true, value: code };
      if (response.status !== 409) return { ok: false, status: 502, error: `Referral code insert failed: HTTP ${response.status}` };
    } catch {
      return { ok: false, status: 503, error: "Storefront store unavailable" };
    }
  }
  return { ok: false, status: 409, error: "Referral code is already taken" };
}

async function fetchSupabaseReferralCodeForUser(userId: string): Promise<string | undefined> {
  const params = new URLSearchParams({ select: "code", user_id: `eq.${userId}`, limit: "1" });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/referral_codes?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as Array<{ code?: string }>;
    return rows[0]?.code;
  } catch {
    return undefined;
  }
}

async function fetchSupabaseReferralCode(code: string): Promise<ReferralRow | undefined> {
  const params = new URLSearchParams({ select: "code,user_id", code: `eq.${code}`, limit: "1" });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/referral_codes?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as ReferralRow[];
    return rows[0];
  } catch {
    return undefined;
  }
}

async function upsertSupabaseHarnessCreator(owner: string, repo: string, userId: string): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_creators?on_conflict=owner,repo`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ owner, repo, user_id: userId, updated_at: new Date().toISOString() })
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchSupabaseHarnessCreator(owner: string, repo: string): Promise<string | undefined> {
  const params = new URLSearchParams({ select: "user_id", owner: `eq.${owner}`, repo: `eq.${repo}`, limit: "1" });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_creators?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return undefined;
    const rows = await response.json() as Array<{ user_id?: string }>;
    return rows[0]?.user_id;
  } catch {
    return undefined;
  }
}

async function fetchSupabaseHarnessCreatorRefs(userId: string): Promise<StorefrontHarnessRef[]> {
  const params = new URLSearchParams({ select: "owner,repo", user_id: `eq.${userId}`, order: "updated_at.desc", limit: "50" });
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/harness_creators?${params.toString()}`, {
      headers: supabaseRestHeaders()
    });
    if (!response.ok) return [];
    return await response.json() as StorefrontHarnessRef[];
  } catch {
    return [];
  }
}

function upsertLocalStorefrontProfile(input: StorefrontProfileInput, handle: string): StorefrontResult<StorefrontProfile> {
  const state = readLocalStorefrontState();
  if (state.profiles.some((profile) => profile.handle === handle && profile.user_id !== input.userId)) {
    return { ok: false, status: 409, error: "Handle is already taken" };
  }
  const current = state.profiles.find((profile) => profile.user_id === input.userId);
  const row = {
    user_id: input.userId,
    handle,
    display_name: cleanDisplayName(input.displayName, current?.display_name ?? handle),
    bio: cleanBio(input.bio ?? current?.bio),
    updated_at: new Date().toISOString()
  };
  if (current) Object.assign(current, row);
  else state.profiles.push(row);
  const referral = ensureLocalReferralCode(state, input.userId, handle);
  writeLocalStorefrontState(state);
  return { ok: true, value: profileWithReferral(row, referral) };
}

function fetchLocalProfileByUser(userId: string): StorefrontResult<StorefrontProfile> {
  const state = readLocalStorefrontState();
  const row = state.profiles.find((profile) => profile.user_id === userId);
  if (!row) return { ok: false, status: 404, error: "Storefront profile not configured" };
  const handle = normalizeHandle(row.handle ?? "");
  if (!handle) return { ok: false, status: 404, error: "Storefront profile not configured" };
  const referral = ensureLocalReferralCode(state, userId, handle);
  writeLocalStorefrontState(state);
  return { ok: true, value: profileWithReferral(row, referral) };
}

function fetchLocalStorefrontByHandle(handle: string): StorefrontResult<StorefrontPage> {
  const state = readLocalStorefrontState();
  const row = state.profiles.find((profile) => profile.handle === handle);
  if (!row) return { ok: false, status: 404, error: "Storefront not found" };
  const referral = state.referralCodes.find((code) => code.user_id === row.user_id)?.code ?? "";
  return {
    ok: true,
    value: {
      profile: publicProfile(row),
      referralCode: referral,
      harnesses: state.harnessCreators
        .filter((creator) => creator.user_id === row.user_id)
        .map(({ owner, repo }) => ({ owner, repo }))
    }
  };
}

function resolveLocalCheckoutAttribution(owner: string, repo: string, referralCode: string | undefined): StorefrontResult<CheckoutAttribution> {
  const state = readLocalStorefrontState();
  const creatorUserId = state.harnessCreators.find((creator) => creator.owner === owner && creator.repo === repo)?.user_id;
  if (!referralCode) return { ok: true, value: { creatorUserId } };
  const referral = state.referralCodes.find((row) => row.code === referralCode);
  if (!referral) return { ok: false, status: 400, error: "Unknown referral code" };
  if (creatorUserId && referral.user_id !== creatorUserId) {
    return { ok: false, status: 400, error: "Referral code does not belong to this harness creator" };
  }
  return { ok: true, value: { referralCode: referral.code, creatorUserId: creatorUserId ?? referral.user_id } };
}

function ensureLocalReferralCode(state: LocalStorefrontState, userId: string, handle: string): string {
  const existing = state.referralCodes.find((row) => row.user_id === userId);
  if (existing) return existing.code;
  for (const code of referralCodeCandidates(userId, handle)) {
    if (state.referralCodes.some((row) => row.code === code)) continue;
    state.referralCodes.push({ code, user_id: userId });
    return code;
  }
  const fallback = `ref_${shortHash(userId)}`;
  state.referralCodes.push({ code: fallback, user_id: userId });
  return fallback;
}

function readLocalStorefrontState(): LocalStorefrontState {
  if (!localStorefrontPath || !existsSync(localStorefrontPath)) return emptyLocalStorefrontState();
  try {
    const parsed = JSON.parse(readFileSync(localStorefrontPath, "utf8")) as LocalStorefrontState;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      referralCodes: Array.isArray(parsed.referralCodes) ? parsed.referralCodes : [],
      harnessCreators: Array.isArray(parsed.harnessCreators) ? parsed.harnessCreators : []
    };
  } catch {
    return emptyLocalStorefrontState();
  }
}

function writeLocalStorefrontState(state: LocalStorefrontState) {
  if (!localStorefrontPath) return;
  mkdirSync(path.dirname(localStorefrontPath), { recursive: true });
  writeFileSync(localStorefrontPath, `${JSON.stringify(state, null, 2)}\n`);
}

function emptyLocalStorefrontState(): LocalStorefrontState {
  return { profiles: [], referralCodes: [], harnessCreators: [] };
}

function profileWithReferral(row: ProfileRow, referralCode: string): StorefrontProfile {
  const handle = normalizeHandle(row.handle ?? "") ?? "unknown";
  return {
    user_id: row.user_id ?? row.id ?? "",
    handle,
    display_name: cleanDisplayName(row.display_name, handle),
    bio: cleanBio(row.bio),
    referral_code: referralCode
  };
}

function publicProfile(row: ProfileRow): PublicStorefrontProfile {
  const handle = normalizeHandle(row.handle ?? "") ?? "unknown";
  return {
    handle,
    display_name: cleanDisplayName(row.display_name, handle),
    bio: cleanBio(row.bio)
  };
}

function cleanDisplayName(value: string | null | undefined, fallback: string): string {
  const name = value?.trim().replace(/\s+/g, " ").slice(0, 80);
  return name || fallback;
}

function cleanBio(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/g, " ").slice(0, 280) ?? "";
}

function referralCodeCandidates(userId: string, handle: string): string[] {
  const base = `ref_${handle.replaceAll("-", "_")}`;
  return base.length <= 64 ? [base, `${base.slice(0, 54)}_${shortHash(userId)}`] : [`${base.slice(0, 54)}_${shortHash(userId)}`];
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function isOwnerRepo(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,80}$/.test(value);
}

function supabaseRestHeaders() {
  return {
    apikey: supabaseRestKey ?? "",
    authorization: `Bearer ${supabaseRestKey}`
  };
}
