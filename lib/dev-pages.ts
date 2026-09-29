/**
 * /dev/* review pages exist in local development and Vercel previews, never in production.
 * Before launch, JAGA_DEV_PAGES=1 can switch them on for the pre-launch Vercel deployment so the
 * owner can review on a phone; the A10 launch checklist removes it.
 */
export function devPagesEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview" ||
    process.env.JAGA_DEV_PAGES === "1"
  );
}
