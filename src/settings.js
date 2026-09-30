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
    /**
     * "message" gives a whole message the direction of its dominant language,
     * the way a Hebrew Markdown document reads; "auto" resolves every block on
     * its own; "rtl" forces every message RTL.
     */
    mode: "message",
    /** Per-paragraph direction inside the prompt box. */
    patchComposer: true,
    /** Direction for conversation titles in the sidebar. */
    patchSidebar: true,
    /** Let Hebrew prose inside a code fence render right to left. */
    smartCodeBlocks: true,
    /**
     * Typeface for blocks that resolved right-to-left. "default" changes
     * nothing at all; the other values also relax line height, because Hebrew
     * has no ascenders or descenders to space the lines apart visually.
     */
    hebrewFont: "default",
    /**
     * An on-page toggle button. Off by default: the toolbar button, the
     * options page and Alt+Shift+R already cover this, and the button is the
     * only part of the extension that puts a node on the page.
     */
    floatingToggle: false
  });

  /** Accepted values for `hebrewFont`, in the order the options page lists them. */
  const HEBREW_FONTS = Object.freeze(["default", "system", "serif"]);

  /** Accepted values for `mode`, in the order the settings pages list them. */
  const MODES = Object.freeze(["message", "auto", "rtl"]);

  /** Guards against a stale or hand-edited value reaching the stylesheet. */
  function normalise(settings) {
    if (!HEBREW_FONTS.includes(settings.hebrewFont)) {
      settings.hebrewFont = DEFAULTS.hebrewFont;
    }

    if (!MODES.includes(settings.mode)) {
      settings.mode = DEFAULTS.mode;
    }

    return settings;
  }

  async function read() {
    if (!extensionApi?.storage?.local) {
      return normalise({ ...DEFAULTS });
    }

    const stored = await extensionApi.storage.local.get(DEFAULTS);
    return normalise({ ...DEFAULTS, ...stored });
  }

  async function write(patch) {
    if (!extensionApi?.storage?.local) {
      return;
    }

    await extensionApi.storage.local.set(patch);
  }

  const api = { DEFAULTS, MODES, HEBREW_FONTS, read, write };
  globalObject.ChatGptRtlSettings = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
