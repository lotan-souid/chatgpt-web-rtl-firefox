"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { detectDirection, classifyPreformatted } = require("../src/direction");

test("detects Hebrew as RTL", () => {
  assert.equal(detectDirection("שלום world"), "rtl");
});

test("detects English as LTR", () => {
  assert.equal(detectDirection("Hello עולם"), "ltr");
});

test("detects pure text of each script", () => {
  assert.equal(detectDirection("שלום עולם, מה שלומך היום?"), "rtl");
  assert.equal(detectDirection("Hello world, how are you today?"), "ltr");
});

test("detects mostly Hebrew text as RTL when it starts with an English term", () => {
  assert.equal(
    detectDirection("Keycloak הוא שרת קוד פתוח לניהול זהויות והרשאות"),
    "rtl"
  );
});

test("ignores punctuation and numbers before the first strong character", () => {
  assert.equal(detectDirection("123... עברית"), "rtl");
  assert.equal(detectDirection("42 - English"), "ltr");
});

test("returns auto when there is no strong character", () => {
  assert.equal(detectDirection("123 +-="), "auto");
  assert.equal(detectDirection(""), "auto");
  assert.equal(detectDirection("   "), "auto");
  assert.equal(detectDirection("🙂 🚀 —"), "auto");
});

test("handles null and undefined without throwing", () => {
  assert.equal(detectDirection(null), "auto");
  assert.equal(detectDirection(undefined), "auto");
});

test("keeps Hebrew technical prose RTL despite acronym-heavy English terms", () => {
  assert.equal(detectDirection("API JSON CSS הם מונחים טכניים נפוצים"), "rtl");
});

test("treats camel-cased product names as technical rather than prose", () => {
  assert.equal(
    detectDirection("התקנתי PostgreSQL עם pgvector על GitHub Actions"),
    "rtl"
  );
  assert.equal(
    detectDirection("צריך להריץ npm install לפני docker build"),
    "rtl"
  );
});

test("counts Hebrew-prefixed foreign terms as Hebrew", () => {
  // "ל-Homelab" is Hebrew grammar wrapped around a borrowed word.
  assert.equal(detectDirection("מתאים ל-Homelab ול-Self-Hosted"), "rtl");
});

test("keeps English prose LTR even when it quotes a Hebrew word", () => {
  assert.equal(
    detectDirection("The Hebrew word for peace is שלום and it is common"),
    "ltr"
  );
});

test("keeps URLs and paths from flipping Hebrew sentences", () => {
  assert.equal(
    detectDirection("הקובץ נמצא ב-src/index.js ובאתר https://example.com"),
    "rtl"
  );
});

test("detects Arabic and Persian as RTL", () => {
  assert.equal(detectDirection("مرحبا بالعالم"), "rtl");
  assert.equal(detectDirection("سلام دنیا"), "rtl");
});

test("does not let Arabic-Indic digits alone decide direction", () => {
  // Digits are weak in Unicode; they must not vote.
  assert.equal(detectDirection("١٢٣ 456"), "auto");
});

test("resolves a tie by the first strong character", () => {
  assert.equal(detectDirection("שלום world"), "rtl");
  assert.equal(detectDirection("world שלום"), "ltr");
});

test("classifies real source code as code", () => {
  assert.equal(
    classifyPreformatted(
      "const x = 1;\nfunction hey() {\n  return x; // הערה בעברית\n}",
      "language-javascript"
    ),
    "code"
  );

  assert.equal(
    classifyPreformatted("SELECT * FROM users WHERE id = 1;", ""),
    "code"
  );

  assert.equal(
    classifyPreformatted("שלום\nprint('hi')", "language-python"),
    "code"
  );
});

test("classifies Hebrew prose wrapped in a code fence as prose", () => {
  assert.equal(
    classifyPreformatted(
      "סיכום הפגישה:\nדנו בתקציב לשנה הבאה\nוסוכם להמשיך בשבוע הבא",
      ""
    ),
    "prose"
  );
});

test("classifies code without any Hebrew as code", () => {
  assert.equal(classifyPreformatted("echo hello\nls -la", ""), "code");
  assert.equal(classifyPreformatted("", ""), "code");
});

test("classifies a Hebrew key/value block as code", () => {
  assert.equal(
    classifyPreformatted(
      "{\n  \"name\": \"דוגמה\",\n  \"value\": \"בדיקה\"\n}",
      "language-json"
    ),
    "code"
  );
});

test("classifies a shell transcript with Hebrew output as code", () => {
  assert.equal(
    classifyPreformatted("$ npm run build\nהבנייה הסתיימה בהצלחה", ""),
    "code"
  );
});
