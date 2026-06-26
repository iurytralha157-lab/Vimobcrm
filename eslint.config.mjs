import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".codex/**",
    ".tmp/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    // Generated Supabase types are not hand-edited.
    "**/supabase/types.ts",
  ]),
  {
    rules: {
      // Legacy cleanup is being done incrementally. Keep these visible without blocking builds.
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",

      // React Compiler advisory rules are useful, but the migrated app still has legacy patterns.
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
    },
  },
]);

export default eslintConfig;
