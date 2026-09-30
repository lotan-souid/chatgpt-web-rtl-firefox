"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSite, GENERIC_ROOTS, SITES } = require("../src/sites");

test("resolves a known host to its own selectors", () => {
  const site = resolveSite("chatgpt.com");

  assert.equal(site.key, "chatgpt");
  assert.ok(site.roots.includes("[data-message-author-role]"));
  assert.ok(site.roots.includes("article[data-testid^=\"conversation-turn-\"]"));
});

test("matches subdomains of a known host", () => {
  assert.equal(resolveSite("chat.openai.com").key, "chatgpt");
  assert.equal(resolveSite("www.perplexity.ai").key, "perplexity");
});

test("does not match a host that merely ends with the same letters", () => {
  // "notchatgpt.com" must not be treated as a subdomain of "chatgpt.com".
  assert.equal(resolveSite("notchatgpt.com").key, "generic");
});

test("is case insensitive", () => {
  assert.equal(resolveSite("Claude.AI").key, "claude");
});

test("falls back to the generic selectors for an unknown host", () => {
  const site = resolveSite("example.com");

  assert.equal(site.key, "generic");
  assert.deepEqual(site.roots, [...GENERIC_ROOTS]);
  assert.deepEqual(site.ownComposers, []);
  assert.deepEqual(site.ownSidebars, []);
});

test("always appends the generic selectors, so a stale entry degrades", () => {
  for (const entry of SITES) {
    const site = resolveSite(entry.hosts[0]);
    for (const generic of GENERIC_ROOTS) {
      assert.ok(
        site.roots.includes(generic),
        `${entry.key} is missing the generic selector ${generic}`
      );
    }
  }
});

test("never yields an empty selector list", () => {
  for (const entry of SITES) {
    const site = resolveSite(entry.hosts[0]);
    assert.ok(site.roots.length > 0);
    assert.ok(site.composers.length > 0);
    assert.ok(site.sidebars.length > 0);
    assert.equal(site.roots.join(", ").includes(",, "), false);
  }
});

test("reports the site's own selectors separately from the generic ones", () => {
  const site = resolveSite("chatgpt.com");

  assert.deepEqual(site.ownComposers, [
    "#prompt-textarea",
    "textarea[data-id=\"root\"]"
  ]);
  assert.deepEqual(site.ownSidebars, ["#history a"]);
});

test("deduplicates a selector a site shares with the generic set", () => {
  const site = resolveSite("chatgpt.com");
  const occurrences = site.roots.filter(
    (selector) => selector === "[data-message-author-role]"
  );

  assert.equal(occurrences.length, 1);
});

test("every host is claimed by exactly one entry", () => {
  const seen = new Set();

  for (const entry of SITES) {
    for (const host of entry.hosts) {
      assert.equal(seen.has(host), false, `${host} is registered twice`);
      seen.add(host);
    }
  }
});
