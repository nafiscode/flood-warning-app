import { getSessionProfile, isAdminRole } from "@/lib/auth";

/**
 * True for an admin. The admin layout already turns everyone else away, but a page is rendered
 * alongside its layout: a page asks this first and reads nothing for anyone else, rather than
 * ask the database and be refused.
 */
export async function isAdminHere(): Promise<boolean> {
  const session = await getSessionProfile();
  return !!session && isAdminRole(session.role);
}
