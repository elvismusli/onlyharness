import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { HarnessStore, useHarness } from "./store";
import type { HarnessStoreValue } from "./store";
import type { RegistryItem } from "./types";

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
