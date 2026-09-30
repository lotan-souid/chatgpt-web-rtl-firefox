# ChatGPT Web RTL for Firefox

A Firefox extension that adds automatic right-to-left support to Hebrew and
mixed Hebrew/English conversations on ChatGPT and other AI chat sites.

## Supported sites

ChatGPT, Claude, Gemini, Google AI Studio, DeepSeek, Qwen, Grok, Le Chat,
Perplexity, Microsoft Copilot, Poe and Duck.ai.

The direction logic is entirely site-agnostic — `direction.js` analyses text
and `content.css` keys off data attributes — so the only thing that differs
between sites is *where* the conversation sits in the DOM. That is the whole
content of `src/sites.js`.

Most of these applications render model output through a Tailwind-typography
wrapper, so the generic selectors (`.markdown`, `.prose`,
`[data-message-author-role]`) already find the conversation on their own. A
site entry is a refinement on top of that, never a precondition: the generic
selectors are appended to every entry, so an entry that goes stale degrades to
them instead of breaking. Adding a site means adding one object to `SITES`.

ChatGPT is the site the selectors are actually verified against. Elsewhere the
per-site selectors are best-effort — none of these DOMs is a public API, and
the test suite cannot exercise them against the live sites.

## What it does

- By default lays out a Hebrew answer the way a Hebrew Markdown document reads
  (as in [hebrew-markdown](https://github.com/Dor-sketch/hebrew-markdown)): the
  whole message is right-to-left, including a paragraph that opens with an
  English word, while an English answer stays left-to-right. Code blocks are
  always left-to-right.
- Alternatively resolves text direction per block, so a single answer can mix
  a Hebrew paragraph, an English paragraph and a code block and each one is
  aligned on its own.
- Lines up every cell of a Hebrew table on the right and draws it as a full
  grid with a shaded header row.
- Handles mixed-language prose: a Hebrew sentence stays right-to-left even when
  it is full of English product names, acronyms, URLs and file paths.
- Gives every line in the prompt composer its own direction as you type.
- Aligns conversation titles in the sidebar.
- Keeps source code, tables of code, formulae and SVG left-to-right, while
  recognising Hebrew prose that the model wrapped in a code fence by mistake.
- Optionally restyles Hebrew paragraphs in a Hebrew typeface with roomier line
  spacing, leaving Latin text and code with the site's own typography.
- Toggles on and off instantly — from the toolbar button, the options page,
  <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>, or an optional on-page button
  — with no page reload.

## Design

The extension is deliberately conservative about touching the page's DOM,
because these are all frameworks that re-render continuously while an answer
streams in.

**It never adds, removes or rewrites a node in the conversation.** The content
script only writes attributes:

| Attribute | On | Values |
| --- | --- | --- |
| `data-chatgpt-rtl` | `<html>` | `on`, `off` |
| `data-chatgpt-rtl-site` | `<html>` | the matched entry in `sites.js`, or `generic` |
| `data-chatgpt-rtl-mode` | `<html>` | `message`, `auto`, `rtl` |
| `data-chatgpt-rtl-composer` | `<html>` | `on`, `off` |
| `data-chatgpt-rtl-sidebar` | `<html>` | `on`, `off` |
| `data-chatgpt-rtl-font` | `<html>` | `default`, `system`, `serif` |
| `data-chatgpt-rtl-dir` | text blocks | `rtl`, `ltr`, `auto` |
| `data-chatgpt-rtl-role` | text blocks | `block`, `list`, `container`, `pre-code`, `pre-prose` |
| `data-chatgpt-rtl-align` | table cells | `rtl`, `ltr` — the side of the table the cell lines up with |

The site-specific composer and sidebar selectors are compiled from `sites.js`
into an *adopted* stylesheet rather than a `<style>` node, so that rule stays
true. Where the browser lacks constructable stylesheets, the generic rules in
`content.css` remain in force on their own.

The one exception is the optional on-page toggle, which is off by default and
quarantined: its host element hangs off `<html>` rather than any subtree a
framework owns, it lives in a closed shadow root, and it carries
`data-chatgpt-rtl-ui` so the observer treats it as excluded and can never react
to it. It stays visible while the extension is switched off, because otherwise
turning it back on from the page would be impossible.

`src/content.css` keys off those attributes. Three consequences fall out of
this design:

- **React cannot fight it.** Direction is driven by the `data-*` attributes
  rather than by `dir`, so a re-render that drops `dir` does not revert the
  styling. If React replaces an element entirely, the observer sees the
  insertion and re-applies.
- **The observer cannot loop.** Only `childList` and `characterData` are
  observed, and the extension writes nothing but attributes, so it can never
  react to its own changes. No re-entrancy guard is needed.
- **Editable surfaces are never scripted.** The composer is handled purely by
  CSS `unicode-bidi: plaintext`, which resolves direction per paragraph. No
  script touches the editor, so changes to ChatGPT's editor implementation
  cannot break it.

Work is batched into animation frames with a per-frame time budget, and every
element's last decision is cached, so a long streaming answer only recomputes
the block that actually changed.

### Direction detection

`src/direction.js` is pure and dependency-free, so all of it is unit tested.
`detectDirection` scores whitespace-delimited tokens:

- A token is classified by its **first** strong character, following UAX #9.
  This is what makes `ל-Homelab` count as Hebrew — it is Hebrew grammar wrapped
  around a borrowed term.
- Tokens that look **technical** rather than natural-language count at a
  quarter weight. They are recognised structurally — acronyms (`API`), internal
  capitals (`PostgreSQL`, `GitHub`), embedded punctuation (`src/index.js`,
  `example.com`), digits (`GPT-4`) — rather than from a fixed vocabulary list.
- A tie is broken by the direction of the first strong character, which matches
  what `dir="auto"` would have done.
- Once a block is at least 30% Hebrew characters and opens in Hebrew, it stays
  right-to-left regardless of how many English terms follow.

In the default *per message* mode, the same scoring runs once over a whole
message's prose — code blocks excluded, so a long snippet cannot outvote the
Hebrew around it — and every block in the message takes the result. Table
cells keep their own direction in *per block* mode but align with their table,
so a column does not break into a ragged mix of left and right edges.

`classifyPreformatted` decides whether a `pre` block is source code (always
left-to-right, so indentation and operators stay readable) or Hebrew prose the
model mistakenly fenced.

## Settings

Available from the toolbar popup and, in full, from the options page.

| Setting | Default | Effect |
| --- | --- | --- |
| Enable the extension | on | Master switch, reverts the page instantly when off |
| On-page toggle button | off | A small corner button that switches the extension on and off without leaving the conversation |
| Message direction | per message | *Per message*: a message that is mostly Hebrew is right-to-left throughout, like a Hebrew Markdown document. *Per block*: every paragraph, list and cell resolves on its own. *Always RTL*: for users who write almost exclusively in Hebrew. Code blocks are left-to-right in every mode |
| Auto direction in the composer | on | Per-line direction while typing |
| Auto direction in the sidebar | on | Hebrew conversation titles align right |
| Detect Hebrew inside code blocks | on | Hebrew prose in a code fence renders right-to-left |
| Hebrew typeface | site default | A sans or serif Hebrew stack with roomier line spacing, applied only to blocks that resolved right-to-left |

The typeface option names faces already installed on the machine — Rubik,
Heebo, Assistant, Noto Sans Hebrew, Frank Ruehl CLM — and falls back to the
system UI font. Nothing is downloaded, and the add-on ships no font files.

## Load for development

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Select this project's `manifest.json`.
4. Open or reload `https://chatgpt.com/`.

The temporary installation is removed when Firefox exits.

With Mozilla's `web-ext` tool installed or available through `npx`:

```bash
npm start
```

## Test and package

```bash
npm install     # jsdom, for the DOM tests
npm run verify  # syntax check, unit + DOM tests, and web-ext lint
npm run build
```

`npm test` covers the pure direction logic, the site registry, and the content
script running against a simulated ChatGPT page in jsdom — including a
regression test asserting that the extension leaves the page's node structure
untouched, and one asserting that the optional toggle is mounted outside
`<body>` and never reaches the observer.

The packaged extension is written to `web-ext-artifacts/`. Permanent Firefox
installation requires Mozilla signing.

`web-ext lint` reports one warning: `strict_min_version` is 140 (the current
ESR) while `data_collection_permissions` was only introduced in Firefox for
Android 142. The key is ignored by older versions, so this is a deliberate
trade-off in favour of supporting more users.

## Notes

None of these sites exposes its DOM as a public API. The per-site selectors in
`src/sites.js`, and `BLOCK_SELECTOR` in `src/content.js`, may need adjustment
after site updates; everything else is structural and should survive them.

This extension is independent from OpenAI, Anthropic, Google, and every other
vendor whose site it supports, and is endorsed by none of them.
