import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../core/store", () => ({
  useHarness: () => harness.value
}));

import { FansLanding } from "./landing";
import { FansNav } from "./nav";

beforeEach(() => {
  harness.value = {
    user: null,
    myHandle: "",
    items: [],
    totals: { indexed: 0, stars: 0, forks: 0, threads: 0 },
    openCli: vi.fn(),
    openLogon: vi.fn(),
    openMyBriefcase: vi.fn(),
    openNetwork: vi.fn(),
    openPublish: vi.fn(),
    focus: vi.fn(),
    toggleStar: vi.fn()
  };
});

test("fans nav uses the shared signed-in session instead of showing Log in", () => {
  const openMyBriefcase = vi.fn();
  harness.value = {
    ...harness.value,
    user: { email: "user@example.com" },
    myHandle: "agent-fan",
    openMyBriefcase
  };

  render(<FansNav />);

  expect(screen.queryByText("Log in")).toBeNull();
  fireEvent.click(screen.getByText("@agent-fan"));
  expect(openMyBriefcase).toHaveBeenCalledOnce();
});

test("fans landing shows signed-in actions instead of a duplicate account form", () => {
  harness.value = {
    ...harness.value,
    user: { email: "user@example.com" }
  };

  render(<FansLanding />);

  expect(screen.getByText("Signed in as user@example.com")).toBeTruthy();
  expect(screen.getByText("Open profile")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Create your account" })).toBeNull();
  expect(screen.getByText("Your session is shared across every OnlyHarness skin.")).toBeTruthy();
});
