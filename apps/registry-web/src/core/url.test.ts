import { expect, test } from "vitest";
import {
  keyForCheckout,
  parseCheckoutLocation,
  parseHarnessHash,
  parseStorefrontHash,
  refFromLocation
} from "./url";

test("parseHarnessHash reads owner/name", () =>
  expect(parseHarnessHash("#/h/acme/deep-research")).toEqual({ owner: "acme", name: "deep-research" }));

test("parseHarnessHash decodes url-encoded segments", () =>
  expect(parseHarnessHash("#/h/ac%20me/deep%2Dresearch")).toEqual({ owner: "ac me", name: "deep-research" }));

test("parseHarnessHash tolerates a trailing query", () =>
  expect(parseHarnessHash("#/h/acme/deep-research?ref=xyz")).toEqual({ owner: "acme", name: "deep-research" }));

test("parseHarnessHash returns undefined for a storefront hash", () =>
  expect(parseHarnessHash("#/@neo")).toBeUndefined());

test("parseStorefrontHash strips @ and lowercases", () =>
  expect(parseStorefrontHash("#/@Neo")).toEqual({ handle: "neo" }));

test("parseStorefrontHash returns undefined for a harness hash", () =>
  expect(parseStorefrontHash("#/h/acme/x")).toBeUndefined());

test("parseCheckoutLocation reads query", () =>
  expect(parseCheckoutLocation("/checkout", "?owner=a&repo=b&version=1")).toMatchObject({
    owner: "a",
    repo: "b",
    version: "1"
  }));

test("parseCheckoutLocation defaults version to latest and reads optional refs", () =>
  expect(parseCheckoutLocation("/checkout", "?owner=a&repo=b&provider_ref=pr&ref=xyz")).toEqual({
    owner: "a",
    repo: "b",
    version: "latest",
    providerRef: "pr",
    ref: "xyz"
  }));

test("parseCheckoutLocation tolerates a trailing slash on the path", () =>
  expect(parseCheckoutLocation("/checkout/", "?owner=a&repo=b")).toMatchObject({ owner: "a", repo: "b" }));

test("parseCheckoutLocation returns undefined off the checkout path", () =>
  expect(parseCheckoutLocation("/", "?owner=a")).toBeUndefined());

test("parseCheckoutLocation returns undefined without owner or repo", () =>
  expect(parseCheckoutLocation("/checkout", "?owner=a")).toBeUndefined());

test("keyForCheckout encodes owner/repo/ref", () =>
  expect(keyForCheckout({ owner: "a", repo: "b", version: "1" })).toBe("a/b/1"));

test("keyForCheckout prefers providerRef over version and encodes segments", () =>
  expect(keyForCheckout({ owner: "a/x", repo: "b", version: "1", providerRef: "p r" })).toBe("a%2Fx/b/p%20r"));

test("keyForCheckout falls back to latest when version and providerRef are absent", () =>
  expect(keyForCheckout({ owner: "a", repo: "b", version: "" })).toBe("a/b/latest"));

test("refFromLocation finds ref in search", () =>
  expect(refFromLocation("?ref=xyz", "")).toBe("xyz"));

test("refFromLocation finds ref in a hash query when absent from search", () =>
  expect(refFromLocation("", "#/h/a/b?ref=hashref")).toBe("hashref"));

test("refFromLocation prefers the search ref over the hash ref", () =>
  expect(refFromLocation("?ref=fromsearch", "#/@neo?ref=fromhash")).toBe("fromsearch"));

test("refFromLocation returns undefined when no ref is present", () =>
  expect(refFromLocation("", "#/h/a/b")).toBeUndefined());
