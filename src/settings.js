"use strict";

/**
 * Single source of truth for the extension's settings. Loaded by the content
 * script, the popup, the options page and the background script so that a new
 * setting only ever has to be declared once.
 */
(function exposeSettings(globalObject) {
  const extensionApi = globalObject.browser ?? globalObject.chrome;

  const DEFAULTS = Object.freeze({
    /** Master switch. Toggling it takes effect without reloading the tab. */
    enabled: true,
    /** "auto" resolves direction per block; "rtl" forces every message RTL. */
    mode: "auto",
    /** Per-paragraph direction inside the prompt box. */
    patchComposer: true,
    /** Direction for conversation titles in the sidebar. */
    patchSidebar: true,
    /** Let Hebrew prose inside a code fence render right to left. */
    smartCodeBlocks: true
  });

  async function read() {
    if (!extensionApi?.storage?.local) {
      return { ...DEFAULTS };
    }

    const stored = await extensionApi.storage.local.get(DEFAULTS);
    return { ...DEFAULTS, ...stored };
  }

  async function write(patch) {
    if (!extensionApi?.storage?.local) {
      return;
    }

    await extensionApi.storage.local.set(patch);
  }

  const api = { DEFAULTS, read, write };
  globalObject.ChatGptRtlSettings = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
