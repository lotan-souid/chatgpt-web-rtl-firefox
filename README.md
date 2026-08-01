# ChatGPT Web RTL for Firefox

A Firefox extension that adds automatic right-to-left support to Hebrew and
mixed Hebrew/English conversations on ChatGPT.

## What it does

- Resolves text direction per block, so a single answer can mix a Hebrew
  paragraph, an English paragraph and a code block and each one is aligned
  correctly.
- Handles mixed-language prose: a Hebrew sentence stays right-to-left even when
  it is full of English product names, acronyms, URLs and file paths.
- Gives every line in the prompt composer its own direction as you type.
- Aligns conversation titles in the sidebar.
- Keeps source code, tables of code, formulae and SVG left-to-right, while
  recognising Hebrew prose that the model wrapped in a code fence by mistake.
- Toggles on and off instantly — from the toolbar button, the options page, or
  <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> — with no page reload.

## Design

The extension is deliberately conservative about touching ChatGPT's DOM,
because ChatGPT is a React application that re-renders continuously while an
answer streams in.

**It never adds, removes or rewrites a single node.** The content script only
writes attributes:

| Attribute | On | Values |
| --- | --- | --- |
| `data-chatgpt-rtl` | `<html>` | `on`, `off` |
| `data-chatgpt-rtl-mode` | `<html>` | `auto`, `rtl` |
| `data-chatgpt-rtl-composer` | `<html>` | `on`, `off` |
| `data-chatgpt-rtl-sidebar` | `<html>` | `on`, `off` |
| `data-chatgpt-rtl-dir` | text blocks | `rtl`, `ltr`, `auto` |
| `data-chatgpt-rtl-role` | text blocks | `block`, `list`, `container`, `pre-code`, `pre-prose` |

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

`classifyPreformatted` decides whether a `pre` block is source code (always
left-to-right, so indentation and operators stay readable) or Hebrew prose the
model mistakenly fenced.

## Settings

Available from the toolbar popup and, in full, from the options page.

| Setting | Default | Effect |
| --- | --- | --- |
| Enable the extension | on | Master switch, reverts the page instantly when off |
| Force RTL on all messages | off | For users who write almost exclusively in Hebrew. Code blocks are still left-to-right |
| Auto direction in the composer | on | Per-line direction while typing |
| Auto direction in the sidebar | on | Hebrew conversation titles align right |
| Detect Hebrew inside code blocks | on | Hebrew prose in a code fence renders right-to-left |

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

`npm test` covers both the pure direction logic and the content script running
against a simulated ChatGPT page in jsdom, including a regression test
asserting that the extension leaves the page's node structure untouched.

The packaged extension is written to `web-ext-artifacts/`. Permanent Firefox
installation requires Mozilla signing.

`web-ext lint` reports one warning: `strict_min_version` is 140 (the current
ESR) while `data_collection_permissions` was only introduced in Firefox for
Android 142. The key is ignored by older versions, so this is a deliberate
trade-off in favour of supporting more users.

## Notes

ChatGPT's DOM is not a public API. The selectors in
`MESSAGE_ROOT_SELECTORS` and `BLOCK_SELECTOR` may need adjustment after site
updates; everything else is structural and should survive them. This extension
is independent from OpenAI and is not endorsed by OpenAI.
