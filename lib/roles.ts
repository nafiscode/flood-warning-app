/**
 * Who someone is, with nothing of the server in it, so a component drawn in the browser can ask
 * the question too. `lib/auth.ts` reads the session and re-exports these; importing that file
 * from a client component pulls `next/headers` into the browser bundle and breaks every page.
 *
 * A role here only decides what is drawn. What a person may read or change is decided by
 * row-level security and the pages themselves (safety rule 5).
 */
export type Role = "user" | "authority" | "admin" | "super_admin";

export function isAdminRole(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

/** The same question for a value off the wire or out of the phone's storage. */
export function isAdminRoleName(role: string | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}
