"use strict";

/** Development-only files must not ship inside the signed add-on. */
module.exports = {
  ignoreFiles: [
    "test",
    "node_modules",
    "package.json",
    "package-lock.json",
    "web-ext-config.cjs"
  ]
};
