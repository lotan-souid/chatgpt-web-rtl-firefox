"use strict";

(function exposeDirectionHelpers(globalObject) {
  const RTL_CHARACTER =
    /[\u0590-\u08ff\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
  const LTR_CHARACTER =
    /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]/u;

  const LTR_RUN = /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF][A-Za-z0-9\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]*(?:[-+.#_\/:][A-Za-z0-9\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]+)*(?:\s+(?:[-\u2013\u2014]\s+)?[A-Za-z\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF][A-Za-z0-9\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]*(?:[-+.#_\/:][A-Za-z0-9\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]+)*)*/gu;

  function splitDirectionalRuns(value) {
    const text = String(value ?? "");
    const parts = [];
    let offset = 0;

    for (const match of text.matchAll(LTR_RUN)) {
      if (match.index > offset) {
        parts.push({
          value: text.slice(offset, match.index),
          direction: "auto"
        });
      }

      parts.push({ value: match[0], direction: "ltr" });
      offset = match.index + match[0].length;
    }

    if (offset < text.length) {
      parts.push({ value: text.slice(offset), direction: "auto" });
    }

    return parts;
  }

  function detectDirection(value) {
    let rtlRuns = 0;
    let ltrRuns = 0;
    let firstDirection = "auto";

    for (const segment of String(value ?? "").split(/\s+/u)) {
      let rtlCharacters = 0;
      let ltrCharacters = 0;

      for (const character of segment) {
        if (RTL_CHARACTER.test(character)) {
          rtlCharacters += 1;
          continue;
        }

        if (LTR_CHARACTER.test(character)) {
          ltrCharacters += 1;
        }
      }

      if (rtlCharacters === 0 && ltrCharacters === 0) {
        continue;
      }

      const segmentDirection = rtlCharacters >= ltrCharacters ? "rtl" : "ltr";
      if (firstDirection === "auto") {
        firstDirection = segmentDirection;
      }

      if (segmentDirection === "rtl") {
        rtlRuns += 1;
      } else {
        ltrRuns += 1;
      }
    }

    if (rtlRuns === 0 && ltrRuns === 0) {
      return "auto";
    }

    if (rtlRuns === ltrRuns) {
      return firstDirection;
    }

    return rtlRuns > ltrRuns ? "rtl" : "ltr";
  }

  const api = { detectDirection, splitDirectionalRuns };
  globalObject.ChatGptRtlDirection = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
