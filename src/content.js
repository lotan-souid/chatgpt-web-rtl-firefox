"use strict";

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const directionApi = globalThis.ChatGptRtlDirection;
  const settingsApi = globalThis.ChatGptRtlSettings;
  const sitesApi = globalThis.ChatGptRtlSites;
  const toggleApi = globalThis.ChatGptRtlToggle;

  if (!directionApi || !settingsApi || !sitesApi) {
    return;
  }

  const DEFAULT_SETTINGS = settingsApi.DEFAULTS;

  /**
   * Containers that hold conversation text, resolved once for this host.
   * Direction is only ever resolved inside one of these, so the surrounding
   * application chrome keeps whatever direction the site gave it.
   */
  const site = sitesApi.resolveSite(location.hostname);
  const MESSAGE_ROOT_SELECTORS = site.roots;
  const MESSAGE_ROOT_SELECTOR = MESSAGE_ROOT_SELECTORS.join(", ");

  // `table` is included so that Hebrew tables lay their columns out from the
  // right; individual cells still resolve their own direction.
  const BLOCK_SELECTOR =
    ":is(p, li, blockquote, h1, h2, h3, h4, h5, h6, table, td, th, dt, dd, figcaption, caption, summary, .whitespace-pre-wrap)";
  const LIST_SELECTOR = ":is(ul, ol)";
  const PRE_SELECTOR = "pre";
  const CELL_SELECTOR = ":is(td, th)";
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
    "svg",
    // The extension's own on-page toggle, so the observer never sees it.
    "[data-chatgpt-rtl-ui]"
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

  /**
   * Bumped on every scan pass. A message's direction is measured at most once
   * per pass, however many of its blocks ask for it.
   */
  let pass = 0;

  const pendingRoots = new Set();
  /** message root -> { pass, generation, direction } */
  const messageState = new WeakMap();
  /** element -> { text, direction, role, align, generation } — skips redundant writes. */
  const appliedState = new WeakMap();
  /**
   * element -> the `dir` the page had before the extension touched it, or
   * `null` if it had none. Some sites set `dir="auto"` themselves, so
   * switching the extension off has to put their value back rather than strip
   * the attribute. Kept apart from `appliedState` because that entry is
   * replaced on every generation, while this one must survive them all.
   */
  const originalDirection = new WeakMap();

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
  function writeDirection(element, direction, role, text, align = "") {
    const previous = appliedState.get(element);
    const settled =
      previous &&
      previous.generation === generation &&
      previous.direction === direction &&
      previous.role === role &&
      previous.align === align &&
      element.dataset.chatgptRtlDir === direction;

    appliedState.set(element, { text, direction, role, align, generation });

    if (settled) {
      return;
    }

    if (!originalDirection.has(element)) {
      originalDirection.set(element, element.getAttribute("dir"));
    }

    element.dataset.chatgptRtlDir = direction;
    element.dataset.chatgptRtlRole = role;
    element.setAttribute("dir", direction);

    if (align) {
      element.dataset.chatgptRtlAlign = align;
    } else {
      delete element.dataset.chatgptRtlAlign;
    }
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

  /**
   * The prose of a message, without its code blocks: a long snippet of
   * source code must not outvote the Hebrew explanation around it.
   */
  function proseOf(message) {
    const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(`${PRE_SELECTOR}, ${EXCLUDED_SELECTOR}`)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT
    });

    const parts = [];
    while (walker.nextNode()) {
      parts.push(walker.currentNode.nodeValue);
    }

    return parts.join(" ").replace(/\u00a0/g, " ");
  }

  /**
   * In "message" mode every block takes the direction of the message it sits
   * in, the way a Hebrew Markdown document is laid out: an English product
   * name or a line that opens with ".com" no longer flips its paragraph, and
   * the whole answer reads as one right-to-left page. Returns "" when the
   * mode is different or the message holds no strong character, which leaves
   * the block to resolve on its own.
   */
  function messageDirectionOf(element) {
    if (settings.mode !== "message") {
      return "";
    }

    const message = element.closest(MESSAGE_ROOT_SELECTOR);
    if (!message) {
      return "";
    }

    const cached = messageState.get(message);
    if (cached && cached.pass === pass && cached.generation === generation) {
      return cached.direction;
    }

    const detected = directionApi.detectDirection(proseOf(message));
    const direction = detected === "rtl" || detected === "ltr" ? detected : "";
    messageState.set(message, { pass, generation, direction });
    return direction;
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

  /**
   * The direction a table resolved to, so that its cells can align with it.
   * Tables come before their cells in document order, which means a scan has
   * normally settled the table already; only a cell reached on its own makes
   * the table resolve here.
   */
  function tableDirectionOf(cell) {
    const table = cell.closest("table");
    if (!table || isExcluded(table)) {
      return "";
    }

    if (appliedState.get(table)?.generation !== generation) {
      applyTextBlock(table, "block");
    }

    const direction = table.dataset.chatgptRtlDir;
    return direction === "rtl" || direction === "ltr" ? direction : "";
  }

  /**
   * `align` overrides only the alignment, never the bidi direction. A cell
   * reading "Domains" in a Hebrew table keeps its English word order but
   * lines up on the right with the rest of its column, instead of breaking
   * the column into a ragged mix of left and right edges.
   */
  function applyTextBlock(element, role, align = "") {
    const text = textOf(element);
    const inherited = messageDirectionOf(element);
    // Everything a block inherits is part of the cache key: a streamed answer
    // can flip the direction of its message or table while the text of one
    // block stays the same.
    const key = `${inherited}\u0000${align}\u0000${text}`;
    if (unchangedSince(element, key)) {
      return;
    }

    if (!text.trim()) {
      // Remember the empty state too, so placeholder nodes that React keeps
      // re-rendering are not re-measured on every frame.
      appliedState.set(element, {
        text: key,
        direction: "",
        role: "",
        align: "",
        generation
      });
      return;
    }

    writeDirection(element, inherited || resolveDirection(text), role, key, align);
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

    if (element.matches(CELL_SELECTOR)) {
      applyTextBlock(element, "block", tableDirectionOf(element));
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

    pass += 1;

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
    root.dataset.chatgptRtlSite = site.key;
    root.dataset.chatgptRtlMode = settings.mode;
    root.dataset.chatgptRtlComposer =
      settings.enabled && settings.patchComposer ? "on" : "off";
    root.dataset.chatgptRtlSidebar =
      settings.enabled && settings.patchSidebar ? "on" : "off";
    root.dataset.chatgptRtlFont = settings.enabled
      ? settings.hebrewFont
      : "default";
  }

  /**
   * `content.css` carries the rules for the selectors every site shares. The
   * handful a site adds on top of those are compiled here instead of being
   * duplicated in the stylesheet, so `sites.js` stays the single place where
   * a new site is described.
   *
   * An adopted stylesheet is used rather than a `<style>` node so that the
   * extension still puts nothing in the page's DOM. If the browser lacks
   * constructable stylesheets, the generic rules alone remain in force.
   */
  function installSiteStyles() {
    if (!site.ownComposers.length && !site.ownSidebars.length) {
      return;
    }

    // `adoptedStyleSheets` is an ObservableArray rather than a plain array, so
    // the guard tests for its presence and the spread below does the rest.
    if (typeof CSSStyleSheet !== "function" || !document.adoptedStyleSheets) {
      return;
    }

    const rules = [];

    if (site.ownComposers.length) {
      const selector = site.ownComposers.join(", ");
      rules.push(
        `html[data-chatgpt-rtl-composer="on"] :is(${selector}),`,
        `html[data-chatgpt-rtl-composer="on"] :is(${selector}) > :is(p, div, li, blockquote, h1, h2, h3, h4, h5, h6) {`,
        "  unicode-bidi: plaintext;",
        "  text-align: start !important;",
        "}",
        `html[data-chatgpt-rtl-composer="on"][data-chatgpt-rtl-mode="rtl"] :is(${selector}) {`,
        "  direction: rtl !important;",
        "}"
      );
    }

    if (site.ownSidebars.length) {
      const selector = site.ownSidebars.join(", ");
      rules.push(
        `html[data-chatgpt-rtl-sidebar="on"] :is(${selector}) :is(div, span, p, h3) {`,
        "  unicode-bidi: plaintext;",
        "  text-align: start;",
        "}"
      );
    }

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(rules.join("\n"));
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch (error) {
      console.warn("ChatGPT Web RTL could not install its site styles.", error);
    }
  }

  function renderFloatingToggle() {
    toggleApi?.render(settings, document, () => {
      settingsApi
        .write({ enabled: !settings.enabled })
        .catch((error) => {
          console.warn("ChatGPT Web RTL could not toggle its state.", error);
        });
    });
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
      const original = originalDirection.get(element);

      if (original == null) {
        element.removeAttribute("dir");
      } else {
        element.setAttribute("dir", original);
      }

      originalDirection.delete(element);
      delete element.dataset.chatgptRtlDir;
      delete element.dataset.chatgptRtlRole;
      delete element.dataset.chatgptRtlAlign;
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
    // Rendered in both states: the button is how a user who switched the
    // extension off from the page switches it back on.
    renderFloatingToggle();

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
  installSiteStyles();

  loadSettings()
    .catch((error) => {
      console.warn("ChatGPT Web RTL could not load its settings.", error);
    })
    .finally(applySettings);
})();
