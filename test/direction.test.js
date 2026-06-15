"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectDirection } = require("../src/direction");

test("detects Hebrew as RTL", () => {
  assert.equal(detectDirection("שלום world"), "rtl");
});

test("detects English as LTR", () => {
  assert.equal(detectDirection("Hello עולם"), "ltr");
});

test("ignores punctuation and numbers before the first strong character", () => {
  assert.equal(detectDirection("123... עברית"), "rtl");
  assert.equal(detectDirection("42 - English"), "ltr");
});

test("returns auto when there is no strong character", () => {
  assert.equal(detectDirection("123 +-="), "auto");
});
