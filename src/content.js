"use strict";

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const directionApi = globalThis.ChatGptRtlDirection;

  const MESSAGE_ROOT_SELECTORS = [
    "[data-message-author-role]",
    "article[data-testid^=\"conversation-turn-\"]"
  ];

  const NATURAL_BLOCK_SELECTOR =
    ":is(p, li, blockquote, h1, h2, h3, h4, h5, h6, .whitespace-pre-wrap)";

  const NATURAL_TEXT_SELECTOR = [
    ...MESSAGE_ROOT_SELECTORS,
    ...MESSAGE_ROOT_SELECTORS.map(
      (rootSelector) => `${rootSelector} ${NATURAL_BLOCK_SELECTOR}`
    )
  ].join(", ");

  const COMPOSER_SELECTOR = [
    "#prompt-textarea",
    "textarea[data-id=\"root\"]",
    "form [contenteditable=\"true\"]"
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
    "[class*=\"katex\"]",
    "[class*=\"math\"]"
  ].join(", ");

  let patchComposer = true;
  let observer;

  function unwrapInlineLtrRuns(element) {
    element.querySelectorAll(INLINE_LTR_SELECTOR).forEach((wrapper) => {
      wrapper.replaceWith(document.createTextNode(wrapper.textContent));
    });
    element.normalize();
  }

  function shouldSkipTextNode(textNode) {
    const parent = textNode.parentElement;
    return !parent || parent.closest(SKIP_INLINE_DIRECTION_SELECTOR);
  }

  function isolateInlineLtrRuns(element, direction) {
    unwrapInlineLtrRuns(element);

    if (direction !== "rtl") {
      return;
    }

    const textNodes = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
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
      }
    );

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

  function applyDirection(element) {
    const direction = directionApi.detectDirection(element.textContent);
    element.setAttribute("dir", direction);
    element.dataset.chatgptRtl = "true";

    if (!element.matches(COMPOSER_SELECTOR)) {
      isolateInlineLtrRuns(element, direction);
    }
  }

  function applyToRoot(root) {
    if (!(root instanceof Element || root instanceof Document)) {
      return;
    }

    if (root instanceof Element && root.matches(NATURAL_TEXT_SELECTOR)) {
      applyDirection(root);
    }

    root.querySelectorAll(NATURAL_TEXT_SELECTOR).forEach(applyDirection);

    if (!patchComposer) {
      return;
    }

    if (root instanceof Element && root.matches(COMPOSER_SELECTOR)) {
      applyDirection(root);
    }

    root.querySelectorAll(COMPOSER_SELECTOR).forEach(applyDirection);
  }

  function clearComposerDirection() {
    document.querySelectorAll(COMPOSER_SELECTOR).forEach((element) => {
      if (element.dataset.chatgptRtl === "true") {
        element.removeAttribute("dir");
        delete element.dataset.chatgptRtl;
      }
    });
  }

  function startObserver() {
    applyToRoot(document);

    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === "characterData" &&
          record.target.parentElement instanceof Element
        ) {
          applyToRoot(record.target.parentElement);
          continue;
        }

        record.addedNodes.forEach(applyToRoot);
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
