import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { HarnessStore, useHarness } from "./store";
import type { HarnessStoreValue } from "./store";
import type { RegistryItem, ResourceItem } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/** A probe child that hoists the composed store value out for assertions. */
function Probe({ onReady }: { onReady: (value: HarnessStoreValue) => void }) {
  const harness = useHarness();
  onReady(harness);
  return null;
}

function renderStore() {
  let latest: HarnessStoreValue | null = null;
  render(
    <HarnessStore>
      <Probe onReady={(value) => { latest = value; }} />
    </HarnessStore>
  );
  if (!latest) throw new Error("store did not render");
  return () => latest as HarnessStoreValue;
}

test("useHarness exposes the composed surface stack, orchestration, social, and chrome APIs", () => {
  // The registry hook fires fetches on mount; stub them so nothing hits the network.
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));

  const get = renderStore();
  const harness = get();

  expect(Array.isArray(harness.surfaces)).toBe(true);
  expect(typeof harness.openHarness).toBe("function");
  expect(typeof harness.toggleStar).toBe("function");
  expect(typeof harness.flashMsg).toBe("function");
  expect(typeof harness.showDialog).toBe("function");
});

test("openHarness pushes a harness surface onto the stack", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));

  const get = renderStore();

  const item = { owner: "acme", name: "widget", title: "Widget" } as RegistryItem;
  act(() => {
    get().openHarness(item);
  });

  await waitFor(() => {
    const surfaces = get().surfaces;
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]).toMatchObject({ id: "harness:acme/widget", kind: "harness", key: "acme/widget" });
  });
  expect(get().activeId).toBe("harness:acme/widget");
});

test("openResource shows copyable SuperSkill-first resource use rows", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) }));

  const get = renderStore();
  const item = {
    id: "github:obra/superpowers",
    title: "superpowers",
    canonicalUrl: "https://github.com/obra/superpowers",
    upstreamOwner: "obra",
    upstreamRepo: "superpowers",
    actions: [
      { id: "open_onlyharness", label: "Use in SuperSkill", url: "https://superskill.sh/#/superskill/resources/github%3Aobra%2Fsuperpowers" },
      { id: "download_archive", label: "Download archive", url: "https://superskill.sh/api/resources/github%3Aobra%2Fsuperpowers/archive" },
      { id: "open_upstream", label: "Open upstream", url: "https://github.com/obra/superpowers" }
    ]
  } as ResourceItem;

  act(() => {
    get().openResource(item);
  });

  await waitFor(() => {
    const dialog = get().dialog;
    expect(dialog?.title).toBe("Use superpowers");
    expect(dialog?.resourceUse?.rows.map((row) => row.label)).toEqual([
      "SuperSkill page",
      "CLI detail",
      "CLI open",
      "Hosted archive",
      "Upstream source"
    ]);
    expect(dialog?.resourceUse?.rows[1].value).toBe("npx onlyharness@latest resources detail github:obra/superpowers --json");
    expect(dialog?.resourceUse?.rows[2].value).toBe("npx onlyharness@latest resources open github:obra/superpowers --json");
    expect(dialog?.resourceUse?.rows[3].muted).toBeFalsy();
    expect(window.location.hash).toBe("#/superskill/resources/github%3Aobra%2Fsuperpowers");
  });
});
