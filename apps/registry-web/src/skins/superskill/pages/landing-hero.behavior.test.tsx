import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { TaskPrompt } from "../components/TaskPrompt";
import { Landing } from "./Landing";

const emptyShowroom = JSON.stringify({ items: [], total: 0, generatedAt: "2026-07-12T00:00:00Z" });

function stubEmptyShowroom() {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(emptyShowroom, { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

test("install-first hero: the universal-link install block leads, with the task prompt offered below", async () => {
  const fetchMock = stubEmptyShowroom();
  const { container } = render(<Landing />);

  const taskInput = screen.getByLabelText("Task");
  // Install-first: the one-link install block (or its honest fallback when the runtime is not
  // published) leads the hero; the task prompt sits below as a secondary "or start with the outcome" path.
  const installBlock = container.querySelector(".ss-one-link-card") ?? container.querySelector(".ss-hero .ss-state");
  expect(installBlock).not.toBeNull();

  const relation = installBlock!.compareDocumentPosition(taskInput);
  expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(/or start with the outcome/i)).toBeTruthy();

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
});

test("hero H1 leads with the one-link install promise", async () => {
  const fetchMock = stubEmptyShowroom();
  render(<Landing />);

  const h1 = screen.getByRole("heading", { level: 1 });
  expect(h1).toHaveTextContent("Paste one link");
  expect(h1).toHaveTextContent("Give your agent every skill");

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
});

test("TaskPrompt CTA reads 'Find skill' and no longer says 'Continue in client'", () => {
  render(<TaskPrompt onContinue={vi.fn()} />);
  expect(screen.getByRole("button", { name: /find skill/i })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /continue in client/i })).toBeNull();
});
