"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..", "..");
const SCRIPTS = [
  "src/settings.js",
  "src/sites.js",
  "src/direction.js",
  "src/toggle.js",
  "src/content.js"
];

/** Minimal stand-in for the pieces of `browser.storage` the extension uses. */
function createStorageStub(initial) {
  const store = { ...initial };
  const listeners = [];

  return {
    storage: {
      local: {
        async get(defaults) {
          const result = { ...defaults };
          for (const key of Object.keys(defaults ?? {})) {
            if (key in store) {
              result[key] = store[key];
            }
          }
          return result;
        },
        async set(patch) {
          const changes = {};
          for (const [key, value] of Object.entries(patch)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = value;
          }
          for (const listener of listeners) {
            listener(changes, "local");
          }
        }
      },
      onChanged: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    }
  };
}

/**
 * Boots the content script against a fake ChatGPT page.
 *
 * `settle()` drains the microtask queue and two animation frames, which is
 * how long the observer takes to batch and flush a change.
 */
async function createPage(bodyHtml, initialSettings = {}, options = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: options.url ?? "https://chatgpt.com/"
  });

  const { window } = dom;
  window.browser = createStorageStub(initialSettings);

  const context = dom.getInternalVMContext();
  for (const script of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, script), "utf8"), context, {
      filename: script
    });
  }

  const settle = async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
  };

  await settle();

  return {
    dom,
    window,
    document: window.document,
    settle,
    setSettings: async (patch) => {
      await window.browser.storage.local.set(patch);
      await settle();
    },
    close: () => dom.window.close()
  };
}

/** Structural fingerprint used to prove the extension never rewrites the DOM. */
function structureOf(element) {
  return {
    text: element.textContent,
    nodes: element.querySelectorAll("*").length,
    tags: Array.from(element.querySelectorAll("*"))
      .map((node) => node.tagName)
      .join(",")
  };
}

module.exports = { createPage, structureOf };
