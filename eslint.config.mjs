import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // Not part of the web app: Python pipeline, Deno edge functions, local notes
    "pipeline/**",
    "supabase/functions/**",
    ".claude/**",
    // Copied from node_modules by scripts/vendor-maplibre.mjs
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
