# ChatGPT RTL for Firefox

A Firefox extension that adds automatic right-to-left support to Hebrew
messages and the prompt composer on ChatGPT.

## Current behavior

- Detects text direction from the first strong character in each text block.
- Supports `chatgpt.com` and the legacy `chat.openai.com` domain.
- Keeps code, tables, SVG, and mathematical content left-to-right.
- Includes an option to disable RTL handling in the prompt composer.

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
npm test
npm run check
npm run lint:addon
npm run build
```

The packaged extension is written to `web-ext-artifacts/`. Permanent Firefox
installation requires Mozilla signing.

## Notes

ChatGPT's DOM is not a public API. Selectors may need adjustment after site
updates. This extension is independent from OpenAI and is not endorsed by
OpenAI.
