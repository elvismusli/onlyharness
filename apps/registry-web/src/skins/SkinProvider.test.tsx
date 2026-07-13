import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

/* A hoisted holder so the (hoisted) `vi.mock` factory can reach `useSkin`, which
   is only available after the real import below runs. The factory itself stays
   synchronous — probes read `holder.useSkin` lazily at render time. */
const holder = vi.hoisted(() => ({ useSkin: null as unknown as typeof import("./SkinProvider").useSkin }));

/* Swap the real skin registry for two lightweight probe skins so these tests
   exercise resolution/persistence without mounting the whole Win98 app. Each
   mount reports the resolved skin id and exposes a button to switch skins. */
vi.mock("./registry", () => {
  function makeProbe(id: string) {
    return function Probe() {
      const { skin, setSkin } = holder.useSkin();
      return (
        <div>
          <span data-testid="mounted">{id}</span>
          <span data-testid="active">{skin}</span>
          <button onClick={() => setSkin("modern")}>to-modern</button>
        </div>
      );
    };
  }
  return {
    SKINS: [
      { id: "win98", label: "W98", icon: "🪟", mount: makeProbe("win98") },
      { id: "modern", label: "Modern", icon: "✨", mount: makeProbe("modern") },
      { id: "superskill", label: "SuperSkill", icon: "S", mount: makeProbe("superskill") }
    ]
  };
});

import {
  isSkinSwitcherEnabled,
  resolveConfiguredDefaultSkin,
  resolveHostnameDefaultSkin,
  resolveInitialSkinChoice,
  resolveRequestedSkinChoice,
  SkinProvider,
  useSkin
} from "./SkinProvider";

holder.useSkin = useSkin;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  document.title = "OnlyHarness 98";
});

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

test("resolves ?skin=win98 from the URL param", () => {
  window.history.replaceState(null, "", "/?skin=win98");
  render(<SkinProvider />);
  expect(screen.getByTestId("mounted").textContent).toBe("win98");
  expect(screen.getByTestId("active").textContent).toBe("win98");
});

test("?skin= takes precedence over localStorage", () => {
  window.localStorage.setItem("oh:skin", "modern");
  window.history.replaceState(null, "", "/?skin=win98");
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("win98");
});

test("falls back to localStorage when no ?skin= param", () => {
  window.localStorage.setItem("oh:skin", "modern");
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("modern");
});

test("unknown ?skin=foo falls back to win98", () => {
  window.history.replaceState(null, "", "/?skin=foo");
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("win98");
});

test("unknown stored skin id falls back to win98", () => {
  window.localStorage.setItem("oh:skin", "nope");
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("win98");
});

test("defaults to win98 with no param and no stored value", () => {
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("win98");
});

test("configured default accepts a registered skin and fails safely for unknown values", () => {
  expect(resolveConfiguredDefaultSkin("modern")).toBe("modern");
  expect(resolveConfiguredDefaultSkin("unknown")).toBe("win98");
});

test("SuperSkill hostnames resolve to the Daylight skin without changing the OnlyHarness default", () => {
  expect(resolveHostnameDefaultSkin("superskill.sh")).toBe("superskill");
  expect(resolveHostnameDefaultSkin("WWW.SUPERSKILL.SH")).toBe("superskill");
  expect(resolveHostnameDefaultSkin("onlyharness.com")).toBeNull();
  expect(resolveHostnameDefaultSkin("localhost")).toBeNull();
});

test("SuperSkill hostname cannot be overridden by a legacy query or stored skin", () => {
  expect(resolveInitialSkinChoice({
    hostname: "superskill.sh",
    querySkin: "win98",
    storedSkin: "modern",
    configuredDefault: "win98"
  })).toBe("superskill");
  expect(resolveInitialSkinChoice({
    hostname: "www.superskill.sh",
    querySkin: "modern",
    storedSkin: "win98"
  })).toBe("superskill");
  expect(resolveRequestedSkinChoice("superskill.sh", "modern")).toBe("superskill");
  expect(resolveRequestedSkinChoice("www.superskill.sh", "win98")).toBe("superskill");
  expect(resolveRequestedSkinChoice("localhost", "modern")).toBe("modern");
});

test("uses the SuperSkill product title when the Daylight skin is active", () => {
  window.history.replaceState(null, "", "/?skin=superskill");
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("superskill");
  expect(document.title).toBe("SuperSkill — exact skills for agent tasks");
});

test("global skin switcher is hidden unless explicitly enabled", () => {
  render(<SkinProvider />);
  expect(screen.queryByRole("group", { name: "Choose skin" })).toBeNull();
});

test("skin switcher flag is strict and production-safe", () => {
  expect(isSkinSwitcherEnabled("true")).toBe(true);
  expect(isSkinSwitcherEnabled("TRUE")).toBe(false);
  expect(isSkinSwitcherEnabled(undefined)).toBe(false);
});

test("setSkin persists to localStorage and updates ?skin= while preserving the hash", () => {
  window.history.replaceState(null, "", "/?skin=win98#/h/acme/widget");
  render(<SkinProvider />);
  expect(screen.getByTestId("active").textContent).toBe("win98");

  act(() => {
    screen.getByText("to-modern").click();
  });

  expect(window.localStorage.getItem("oh:skin")).toBe("modern");
  expect(new URLSearchParams(window.location.search).get("skin")).toBe("modern");
  expect(window.location.hash).toBe("#/h/acme/widget");
  expect(screen.getByTestId("active").textContent).toBe("modern");
});
