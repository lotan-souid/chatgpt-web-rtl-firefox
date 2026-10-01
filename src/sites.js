"use strict";

/**
 * Which containers hold conversation text, per site.
 *
 * The direction logic itself is site-agnostic: `direction.js` is pure text
 * analysis, and `content.css` keys off data attributes. The only thing that
 * genuinely differs between chat applications is *where* the conversation
 * lives in the DOM, which is what this registry records.
 *
 * `GENERIC_ROOTS` already covers a surprising share of the field, because
 * almost every one of these applications renders model output through a
 * Tailwind-typography wrapper. A site entry is therefore a refinement — it
 * lets the extension find messages that the generic selectors miss, and to
 * scope work more tightly — never a precondition for the site working at all.
 *
 * Per-site selectors are best-effort: none of these DOMs is a public API, and
 * they are not covered by automated tests against the live sites. When a site
 * changes its markup the entry degrades to `GENERIC_ROOTS` rather than
 * breaking, which is why the generic selectors are appended to every entry.
 */
(function exposeSiteRegistry(globalObject) {
  /** Markup conventions shared by most chat front-ends. */
  const GENERIC_ROOTS = Object.freeze([
    ".markdown",
    ".prose",
    "[class*=\"markdown-\"]",
    "[data-message-author-role]"
  ]);

  /**
   * Editable surfaces that should resolve direction per line. Kept narrow on
   * purpose: a bare `[role="textbox"]` also matches read-only widgets, so the
   * role has to be paired with actual editability.
   */
  const GENERIC_COMPOSERS = Object.freeze([
    "form [contenteditable=\"true\"]",
    "form textarea",
    "[contenteditable=\"true\"][role=\"textbox\"]",
    "textarea[role=\"textbox\"]"
  ]);

  /** Conversation lists, whose titles are single lines. */
  const GENERIC_SIDEBARS = Object.freeze([
    "nav a",
    "aside a",
    "[role=\"navigation\"] a"
  ]);

  const SITES = Object.freeze([
    {
      key: "chatgpt",
      label: "ChatGPT",
      hosts: ["chatgpt.com", "chat.openai.com"],
      roots: [
        // Current markup: the rendered Markdown of each message carries its
        // role in `data-markdown-text-style`, and a CSS-module class whose
        // hash suffix changes with every deployment.
        "[data-markdown-text-style]",
        "[class*=\"MarkdownRoot-\"]",
        // Earlier markup, kept for pages still served the older build.
        "[data-message-author-role]",
        "article[data-testid^=\"conversation-turn-\"]"
      ],
      composers: ["#prompt-textarea", "textarea[data-id=\"root\"]"],
      sidebars: ["#history a"]
    },
    {
      key: "claude",
      label: "Claude",
      hosts: ["claude.ai"],
      roots: [
        "[data-testid=\"user-message\"]",
        ".font-claude-response",
        ".font-claude-message"
      ],
      composers: [".ProseMirror"],
      sidebars: []
    },
    {
      key: "gemini",
      label: "Gemini",
      hosts: ["gemini.google.com"],
      roots: ["message-content", "user-query-content", "model-response-text"],
      composers: [".ql-editor", "rich-textarea [contenteditable=\"true\"]"],
      sidebars: ["conversations-list a", ".conversation-title"]
    },
    {
      key: "aistudio",
      label: "Google AI Studio",
      hosts: ["aistudio.google.com"],
      roots: ["ms-chat-turn", "ms-text-chunk", "ms-cmark-node"],
      composers: ["ms-autosize-textarea textarea"],
      sidebars: []
    },
    {
      key: "deepseek",
      label: "DeepSeek",
      hosts: ["chat.deepseek.com"],
      roots: [".ds-markdown"],
      composers: ["#chat-input"],
      sidebars: []
    },
    {
      key: "qwen",
      label: "Qwen",
      hosts: ["chat.qwen.ai", "chat.qwenlm.ai"],
      roots: [],
      composers: [],
      sidebars: []
    },
    {
      key: "grok",
      label: "Grok",
      hosts: ["grok.com"],
      roots: [".response-content-markdown", ".message-bubble"],
      composers: [],
      sidebars: []
    },
    {
      key: "mistral",
      label: "Le Chat",
      hosts: ["chat.mistral.ai"],
      roots: [],
      composers: [],
      sidebars: []
    },
    {
      key: "perplexity",
      label: "Perplexity",
      hosts: ["perplexity.ai"],
      roots: ["[class*=\"prose\"]"],
      composers: [],
      sidebars: []
    },
    {
      key: "copilot",
      label: "Microsoft Copilot",
      hosts: ["copilot.microsoft.com"],
      roots: ["[data-content=\"ai-message\"]", "[data-content=\"user-message\"]"],
      composers: ["#userInput"],
      sidebars: []
    },
    {
      key: "poe",
      label: "Poe",
      hosts: ["poe.com"],
      roots: [
        "[class*=\"Markdown_markdownContainer\"]",
        "[class*=\"Message_messageBubble\"]"
      ],
      composers: ["[class*=\"GrowingTextArea\"] textarea"],
      sidebars: []
    },
    {
      /*
       * `duck.ai` only. The same chat is also reachable at
       * `duckduckgo.com/?ia=chat`, but claiming that host would run the
       * content script on every DuckDuckGo search as well, which is a cost
       * the feature does not justify.
       */
      key: "duck",
      label: "Duck.ai",
      hosts: ["duck.ai"],
      roots: ["[class*=\"message\"] [class*=\"markdown\"]"],
      composers: [],
      sidebars: []
    }
  ]);

  const GENERIC_SITE = Object.freeze({
    key: "generic",
    label: "",
    hosts: [],
    roots: [],
    composers: [],
    sidebars: []
  });

  function matchesHost(hostname, host) {
    return hostname === host || hostname.endsWith(`.${host}`);
  }

  /** Removes duplicates while preserving order, so selectors stay readable. */
  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  /**
   * Resolves the selector set for a hostname. Always returns a usable site:
   * an unknown host falls back to the generic selectors alone.
   */
  function resolveSite(hostname) {
    const host = String(hostname ?? "").toLowerCase();
    const match =
      SITES.find((site) => site.hosts.some((entry) => matchesHost(host, entry))) ??
      GENERIC_SITE;

    return {
      key: match.key,
      label: match.label,
      roots: unique([...match.roots, ...GENERIC_ROOTS]),
      composers: unique([...match.composers, ...GENERIC_COMPOSERS]),
      sidebars: unique([...match.sidebars, ...GENERIC_SIDEBARS]),
      /**
       * The selectors this site adds on top of the generic ones. The generic
       * rules are already written statically in `content.css`; only these
       * extras have to be generated at runtime.
       */
      ownComposers: unique(match.composers),
      ownSidebars: unique(match.sidebars)
    };
  }

  const api = {
    SITES,
    GENERIC_ROOTS,
    GENERIC_COMPOSERS,
    GENERIC_SIDEBARS,
    resolveSite
  };

  globalObject.ChatGptRtlSites = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
