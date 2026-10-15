import { createSerwistRoute } from "@serwist/turbopack";
import { randomUUID } from "node:crypto";

// A new revision per build, so each deploy refreshes the precached offline page.
const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "app/sw.ts",
    // The offline page in each language (A9): a Malay or English reader who loses signal on a
    // page never visited gets the page, and the hotlines' names, in their own language.
    additionalPrecacheEntries: [
      { url: "/offline", revision },
      { url: "/ms/offline", revision },
      { url: "/en/offline", revision },
    ],
    // Native esbuild on Windows, esbuild-wasm on Linux (CI, Vercel).
    useNativeEsbuild: process.platform === "win32",
  },
);
