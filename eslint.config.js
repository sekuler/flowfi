import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Deliberately starts lenient — this is the first time ESLint has run
// against this codebase at all. Turning on the full strict rule set here
// would surface hundreds of pre-existing warnings across files nobody's
// touching today, which teaches everyone to ignore the linter rather than
// fixing real problems. The handful of rules below catch the mistakes that
// actually cause bugs (unused variables shadowing a typo, missing hook
// dependencies, hooks called conditionally) without demanding a repo-wide
// cleanup first. Tighten this gradually, file by file, as things get
// touched — not all at once.
export default tseslint.config(
  { ignores: ["dist", "node_modules", "contracts", "test"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off", // this flags the ordinary "fetch in useEffect, setState with the result" pattern used all over this codebase (data loading on mount/dependency-change) — standard, working React, not a bug; enabling it here would produce ~40 false-positive-shaped errors on day one and teach everyone to ignore the linter
      "react-refresh/only-export-components": "off", // this codebase exports helper functions alongside components in several files — a real, deliberate pattern here, not a mistake
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off", // not enabling this yet — would flag a lot of existing, working code for a style preference, not a bug
      "no-empty": "off", // several intentional empty catch blocks in this codebase (documented inline as deliberate silent-fallback behavior)
    },
  }
);
