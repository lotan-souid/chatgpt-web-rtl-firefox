"use strict";

(function exposeDirectionHelpers(globalObject) {
  /**
   * Strong right-to-left scripts (Hebrew, Arabic, Syriac, Thaana, N'Ko,
   * Samaritan, Mandaic and the Arabic presentation forms).
   * Arabic-Indic digits are deliberately excluded: Unicode classifies them as
   * weak, so they must not vote for a paragraph's direction.
   */
  const RTL_CHARACTER =
    /[\u0590-\u065F\u066A-\u06EF\u06FA-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;

  /** Strong left-to-right scripts (Latin, Greek, Cyrillic, Armenian). */
  const LTR_CHARACTER =
    /[A-Za-z\u00C0-\u02AF\u0370-\u058F\u1E00-\u1EFF]/u;

  /**
   * Signals that an otherwise left-to-right token is a technical term rather
   * than natural-language prose. Hebrew writing is full of borrowed product
   * names and acronyms; letting each of them vote at full weight flips whole
   * Hebrew paragraphs to left-to-right.
   */
  const ACRONYM = /^[A-Z][A-Z0-9]{1,7}$/u;
  const INTERNAL_CAPITAL = /[a-z][A-Z]/u;
  const IDENTIFIER_PUNCTUATION = /[A-Za-z0-9](?:[._/\\:@#]|::)[A-Za-z0-9]/u;
  const CONTAINS_DIGIT = /\d/u;
  const CALL_SYNTAX = /\(\)$/u;
  const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

  /** Weight applied to technical tokens when scoring a block of text. */
  const TECHNICAL_TOKEN_WEIGHT = 0.25;

  /**
   * Hints that a `pre` block holds source code rather than Hebrew prose that
   * ChatGPT happened to render inside a code fence.
   */
  const CODE_LANGUAGE_HINT =
    /\b(?:language-|lang-|hljs|highlight|javascript|typescript|jsx|tsx|python|css|scss|html|xml|json|yaml|toml|ini|bash|shell|zsh|sh|powershell|dockerfile|sql|java|kotlin|swift|csharp|cpp|c\+\+|php|ruby|go|golang|rust|perl|lua|r|matlab|diff|patch)\b/i;

  const CODE_SYNTAX =
    /(?:=>|===|!==|<=|>=|&&|\|\||::|->|;\s*$|\{\s*$|\}\s*$|<\/?[A-Za-z][^>]*>|^\s*(?:import|export|from|const|let|var|function|class|def|return|if|else|elif|for|while|try|catch|except|with|async|await|public|private|package|namespace|using|console\.log|print\(|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b|^\s*(?:[$#>]\s+\S|npm |npx |yarn |pnpm |pip |git |docker |kubectl |curl |sudo |apt |brew ))/m;

  const KEY_VALUE_LINE = /^\s*["'-]?[\w.$-]+["']?\s*[:=]\s*\S/;

  function isTechnicalToken(token) {
    const core = token.replace(EDGE_PUNCTUATION, "");
    if (!core) {
      return false;
    }

    return (
      ACRONYM.test(core) ||
      INTERNAL_CAPITAL.test(core) ||
      IDENTIFIER_PUNCTUATION.test(core) ||
      CONTAINS_DIGIT.test(core) ||
      CALL_SYNTAX.test(token)
    );
  }

  /**
   * Classifies a whitespace-delimited token by its *first* strong character,
   * mirroring the paragraph rule of UAX #9. This is what makes Hebrew
   * prefixes such as "ל-Homelab" or "ול-Self-Hosted" count as Hebrew: the
   * reader parses them as Hebrew grammar wrapped around a borrowed term.
   */
  function classifyToken(token) {
    let rtlCharacters = 0;
    let ltrCharacters = 0;
    let firstDirection = "";

    for (const character of token) {
      if (RTL_CHARACTER.test(character)) {
        rtlCharacters += 1;
        firstDirection ||= "rtl";
        continue;
      }

      if (LTR_CHARACTER.test(character)) {
        ltrCharacters += 1;
        firstDirection ||= "ltr";
      }
    }

    if (!firstDirection) {
      return null;
    }

    return {
      direction: firstDirection,
      rtlCharacters,
      ltrCharacters,
      weight:
        firstDirection === "ltr" && isTechnicalToken(token)
          ? TECHNICAL_TOKEN_WEIGHT
          : 1
    };
  }

  /**
   * Resolves the dominant direction of a block of text.
   *
   * Returns "rtl", "ltr", or "auto" when the text carries no strong character
   * at all (digits, punctuation, emoji) and the browser should decide.
   */
  function detectDirection(value) {
    let rtlScore = 0;
    let ltrScore = 0;
    let rtlCharacters = 0;
    let ltrCharacters = 0;
    let firstDirection = "auto";

    for (const token of String(value ?? "").split(/\s+/u)) {
      const classified = classifyToken(token);
      if (!classified) {
        continue;
      }

      rtlCharacters += classified.rtlCharacters;
      ltrCharacters += classified.ltrCharacters;

      if (firstDirection === "auto") {
        firstDirection = classified.direction;
      }

      if (classified.direction === "rtl") {
        rtlScore += classified.weight;
      } else {
        ltrScore += classified.weight;
      }
    }

    if (rtlScore === 0 && ltrScore === 0) {
      return "auto";
    }

    if (ltrScore === 0) {
      return "rtl";
    }

    if (rtlScore === 0) {
      return "ltr";
    }

    if (rtlScore === ltrScore) {
      return firstDirection;
    }

    // A Hebrew sentence peppered with English terms still reads right to left.
    // Once enough Hebrew characters are present, honour the opening direction
    // instead of letting a long product name win on token count alone.
    if (
      firstDirection === "rtl" &&
      rtlCharacters >= 2 &&
      rtlCharacters >= (rtlCharacters + ltrCharacters) * 0.3
    ) {
      return "rtl";
    }

    return rtlScore > ltrScore ? "rtl" : "ltr";
  }

  /**
   * Decides whether a `pre` block should be treated as source code (always
   * left to right, so indentation and operators stay readable) or as Hebrew
   * prose that ChatGPT wrapped in a code fence by mistake.
   */
  function classifyPreformatted(value, languageHint) {
    const text = String(value ?? "");

    if (!RTL_CHARACTER.test(text)) {
      return "code";
    }

    if (CODE_LANGUAGE_HINT.test(String(languageHint ?? ""))) {
      return "code";
    }

    const lines = text
      .split(/\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return "code";
    }

    const rtlLines = lines.filter((line) => RTL_CHARACTER.test(line)).length;
    const codeLines = lines.filter(
      (line) => CODE_SYNTAX.test(line) || /[{}();]/.test(line)
    ).length;
    const keyValueLines = lines.filter((line) => KEY_VALUE_LINE.test(line)).length;

    const structured =
      CODE_SYNTAX.test(text) ||
      (/^\s*[{[]/.test(text.trim()) && /[}\]]\s*$/.test(text.trim())) ||
      (lines.length >= 2 && keyValueLines >= Math.ceil(lines.length * 0.6));

    if (structured && codeLines >= Math.ceil(lines.length * 0.25)) {
      return "code";
    }

    return rtlLines >= codeLines ? "prose" : "code";
  }

  const api = { detectDirection, classifyPreformatted };
  globalObject.ChatGptRtlDirection = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis === "undefined" ? this : globalThis);
