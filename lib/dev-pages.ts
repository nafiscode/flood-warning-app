/** /dev/* review pages exist in local development and Vercel previews, never in production. */
export function devPagesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.VERCEL_ENV === "preview";
}
