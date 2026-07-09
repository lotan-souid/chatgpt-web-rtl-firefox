"use strict";

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const directionApi = globalThis.ChatGptRtlDirection;

  const MESSAGE_ROOT_SELECTORS = [
    "[data-message-author-role]",
    "article[data-testid^=\"conversation-turn-\"]",
    ".markdown",
    ".prose"
  ];

  const NATURAL_BLOCK_SELECTOR =
    ":is(p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, figcaption, caption, summary, .whitespace-pre-wrap)";
  const LIST_SELECTOR = "ul, ol";
  const PREFORMATTED_SELECTOR = "pre";
  const SCAN_SELECTORS = [
    NATURAL_BLOCK_SELECTOR,
    LIST_SELECTOR,
    PREFORMATTED_SELECTOR
  ];
  const SCAN_SELECTOR = SCAN_SELECTORS.join(", ");

  const NATURAL_TEXT_SELECTOR = [
    ...MESSAGE_ROOT_SELECTORS,
    ...MESSAGE_ROOT_SELECTORS.flatMap((rootSelector) =>
      SCAN_SELECTORS.map((scanSelector) => rootSelector + " " + scanSelector)
    )
  ].join(", ");

  const COMPOSER_SELECTOR = [
    "#prompt-textarea",
    "textarea[data-id=\"root\"]",
    "form [contenteditable=\"true\"]",
    "[role=\"textbox\"]"
  ].join(", ");

  const INLINE_LTR_SELECTOR = "[data-chatgpt-rtl-inline-ltr=\"true\"]";
  const SKIP_INLINE_DIRECTION_SELECTOR = [
    INLINE_LTR_SELECTOR,
    "pre",
    "code",
    "kbd",
    "samp",
    "table",
    "math",
    "svg",
    "textarea",
    "[contenteditable=\"true\"]",
    "[class*=\"katex\"]",
    "[class*=\"math\"]"
  ].join(", ");

  const RTL_TEXT = /[\u0590-\u08ff\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
  const CODE_LANGUAGE_HINT =
    /\b(?:language-|hljs|javascript|typescript|python|css|html|json|yaml|bash|shell|sh|sql|xml|java|csharp|cpp|php|ruby|go|rust)\b/i;
  const CODE_SYNTAX =
    /(?:=>|===|!==|==|!=|&&|\|\||;|\{\s*$|\}\s*$|<\/?[A-Za-z][^>]*>|^\s*(?:import|export|from|const|let|var|function|class|def|return|if|else|for|while|try|catch|console\.log|print\(|SELECT|INSERT|UPDATE|DELETE|CREATE)\b)/m;

  let patchComposer = true;
  let observer;
  let isApplying = false;
  let scanTimer;
  const pendingRoots = new Set();

  function textOf(element) {
    return String(element?.textContent ?? "").replace(/\u00a0/g, " ");
  }

  function normalizedText(element) {
    return textOf(element).replace(/\s+/gu, " ").trim();
  }

  function unwrapInlineLtrRuns(element) {
    element.querySelectorAll?.(INLINE_LTR_SELECTOR).forEach((wrapper) => {
      wrapper.replaceWith(document.createTextNode(wrapper.textContent));
    });
    element.normalize?.();
  }

  function shouldSkipTextNode(textNode) {
    const parent = textNode.parentElement;
    return !parent || parent.closest(SKIP_INLINE_DIRECTION_SELECTOR);
  }

  function isolateInlineLtrRuns(element, direction) {
    unwrapInlineLtrRuns(element);

    if (direction !== "rtl" || !element.querySelectorAll) {
      return;
    }

    const textNodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        if (shouldSkipTextNode(textNode)) {
          return NodeFilter.FILTER_REJECT;
        }

        return directionApi
          .splitDirectionalRuns(textNode.nodeValue)
          .some((part) => part.direction === "ltr")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((textNode) => {
      const fragment = document.createDocumentFragment();
      const parts = directionApi.splitDirectionalRuns(textNode.nodeValue);

      parts.forEach((part) => {
        if (part.direction !== "ltr") {
          fragment.append(document.createTextNode(part.value));
          return;
        }

        const ltrRun = document.createElement("bdi");
        ltrRun.dir = "ltr";
        ltrRun.dataset.chatgptRtlInlineLtr = "true";
        ltrRun.textContent = part.value;
        fragment.append(ltrRun);
      });

      textNode.replaceWith(fragment);
    });
  }

  function isMessageRoot(element) {
    return Boolean(element?.matches?.(MESSAGE_ROOT_SELECTORS.join(", ")));
  }

  function hasChildTextBlocks(element) {
    return Boolean(element.querySelector?.(SCAN_SELECTOR));
  }

  function getPreHost(element) {
    return element?.closest?.("pre") || (element?.matches?.("pre") ? element : null);
  }

  function codeLanguageHint(pre) {
    const code = pre.querySelector?.("code");
    return [
      pre.getAttribute?.("data-language"),
      pre.getAttribute?.("data-testid"),
      pre.className,
      code?.getAttribute?.("class"),
      code?.getAttribute?.("data-language"),
      code?.getAttribute?.("data-highlight-language")
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function looksLikeStructuredCode(text, lines) {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    if (/^\s*[{[]/.test(trimmed) && /[}\]]\s*$/.test(trimmed) && /"[^"\n]+"\s*:/.test(trimmed)) {
      return true;
    }

    if (CODE_SYNTAX.test(text)) {
      return true;
    }

    return (
      lines.length >= 2 &&
      lines.filter((line) => /^\s*[\w"'-]+\s*:\s*.+/.test(line)).length >= Math.ceil(lines.length * 0.6)
    );
  }

  function looksLikeHebrewProsePre(pre) {
    const text = textOf(pre);
    if (!RTL_TEXT.test(text)) {
      return false;
    }

    if (CODE_LANGUAGE_HINT.test(codeLanguageHint(pre))) {
      return false;
    }

    const lines = text.split(/\n/u).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      return false;
    }

    const hebrewLines = lines.filter((line) => RTL_TEXT.test(line)).length;
    const codeLines = lines.filter((line) => CODE_SYNTAX.test(line) || /[{};]/.test(line)).length;

    if (looksLikeStructuredCode(text, lines) && codeLines >= Math.ceil(lines.length * 0.25)) {
      return false;
    }

    return hebrewLines >= 1 && hebrewLines >= codeLines;
  }

  function applyPreformattedDirection(element) {
    const pre = getPreHost(element);
    if (!pre) {
      return;
    }

    const direction = looksLikeHebrewProsePre(pre) ? "rtl" : "ltr";
    pre.setAttribute("dir", direction);
    pre.dataset.chatgptRtl = "true";
    pre.dataset.chatgptRtlPre = direction === "rtl" ? "prose" : "code";

    pre.querySelectorAll("code").forEach((code) => {
      code.setAttribute("dir", direction);
      code.dataset.chatgptRtl = "true";
      code.dataset.chatgptRtlPre = pre.dataset.chatgptRtlPre;
    });
  }

  function applyListDirection(list) {
    const direction = directionApi.detectDirection(textOf(list));
    list.setAttribute("dir", direction);
    list.dataset.chatgptRtl = "true";
    list.dataset.chatgptRtlList = direction;

    list.querySelectorAll(":scope > li").forEach((item) => {
      item.setAttribute("dir", direction);
      item.dataset.chatgptRtl = "true";
      item.dataset.chatgptRtlListItem = direction;
      isolateInlineLtrRuns(item, direction);
    });
  }

  function applyDirection(element) {
    if (!element?.matches || !normalizedText(element)) {
      return;
    }

    if (element.matches(PREFORMATTED_SELECTOR) || getPreHost(element)) {
      applyPreformattedDirection(element);
      return;
    }

    if (element.matches(LIST_SELECTOR)) {
      applyListDirection(element);
      return;
    }

    if (isMessageRoot(element) && hasChildTextBlocks(element)) {
      element.dataset.chatgptRtl = "container";
      return;
    }

    const direction = directionApi.detectDirection(textOf(element));
    element.setAttribute("dir", direction);
    element.dataset.chatgptRtl = "true";

    if (!element.matches(COMPOSER_SELECTOR)) {
      isolateInlineLtrRuns(element, direction);
    }
  }

  function runApplying(callback) {
    if (isApplying) {
      return;
    }

    isApplying = true;
    try {
      callback();
    } finally {
      setTimeout(() => {
        isApplying = false;
      }, 0);
    }
  }

  function applyToRoot(root) {
    if (!(root instanceof Element || root instanceof Document)) {
      return;
    }

    runApplying(() => {
      if (root instanceof Element && root.matches(NATURAL_TEXT_SELECTOR)) {
        applyDirection(root);
      }

      root.querySelectorAll?.(NATURAL_TEXT_SELECTOR).forEach(applyDirection);

      if (!patchComposer) {
        return;
      }

      if (root instanceof Element && root.matches(COMPOSER_SELECTOR)) {
        applyDirection(root);
      }

      root.querySelectorAll?.(COMPOSER_SELECTOR).forEach(applyDirection);
    });
  }

  function clearComposerDirection() {
    document.querySelectorAll(COMPOSER_SELECTOR).forEach((element) => {
      if (element.dataset.chatgptRtl === "true") {
        element.removeAttribute("dir");
        delete element.dataset.chatgptRtl;
      }
    });
  }

  function rememberPendingRoot(root) {
    if (!root) {
      return;
    }

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

  function addPendingRoot(node) {
    const root = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!root) {
      return;
    }

    const closest = root.closest?.(`${SCAN_SELECTOR}, ${COMPOSER_SELECTOR}, ${MESSAGE_ROOT_SELECTORS.join(", ")}`);
    rememberPendingRoot(closest || root);
  }

  function schedulePendingScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      roots.forEach(applyToRoot);
    }, 180);
  }

  function startObserver() {
    applyToRoot(document);

    observer = new MutationObserver((records) => {
      if (isApplying) {
        return;
      }

      records.forEach((record) => {
        if (record.type === "characterData") {
          addPendingRoot(record.target);
          return;
        }

        record.addedNodes.forEach(addPendingRoot);
        addPendingRoot(record.target);
      });

      if (pendingRoots.size) {
        schedulePendingScan();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  async function loadSettings() {
    if (!extensionApi?.storage?.local) {
      return;
    }

    const settings = await extensionApi.storage.local.get({
      patchComposer: true
    });
    patchComposer = settings.patchComposer !== false;
  }

  extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.patchComposer) {
      return;
    }

    patchComposer = changes.patchComposer.newValue !== false;
    if (patchComposer) {
      applyToRoot(document);
    } else {
      clearComposerDirection();
    }
  });

  loadSettings()
    .catch((error) => {
      console.warn("ChatGPT Web RTL could not load its settings.", error);
    })
    .finally(startObserver);
})();
