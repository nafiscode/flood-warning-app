import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16 renamed middleware to proxy. This only maps URLs to a language; it never blocks a request.
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals, the service worker route, and any file with an extension.
  matcher: ["/((?!api|_next|_vercel|serwist|.*\\..*).*)"],
};
