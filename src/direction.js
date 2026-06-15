"use strict";

(function exposeDirectionHelpers(globalObject) {
  const RTL_CHARACTER =
    /[\u0590-\u08ff\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
  const LTR_CHARACTER =
    /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]/u;

  function detectDirection(value) {
    for (const character of String(value ?? "")) {
      if (RTL_CHARACTER.test(character)) {
        return "rtl";
      }

      if (LTR_CHARACTER.test(character)) {
        return "ltr";
      }
    }

    return "auto";
  }

  const api = { detectDirection };
  globalObject.ChatGptRtlDirection = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
