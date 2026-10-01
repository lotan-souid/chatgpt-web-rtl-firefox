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
  const page = await createPage(HEBREW_TURN, { mode: "auto" });
  const { document } = page;

  assert.equal(document.querySelector("#hebrew").dataset.chatgptRtlDir, "rtl");
  assert.equal(document.querySelector("#hebrew").getAttribute("dir"), "rtl");
  assert.equal(document.querySelector("#english").dataset.chatgptRtlDir, "ltr");
  assert.equal(document.querySelector("#item").dataset.chatgptRtlDir, "rtl");
  assert.equal(document.querySelector("#list").dataset.chatgptRtlRole, "list");

  page.close();
});

const HEBREW_TABLE = `
  <div data-message-author-role="assistant">
    <div class="markdown">
      <table id="table">
        <thead><tr><th id="head">שירות</th><th>מה זה אומר</th></tr></thead>
        <tbody>
          <tr><td id="english-cell">Domains</td><td id="hebrew-cell">רישום וניהול דומיינים</td></tr>
          <tr><td>Web Hosting</td><td id="mixed-cell">אחסון מנוהל ל-WordPress</td></tr>
          <tr><td id="number-cell">9.98</td><td>לחידוש</td></tr>
        </tbody>
      </table>
    </div>
  </div>
`;

test("lines up every cell of a Hebrew table on the right", async () => {
  const page = await createPage(HEBREW_TABLE, { mode: "auto" });
  const { document } = page;

  assert.equal(document.querySelector("#table").dataset.chatgptRtlDir, "rtl");

  // An English cell keeps its word order but aligns with the table.
  const english = document.querySelector("#english-cell");
  assert.equal(english.dataset.chatgptRtlDir, "ltr");
  assert.equal(english.dataset.chatgptRtlAlign, "rtl");

  for (const id of ["#head", "#hebrew-cell", "#mixed-cell", "#number-cell"]) {
    assert.equal(document.querySelector(id).dataset.chatgptRtlAlign, "rtl", id);
  }

  page.close();
});

test("realigns cells when a streamed table changes direction", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown">
        <table id="table"><tbody id="body">
          <tr><td id="cell">Domains</td><td>DNS</td></tr>
        </tbody></table>
      </div>
    </div>
  `);

  const cell = page.document.querySelector("#cell");
  assert.equal(cell.dataset.chatgptRtlAlign, "ltr");

  const row = page.document.createElement("tr");
  row.innerHTML =
    "<td>רישום וניהול דומיינים בעברית</td><td>ניהול רשומות ושרתי שמות</td>";
  page.document.querySelector("#body").append(row);
  await page.settle();

  assert.equal(page.document.querySelector("#table").dataset.chatgptRtlDir, "rtl");
  assert.equal(cell.dataset.chatgptRtlAlign, "rtl");

  page.close();
});

test("disabling removes the table alignment", async () => {
  const page = await createPage(HEBREW_TABLE);

  await page.setSettings({ enabled: false });

  assert.equal(
    page.document.querySelectorAll("[data-chatgpt-rtl-align]").length,
    0
  );

  page.close();
});

test("message mode lays a Hebrew answer out right to left throughout", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown">
        <p id="opens-in-english">Spaceship הוא למעשה ספק שירותי אינטרנט וענן שמתחרה ב-Namecheap</p>
        <p id="english">This paragraph is written entirely in English.</p>
        <ul><li id="price">.com — $8.88 לשנה ראשונה, $9.98 לחידוש</li></ul>
        <table><tbody><tr><td id="cell">Domains</td><td>רישום וניהול דומיינים</td></tr></tbody></table>
        <pre id="code"><code class="language-javascript">const answer = computeTheAnswer();
console.log(answer);</code></pre>
      </div>
    </div>
  `);
  const { document } = page;

  for (const id of ["#opens-in-english", "#english", "#price", "#cell"]) {
    assert.equal(document.querySelector(id).dataset.chatgptRtlDir, "rtl", id);
  }
  assert.equal(document.querySelector("#code").dataset.chatgptRtlDir, "ltr");

  page.close();
});

test("message mode keeps an English answer left to right", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown">
        <p id="english">The Hebrew word for peace is written below.</p>
        <p id="hebrew">שלום</p>
        <p id="more">It is also used as a greeting.</p>
      </div>
    </div>
  `);

  assert.equal(page.document.querySelector("#english").dataset.chatgptRtlDir, "ltr");
  assert.equal(page.document.querySelector("#hebrew").dataset.chatgptRtlDir, "ltr");

  page.close();
});

test("message mode does not let a code block outvote the prose", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown">
        <p id="intro">הנה דוגמה קצרה</p>
        <pre><code class="language-javascript">const first = readConfiguration(path);
const second = validateConfiguration(first);
export default createServer(second);</code></pre>
        <p id="english">Run it with Node.</p>
      </div>
    </div>
  `);

  assert.equal(page.document.querySelector("#english").dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("message mode flips every block when a streamed answer turns Hebrew", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown" id="answer"><p id="first">Spaceship</p></div>
    </div>
  `);

  const first = page.document.querySelector("#first");
  assert.equal(first.dataset.chatgptRtlDir, "ltr");

  const next = page.document.createElement("p");
  next.textContent = "הוא ספק שירותי אינטרנט וענן שמתחרה בספקים הגדולים";
  page.document.querySelector("#answer").append(next);
  await page.settle();

  assert.equal(first.dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("finds messages in ChatGPT's current markup", async () => {
  const page = await createPage(`
    <div data-chatgpt-selection-message-id="83127a6f">
      <div class="MarkdownRoot-rZKhxa" dir="auto" data-markdown-text-style="assistant-message">
        <h2 dir="auto">10. טבלה בעברית</h2>
        <div class="TableContainer-UfIOz_" data-markdown-table="true" id="container">
          <div class="TableScroller-ZhMTLB" id="scroller"><div class="TableWrapper-i1mUIE" id="wrapper">
            <table class="Table-LqdUhs" dir="auto" id="table">
              <thead><tr><th dir="auto">מוצר</th><th dir="auto" id="head">גרסה</th><th dir="auto">משתמשים</th><th dir="auto">מצב</th></tr></thead>
              <tbody>
                <tr><td dir="auto">Visual Studio Code</td><td dir="auto" id="version">v1.8</td><td dir="auto">25</td><td dir="auto">פעיל</td></tr>
                <tr><td dir="auto">שרת API</td><td dir="auto">v3.0</td><td dir="auto">5</td><td dir="auto">בדיקה</td></tr>
              </tbody>
            </table>
          </div></div>
        </div>
      </div>
    </div>
  `);
  const { document } = page;

  assert.equal(document.querySelector("#table").dataset.chatgptRtlDir, "rtl");
  assert.equal(document.querySelector("#head").dataset.chatgptRtlAlign, "rtl");
  assert.equal(document.querySelector("#version").dataset.chatgptRtlAlign, "rtl");

  // The scroll boxes around the table take its side, so the table sits on
  // the right and a wide one opens scrolled to its first column.
  for (const id of ["container", "scroller", "wrapper"]) {
    const wrapper = document.querySelector(`#${id}`);
    assert.equal(wrapper.dataset.chatgptRtlDir, "rtl", id);
    assert.equal(wrapper.dataset.chatgptRtlRole, "table-wrap", id);
    assert.equal(wrapper.getAttribute("dir"), "rtl", id);
  }
  // The message itself is never treated as a table wrapper.
  assert.notEqual(
    document.querySelector("[data-markdown-text-style]").dataset.chatgptRtlRole,
    "table-wrap"
  );

  page.close();
});

test("leaves a table wrapper with text of its own alone", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <div class="markdown">
        <div id="frame"><span>Table 1</span>
          <div class="overflow-x-auto" id="scroller" dir="auto">
            <table><tbody><tr><td>שירות</td><td>Domains</td></tr></tbody></table>
          </div>
        </div>
      </div>
    </div>
  `);
  const { document } = page;
  const scroller = document.querySelector("#scroller");

  assert.equal(scroller.dataset.chatgptRtlRole, "table-wrap");
  assert.equal(document.querySelector("#frame").dataset.chatgptRtlDir, undefined);

  // Switching off puts back the site's own `dir`.
  await page.setSettings({ enabled: false });
  assert.equal(scroller.getAttribute("dir"), "auto");
  assert.equal(scroller.dataset.chatgptRtlRole, undefined);

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
  assert.equal(root.dataset.chatgptRtlMode, "message");
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
  const page = await createPage(HEBREW_TURN, { mode: "auto" });
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

test("restores a direction the page had set itself", async () => {
  const page = await createPage(`
    <div data-message-author-role="assistant">
      <p id="theirs" dir="auto">שלום, זו תשובה בעברית</p>
      <p id="ours">This one had no direction of its own.</p>
    </div>
  `);

  const theirs = page.document.querySelector("#theirs");
  const ours = page.document.querySelector("#ours");
  assert.equal(theirs.getAttribute("dir"), "rtl");

  await page.setSettings({ enabled: false });

  // The page's own value comes back; the one we introduced is removed.
  assert.equal(theirs.getAttribute("dir"), "auto");
  assert.equal(ours.hasAttribute("dir"), false);

  page.close();
});

test("works on a site it has no dedicated selectors for", async () => {
  const page = await createPage(
    `<div class="markdown"><p id="generic">פסקה בעברית באתר אחר</p></div>`,
    {},
    { url: "https://chat.mistral.ai/" }
  );

  assert.equal(page.document.documentElement.dataset.chatgptRtlSite, "mistral");
  assert.equal(page.document.querySelector("#generic").dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("reports an unknown host as the generic site", async () => {
  const page = await createPage(
    `<div class="prose"><p id="generic">פסקה בעברית</p></div>`,
    {},
    { url: "https://example.com/" }
  );

  assert.equal(page.document.documentElement.dataset.chatgptRtlSite, "generic");
  assert.equal(page.document.querySelector("#generic").dataset.chatgptRtlDir, "rtl");

  page.close();
});

test("mirrors the font choice onto the root element", async () => {
  const page = await createPage(HEBREW_TURN);
  const root = page.document.documentElement;

  assert.equal(root.dataset.chatgptRtlFont, "default");

  await page.setSettings({ hebrewFont: "serif" });
  assert.equal(root.dataset.chatgptRtlFont, "serif");

  // Switching the extension off must neutralise the font rules too.
  await page.setSettings({ enabled: false });
  assert.equal(root.dataset.chatgptRtlFont, "default");

  page.close();
});

test("keeps no on-page button unless it was asked for", async () => {
  const page = await createPage(HEBREW_TURN);

  assert.equal(page.document.querySelector("#chatgpt-rtl-toggle-host"), null);

  page.close();
});

test("adds the on-page button outside the application's DOM", async () => {
  const page = await createPage(HEBREW_TURN, { floatingToggle: true });
  const host = page.document.querySelector("#chatgpt-rtl-toggle-host");

  assert.notEqual(host, null);
  // On <html>, never inside <body>, so no framework reconciler ever sees it.
  assert.equal(host.parentElement, page.document.documentElement);
  assert.equal(page.document.body.contains(host), false);
  // A closed shadow root keeps the page out of it.
  assert.equal(host.shadowRoot, null);
  assert.equal(host.childNodes.length, 0);

  page.close();
});

test("the on-page button survives the extension being switched off", async () => {
  const page = await createPage(HEBREW_TURN, { floatingToggle: true });

  await page.setSettings({ enabled: false });

  assert.notEqual(page.document.querySelector("#chatgpt-rtl-toggle-host"), null);

  page.close();
});

test("removes the on-page button when the setting is turned off", async () => {
  const page = await createPage(HEBREW_TURN, { floatingToggle: true });
  assert.notEqual(page.document.querySelector("#chatgpt-rtl-toggle-host"), null);

  await page.setSettings({ floatingToggle: false });

  assert.equal(page.document.querySelector("#chatgpt-rtl-toggle-host"), null);

  page.close();
});

test("the on-page button does not feed the observer its own node", async () => {
  const page = await createPage(HEBREW_TURN, { floatingToggle: true });
  const host = page.document.querySelector("#chatgpt-rtl-toggle-host");

  await page.settle();

  assert.equal(host.hasAttribute("dir"), false);
  assert.equal(host.dataset.chatgptRtlDir, undefined);
  assert.equal(host.dataset.chatgptRtlRole, undefined);

  page.close();
});

test("clicking the on-page button switches the extension off and on", async () => {
  const page = await createPage(HEBREW_TURN, { floatingToggle: true });
  const button = page.window.ChatGptRtlToggle.control();
  const hebrew = page.document.querySelector("#hebrew");

  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(hebrew.getAttribute("dir"), "rtl");

  button.click();
  await page.settle();

  assert.equal(page.document.documentElement.dataset.chatgptRtl, "off");
  assert.equal(hebrew.hasAttribute("dir"), false);
  assert.equal(page.window.ChatGptRtlToggle.control().getAttribute("aria-pressed"), "false");

  page.window.ChatGptRtlToggle.control().click();
  await page.settle();

  assert.equal(page.document.documentElement.dataset.chatgptRtl, "on");
  assert.equal(hebrew.getAttribute("dir"), "rtl");

  page.close();
});

test("falls back to a valid font when storage holds a bad value", async () => {
  const page = await createPage(HEBREW_TURN, { hebrewFont: "comic-sans" });

  assert.equal(page.document.documentElement.dataset.chatgptRtlFont, "default");

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
