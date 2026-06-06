/** @type {import("eslint").Linter.Config} */
const base = require("./base");

module.exports = {
  ...base,
  extends: [...base.extends, "next/core-web-vitals"],
  rules: {
    ...base.rules,
    "react/no-unescaped-entities": "off",
    "@next/next/no-html-link-for-pages": "error",
  },
};
