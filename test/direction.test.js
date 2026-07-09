"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectDirection, splitDirectionalRuns } = require("../src/direction");

test("detects Hebrew as RTL", () => {
  assert.equal(detectDirection("שלום world"), "rtl");
});

test("detects English as LTR", () => {
  assert.equal(detectDirection("Hello עולם"), "ltr");
});

test("detects mostly Hebrew text as RTL when it starts with an English term", () => {
  assert.equal(
    detectDirection("Keycloak הוא שרת קוד פתוח לניהול זהויות והרשאות"),
    "rtl"
  );
});

test("ignores punctuation and numbers before the first strong character", () => {
  assert.equal(detectDirection("123... עברית"), "rtl");
  assert.equal(detectDirection("42 - English"), "ltr");
});

test("returns auto when there is no strong character", () => {
  assert.equal(detectDirection("123 +-="), "auto");
});

test("splits multi-word English terms into isolated LTR runs", () => {
  assert.deepEqual(
    splitDirectionalRuns(
      "Zoraxy הוא Reverse Proxy מודרני ל-Homelab ול-Self-Hosted כמו Nginx Proxy Manager"
    ),
    [
      { value: "Zoraxy", direction: "ltr" },
      { value: " הוא ", direction: "auto" },
      { value: "Reverse Proxy", direction: "ltr" },
      { value: " מודרני ל-", direction: "auto" },
      { value: "Homelab", direction: "ltr" },
      { value: " ול-", direction: "auto" },
      { value: "Self-Hosted", direction: "ltr" },
      { value: " כמו ", direction: "auto" },
      { value: "Nginx Proxy Manager", direction: "ltr" }
    ]
  );
});

test("keeps Hebrew technical prose RTL despite acronym-heavy English terms", () => {
  assert.equal(detectDirection("API JSON CSS הם מונחים טכניים נפוצים"), "rtl");
});
