"use strict";

/**
 * An optional on-page toggle button.
 *
 * This is the one part of the extension that puts a node on the page, so it
 * is off by default and it is deliberately quarantined:
 *
 *  - the host element hangs off `<html>`, never off `<body>` or any subtree a
 *    framework re-renders, so the application's reconciler never sees it;
 *  - it lives in a *closed* shadow root, so the page cannot reach into it and
 *    its styles cannot leak either way;
 *  - it carries `data-chatgpt-rtl-ui`, which the content script's observer
 *    treats as excluded, so the extension can never react to its own node.
 *
 * It stays visible while the extension is switched off — otherwise turning the
 * extension back on from the page would be impossible.
 */
(function exposeFloatingToggle(globalObject) {
  const HOST_ID = "chatgpt-rtl-toggle-host";

  const STYLE = `
    /* Reset first so nothing of the page's cascade reaches the button, then
       take the host box out of the flow — the button positions itself. */
    :host {
      all: initial;
      display: contents;
    }

    button {
      position: fixed;
      inset-block-end: 5.5rem;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      max-inline-size: 2.5rem;
      overflow: hidden;
      box-sizing: border-box;
      block-size: 2.5rem;
      padding: 0 0.7rem;
      border: 1px solid rgba(128, 128, 128, 0.35);
      border-radius: 1.25rem;
      background: Canvas;
      color: CanvasText;
      color-scheme: light dark;
      font: menu;
      font-size: 0.85rem;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
      opacity: 0.55;
      transition: max-inline-size 160ms ease, opacity 160ms ease;
    }

    button:hover,
    button:focus-visible {
      max-inline-size: 12rem;
      opacity: 1;
    }

    button:focus-visible {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }

    button[data-state="off"] { opacity: 0.35; }

    .glyph {
      flex: none;
      font-size: 1rem;
      /* The glyph is a direction indicator, so it must not be mirrored. */
      direction: ltr;
      unicode-bidi: isolate;
    }

    .label {
      overflow: hidden;
      text-overflow: ellipsis;
      /* The host reset direction to ltr; the label itself is Hebrew. */
      direction: rtl;
    }

    @media (prefers-reduced-motion: reduce) {
      button { transition: none; }
    }
  `;

  const LABELS = {
    on: { glyph: "↔", text: "התוסף פעיל — לחצו לכיבוי" },
    off: { glyph: "↔", text: "התוסף מכובה — לחצו להפעלה" }
  };

  let host = null;
  let button = null;
  let label = null;
  let glyph = null;
  let onToggle = null;

  function build(documentRef) {
    host = documentRef.createElement("div");
    host.id = HOST_ID;
    host.dataset.chatgptRtlUi = "toggle";

    const shadow = host.attachShadow({ mode: "closed" });

    const style = documentRef.createElement("style");
    style.textContent = STYLE;

    button = documentRef.createElement("button");
    button.type = "button";

    glyph = documentRef.createElement("span");
    glyph.className = "glyph";
    glyph.setAttribute("aria-hidden", "true");

    label = documentRef.createElement("span");
    label.className = "label";

    button.append(glyph, label);
    shadow.append(style, button);

    button.addEventListener("click", () => {
      onToggle?.();
    });

    documentRef.documentElement.append(host);
  }

  /**
   * Parks the button on the side the page itself is not reading towards, so it
   * never lands on top of the text or of the site's own floating controls.
   */
  function position(documentRef) {
    const readsRightToLeft =
      documentRef.documentElement.getAttribute("dir") === "rtl";

    button.style.left = readsRightToLeft ? "1rem" : "auto";
    button.style.right = readsRightToLeft ? "auto" : "1rem";
  }

  /**
   * Creates, updates or removes the button to match the current settings.
   * Safe to call on every settings change.
   */
  function render(settings, documentRef, handleToggle) {
    const target = documentRef ?? globalObject.document;
    onToggle = handleToggle;

    if (!settings.floatingToggle) {
      remove();
      return;
    }

    if (!target?.documentElement) {
      return;
    }

    if (!host || !target.documentElement.contains(host)) {
      build(target);
    }

    const state = settings.enabled ? "on" : "off";
    button.dataset.state = state;
    button.setAttribute("aria-pressed", String(settings.enabled));
    button.title = LABELS[state].text;
    button.setAttribute("aria-label", LABELS[state].text);
    glyph.textContent = LABELS[state].glyph;
    label.textContent = LABELS[state].text;

    position(target);
  }

  function remove() {
    host?.remove();
    host = null;
    button = null;
    label = null;
    glyph = null;
  }

  /**
   * The live button, or `null` when it is not being shown.
   *
   * Content scripts run in an isolated world, so this is not reachable from
   * the page; it exists so the click path can be driven from a test without
   * having to open the shadow root up to the page as well.
   */
  function control() {
    return button;
  }

  const api = { HOST_ID, render, remove, control };
  globalObject.ChatGptRtlToggle = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
