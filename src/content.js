"use strict";

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const directionApi = globalThis.ChatGptRtlDirection;
  const settingsApi = globalThis.ChatGptRtlSettings;

  if (!directionApi || !settingsApi) {
    return;
  }

  const DEFAULT_SETTINGS = settingsApi.DEFAULTS;

  /**
   * Containers that hold conversation text. Direction is only ever resolved
   * inside one of these, so the surrounding application chrome keeps whatever
   * direction ChatGPT gave it.
   */
  const MESSAGE_ROOT_SELECTORS = [
    "[data-message-author-role]",
    "article[data-testid^=\"conversation-turn-\"]",
    ".markdown",
    ".prose"
  ];
  const MESSAGE_ROOT_SELECTOR = MESSAGE_ROOT_SELECTORS.join(", ");

  // `table` is included so that Hebrew tables lay their columns out from the
  // right; individual cells still resolve their own direction.
  const BLOCK_SELECTOR =
    ":is(p, li, blockquote, h1, h2, h3, h4, h5, h6, table, td, th, dt, dd, figcaption, caption, summary, .whitespace-pre-wrap)";
  const LIST_SELECTOR = ":is(ul, ol)";
  const PRE_SELECTOR = "pre";
  const SCAN_SELECTORS = [BLOCK_SELECTOR, LIST_SELECTOR, PRE_SELECTOR];
  const SCAN_SELECTOR = SCAN_SELECTORS.join(", ");

  const SCOPED_SELECTOR = [
    ...MESSAGE_ROOT_SELECTORS,
    ...MESSAGE_ROOT_SELECTORS.flatMap((root) =>
      SCAN_SELECTORS.map((scan) => `${root} ${scan}`)
    )
  ].join(", ");

  /**
   * Editable surfaces and rich widgets are left alone entirely. Their
   * direction is handled by CSS (`unicode-bidi: plaintext`), which cannot
   * conflict with the frameworks that own those nodes.
   */
  const EXCLUDED_SELECTOR = [
    "[contenteditable=\"true\"]",
    "textarea",
    "input",
    ".cm-editor",
    ".monaco-editor",
    "[class*=\"katex\"]",
    "math",
    "svg"
  ].join(", ");

  /** Bounded work per animation frame so streaming answers stay smooth. */
  const FLUSH_BUDGET_MS = 12;
  /** Beyond this many queued roots a single scoped rescan is cheaper. */
  const MAX_PENDING_ROOTS = 40;

  let settings = { ...DEFAULT_SETTINGS };
  let observer = null;
  let rafHandle = 0;
  let timerHandle = 0;
  /**
   * Bumped whenever settings change. Cached decisions from an older
   * generation are ignored, which is how a settings change re-evaluates the
   * whole page without needing to clear a WeakMap.
   */
  let generation = 0;

  const pendingRoots = new Set();
  /** element -> { text, direction, role, generation } — skips redundant writes. */
  const appliedState = new WeakMap();

  const now =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? () => performance.now()
      : () => Date.now();

  function textOf(element) {
    return String(element?.textContent ?? "").replace(/\u00a0/g, " ");
  }

  function isExcluded(element) {
    return Boolean(element?.closest?.(EXCLUDED_SELECTOR));
  }

  /**
   * Writes direction only when it actually changed. ChatGPT re-renders
   * constantly; skipping no-op writes is what keeps the observer quiet.
   */
  function writeDirection(element, direction, role, text) {
    const previous = appliedState.get(element);
    const settled =
      previous &&
      previous.generation === generation &&
      previous.direction === direction &&
      previous.role === role &&
      element.dataset.chatgptRtlDir === direction;

    appliedState.set(element, { text, direction, role, generation });

    if (settled) {
      return;
    }

    element.dataset.chatgptRtlDir = direction;
    element.dataset.chatgptRtlRole = role;
    element.setAttribute("dir", direction);
  }

  /**
   * True when this element was already resolved for exactly this text under
   * the current settings, so nothing needs recomputing.
   */
  function unchangedSince(element, text) {
    const previous = appliedState.get(element);
    return Boolean(
      previous && previous.generation === generation && previous.text === text
    );
  }

  function resolveDirection(text) {
    return settings.mode === "rtl" ? "rtl" : directionApi.detectDirection(text);
  }

  function codeLanguageHint(pre) {
    const code = pre.querySelector("code");
    return [
      pre.getAttribute("data-language"),
      pre.getAttribute("data-testid"),
      pre.className,
      code?.getAttribute("class"),
      code?.getAttribute("data-language"),
      code?.getAttribute("data-highlight-language")
    ]
      .filter(Boolean)
      .join(" ");
  }

  function applyPreformatted(pre) {
    const text = textOf(pre);
    if (unchangedSince(pre, text)) {
      return;
    }

    const kind = settings.smartCodeBlocks
      ? directionApi.classifyPreformatted(text, codeLanguageHint(pre))
      : "code";
    const direction = kind === "prose" ? "rtl" : "ltr";

    writeDirection(pre, direction, `pre-${kind}`, text);

    for (const code of pre.querySelectorAll("code")) {
      writeDirection(code, direction, `pre-${kind}`, text);
    }
  }

  function applyTextBlock(element, role) {
    const text = textOf(element);
    if (unchangedSince(element, text)) {
      return;
    }

    if (!text.trim()) {
      // Remember the empty state too, so placeholder nodes that React keeps
      // re-rendering are not re-measured on every frame.
      appliedState.set(element, { text, direction: "", role: "", generation });
      return;
    }

    writeDirection(element, resolveDirection(text), role, text);
  }

  function applyDirection(element) {
    if (!element?.matches || isExcluded(element)) {
      return;
    }

    const pre = element.closest(PRE_SELECTOR);
    if (pre) {
      applyPreformatted(pre);
      return;
    }

    if (element.matches(LIST_SELECTOR)) {
      applyTextBlock(element, "list");
      return;
    }

    if (element.matches(BLOCK_SELECTOR)) {
      applyTextBlock(element, "block");
      return;
    }

    if (!element.matches(MESSAGE_ROOT_SELECTOR)) {
      return;
    }

    // A wrapper around blocks: isolate it so one turn cannot reorder the
    // next, and let each block inside resolve its own direction.
    if (element.querySelector(SCAN_SELECTOR)) {
      element.dataset.chatgptRtlRole = "container";
      return;
    }

    // A message that holds its text directly, with no block element of its
    // own — common for short user turns.
    applyTextBlock(element, "block");
  }

  function applyToRoot(root) {
    if (!(root instanceof Element || root instanceof Document)) {
      return;
    }

    if (root instanceof Element && root.matches(SCOPED_SELECTOR)) {
      applyDirection(root);
    }

    for (const element of root.querySelectorAll(SCOPED_SELECTOR)) {
      applyDirection(element);
    }
  }

  function rememberPendingRoot(root) {
    for (const existing of pendingRoots) {
      if (existing === root || existing.contains?.(root)) {
        return;
      }
    }

    for (const existing of Array.from(pendingRoots)) {
      if (root.contains?.(existing)) {
        pendingRoots.delete(existing);
      }
    }

    pendingRoots.add(root);
  }

  /**
   * Queues the smallest subtree that can contain conversation text.
   *
   * `descendantScan` is only enabled for freshly inserted nodes: mounting a
   * whole conversation gives a node that sits *above* every message root, so
   * `closest` alone would silently drop it. Mutation targets skip that check
   * because ChatGPT churns unrelated chrome constantly and a tree-wide
   * `querySelector` per record would be far too expensive.
   */
  function addPendingRoot(node, descendantScan = false) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof Element) || isExcluded(element)) {
      return;
    }

    const scoped =
      element.closest(MESSAGE_ROOT_SELECTOR) ??
      (descendantScan && element.querySelector(MESSAGE_ROOT_SELECTOR)
        ? element
        : null);

    if (!scoped) {
      return;
    }

    if (pendingRoots.size >= MAX_PENDING_ROOTS) {
      pendingRoots.clear();
      pendingRoots.add(document.body ?? document.documentElement);
      return;
    }

    rememberPendingRoot(scoped);
  }

  function flush() {
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();

    const started = now();

    for (let index = 0; index < roots.length; index += 1) {
      applyToRoot(roots[index]);

      if (now() - started > FLUSH_BUDGET_MS && index + 1 < roots.length) {
        for (let rest = index + 1; rest < roots.length; rest += 1) {
          rememberPendingRoot(roots[rest]);
        }
        scheduleFlush();
        return;
      }
    }
  }

  function scheduleFlush() {
    if (rafHandle || timerHandle) {
      return;
    }

    if (
      typeof requestAnimationFrame === "function" &&
      document.visibilityState !== "hidden"
    ) {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = 0;
        flush();
      });
      return;
    }

    timerHandle = setTimeout(() => {
      timerHandle = 0;
      flush();
    }, 200);
  }

  function scanEverything() {
    pendingRoots.clear();
    applyToRoot(document);
  }

  function handleMutations(records) {
    for (const record of records) {
      if (record.type === "characterData") {
        addPendingRoot(record.target);
        continue;
      }

      for (const added of record.addedNodes) {
        addPendingRoot(added, true);
      }

      addPendingRoot(record.target);
    }

    if (pendingRoots.size) {
      scheduleFlush();
    }
  }

  function syncRootAttributes() {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    root.dataset.chatgptRtl = settings.enabled ? "on" : "off";
    root.dataset.chatgptRtlMode = settings.mode === "rtl" ? "rtl" : "auto";
    root.dataset.chatgptRtlComposer =
      settings.enabled && settings.patchComposer ? "on" : "off";
    root.dataset.chatgptRtlSidebar =
      settings.enabled && settings.patchSidebar ? "on" : "off";
  }

  function startObserver() {
    if (observer) {
      return;
    }

    // Only structural and text mutations are observed. The extension writes
    // nothing but attributes, so it can never react to its own changes and
    // needs no re-entrancy guard.
    observer = new MutationObserver(handleMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    pendingRoots.clear();

    if (rafHandle) {
      cancelAnimationFrame(rafHandle);
      rafHandle = 0;
    }

    if (timerHandle) {
      clearTimeout(timerHandle);
      timerHandle = 0;
    }
  }

  /**
   * Disabling has to undo the `dir` attributes as well: CSS stops applying the
   * moment the root attribute flips, but `dir` keeps steering the browser's
   * own bidi algorithm on its own.
   */
  function resetAppliedDirections() {
    for (const element of document.querySelectorAll("[data-chatgpt-rtl-dir]")) {
      element.removeAttribute("dir");
      delete element.dataset.chatgptRtlDir;
      delete element.dataset.chatgptRtlRole;
    }

    for (const element of document.querySelectorAll(
      "[data-chatgpt-rtl-role=\"container\"]"
    )) {
      delete element.dataset.chatgptRtlRole;
    }
  }

  function applySettings() {
    generation += 1;
    syncRootAttributes();

    if (!settings.enabled) {
      stopObserver();
      resetAppliedDirections();
      return;
    }

    startObserver();
    scanEverything();
  }

  async function loadSettings() {
    settings = await settingsApi.read();
  }

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    let touched = false;
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) {
        settings[key] = change.newValue ?? DEFAULT_SETTINGS[key];
        touched = true;
      }
    }

    if (touched) {
      // A settings change can invalidate every previous decision.
      applySettings();
    }
  });

  // The root attributes gate all CSS, so set them before the first paint and
  // refine once the stored settings resolve.
  syncRootAttributes();

  loadSettings()
    .catch((error) => {
      console.warn("ChatGPT Web RTL could not load its settings.", error);
    })
    .finally(applySettings);
})();
