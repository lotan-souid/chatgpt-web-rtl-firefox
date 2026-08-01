"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage, structureOf } = require("./helpers/page");

const HEBREW_TURN = `
  <article data-testid="conversation-turn-2">
    <div data-message-author-role="assistant">
      <div class="markdown prose">
        <p id="hebrew">שלום, זו תשובה בעברית עם מונח באנגלית כמו API</p>
        <p id="english">This paragraph is written entirely in English.</p>
        <ul id="list"><li id="item">פריט ראשון ברשימה</li></ul>
        <pre id="code"><code class="language-javascript">const x = 1;
function hey() { return x; }</code></pre>
      </div>
    </div>
  </article>
`;

test("resolves direction per block inside a message", async () => {
  const page = await createPage(HEBREW_TURN);
  const { document } = page;

  assert.equal(document.querySelector("#hebrew").dataset.chatgptRtlDir, "rtl");
  assert.equal(document.querySelector("#hebrew").getAttribute("dir"), "rtl");
  assert.equal(document.querySelector("#english").dataset.chatgptRtlDir, "ltr");
  assert.equal(document.querySelector("#item").dataset.chatgptRtlDir, "rtl");
  assert.equal(document.querySelector("#list").dataset.chatgptRtlRole, "list");

  page.close();
});

test("keeps source code left to right", async () => {
  const page = await createPage(HEBREW_TURN);
  const pre = page.document.querySelector("#code");

  assert.equal(pre.dataset.chatgptRtlRole, "pre-code");
  assert.equal(pre.dataset.chatgptRtlDir, "ltr");
  assert.equal(pre.querySelector("code").dataset.chatgptRtlDir, "ltr");

  page.close();
});

test("marks Hebrew prose in a code fence as prose", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <pre id="fence"><code>סיכום הפגישה
דנו בתקציב לשנה הבאה
וסוכם להמשיך בשבוע הבא</code></pre>
    </div>
  `);

  const pre = page.document.querySelector("#fence");
  assert.equal(pre.dataset.chatgptRtlRole, "pre-prose");
  assert.equal(pre.dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("never adds, removes or rewrites nodes in ChatGPT's DOM", async () => {
  const page = await createPage(HEBREW_TURN);
  const turn = page.document.querySelector("article");

  const before = structureOf(turn);

  // Force a full re-evaluation, the situation that used to trigger DOM surgery.
  await page.setSettings({ mode: "rtl" });
  await page.setSettings({ mode: "auto" });

  assert.deepEqual(structureOf(turn), before);
  assert.equal(turn.querySelectorAll("bdi").length, 0);
  assert.equal(turn.querySelectorAll("[data-chatgpt-rtl-inline-ltr]").length, 0);

  page.close();
});

test("marks message wrappers as isolation containers", async () => {
  const page = await createPage(HEBREW_TURN);

  assert.equal(
    page.document.querySelector("[data-message-author-role]").dataset
      .chatgptRtlRole,
    "container"
  );

  page.close();
});

test("updates direction as a streamed answer grows", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown"><p id="stream">Hello</p></div>
    </div>
  `);

  const paragraph = page.document.querySelector("#stream");
  assert.equal(paragraph.dataset.chatgptRtlDir, "ltr");

  paragraph.textContent = "שלום, זו תשובה ארוכה בעברית שממשיכה להיכתב";
  await page.settle();

  assert.equal(paragraph.dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("picks up messages mounted after the initial scan", async () => {
  const page = await createPage(`<main id="thread"></main>`);

  const turn = page.document.createElement("article");
  turn.setAttribute("data-testid", "conversation-turn-1");
  turn.innerHTML =
    "<div data-message-author-role=\"user\"><p id=\"late\">הודעה חדשה בעברית</p></div>";
  page.document.querySelector("#thread").append(turn);

  await page.settle();

  assert.equal(page.document.querySelector("#late").dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("leaves the composer to CSS and never scripts it", async () => {
  const page = await createPage(`
    <form>
      <div id="prompt-textarea" contenteditable="true"><p>שלום</p></div>
    </form>
  `);

  const composer = page.document.querySelector("#prompt-textarea");
  assert.equal(composer.dataset.chatgptRtlDir, undefined);
  assert.equal(composer.hasAttribute("dir"), false);
  assert.equal(composer.querySelector("p").dataset.chatgptRtlDir, undefined);

  page.close();
});

test("mirrors settings onto the root element for CSS to gate on", async () => {
  const page = await createPage(HEBREW_TURN);
  const root = page.document.documentElement;

  assert.equal(root.dataset.chatgptRtl, "on");
  assert.equal(root.dataset.chatgptRtlMode, "auto");
  assert.equal(root.dataset.chatgptRtlComposer, "on");
  assert.equal(root.dataset.chatgptRtlSidebar, "on");

  await page.setSettings({ patchComposer: false, mode: "rtl" });

  assert.equal(root.dataset.chatgptRtlComposer, "off");
  assert.equal(root.dataset.chatgptRtlMode, "rtl");

  page.close();
});

test("forced mode overrides detection but spares code blocks", async () => {
  const page = await createPage(HEBREW_TURN, { mode: "rtl" });

  assert.equal(page.document.querySelector("#english").dataset.chatgptRtlDir, "rtl");
  assert.equal(page.document.querySelector("#code").dataset.chatgptRtlDir, "ltr");

  page.close();
});

test("re-evaluates every block when settings change", async () => {
  const page = await createPage(HEBREW_TURN);
  assert.equal(page.document.querySelector("#english").dataset.chatgptRtlDir, "ltr");

  await page.setSettings({ mode: "rtl" });
  assert.equal(page.document.querySelector("#english").dataset.chatgptRtlDir, "rtl");

  await page.setSettings({ mode: "auto" });
  assert.equal(page.document.querySelector("#english").dataset.chatgptRtlDir, "ltr");

  page.close();
});

test("disabling fully reverts the page", async () => {
  const page = await createPage(HEBREW_TURN);
  const hebrew = page.document.querySelector("#hebrew");
  assert.equal(hebrew.getAttribute("dir"), "rtl");

  await page.setSettings({ enabled: false });

  assert.equal(page.document.documentElement.dataset.chatgptRtl, "off");
  assert.equal(hebrew.hasAttribute("dir"), false);
  assert.equal(hebrew.dataset.chatgptRtlDir, undefined);
  assert.equal(
    page.document.querySelectorAll("[data-chatgpt-rtl-role]").length,
    0
  );

  page.close();
});

test("stops reacting to the page once disabled", async () => {
  const page = await createPage(HEBREW_TURN, { enabled: false });

  const paragraph = page.document.querySelector("#hebrew");
  paragraph.textContent = "טקסט חדש לגמרי בעברית";
  await page.settle();

  assert.equal(paragraph.hasAttribute("dir"), false);

  page.close();
});

test("handles a message that holds its text directly", async () => {
  const page = await createPage(
    `<div data-message-author-role="user" id="bare">מה השעה עכשיו?</div>`
  );

  const message = page.document.querySelector("#bare");
  assert.equal(message.dataset.chatgptRtlRole, "block");
  assert.equal(message.dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("ignores text outside conversation containers", async () => {
  const page = await createPage(`
    <nav><a href="/c/1"><div id="title">שיחה בעברית</div></a></nav>
  `);

  // Sidebar titles are handled by CSS alone, so no attributes are written.
  assert.equal(page.document.querySelector("#title").hasAttribute("dir"), false);

  page.close();
});
