import { withSerwist } from "@serwist/turbopack";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

function originOf(url: string | undefined): string {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/**
 * Security headers on every response (A10 security review). The pages may not be framed by
 * another site (the SOS, team and admin buttons could otherwise be clicked through a disguise),
 * and the browser may load only from Jaga itself, its own database project and the map sources.
 * Scripts stay 'unsafe-inline' because Next writes each page's data as inline scripts and the
 * theme and early-status scripts run before the first paint; nonces would make every page render
 * on request and lose the static offline shell. Everything the browser asks other sites for is
 * listed here: a new map source must be added, or it will not draw.
 */
function securityHeaders() {
  const dev = process.env.NODE_ENV !== "production";
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseSocket = supabase.replace(/^http/, "ws");
  const tiles = originOf(process.env.NEXT_PUBLIC_TILES_BASE_URL);
  const maps = [
    "https://tiles.openfreemap.org",
    "https://tiles.maps.eox.at",
    "https://elevation-tiles-prod.s3.amazonaws.com",
    "https://*.arcgis.com",
    "https://gis.earthdata.nasa.gov",
    "https://gibs.earthdata.nasa.gov",
    tiles,
  ]
    .filter(Boolean)
    .join(" ");
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase} ${maps}`,
    `media-src 'self' blob: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' data: blob: ${supabase} ${supabaseSocket} ${maps}${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
    .join("; ")
    .replace(/\s+/g, " ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // The origin still goes with map requests: Esri's key is locked to Jaga's addresses.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "geolocation=(self), camera=(self), microphone=(self), payment=(), usb=(), browsing-topics=()",
    },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
};

export default withSerwist(withNextIntl(nextConfig));
