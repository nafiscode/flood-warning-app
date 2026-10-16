"use client";

import type { ReactNode } from "react";
import { isAdminRoleName } from "@/lib/roles";
import { useMyRole } from "@/lib/use-public";

/**
 * What only an admin should be offered (owner, 16 Oct): the admins' section of What Jaga can do
 * describes their tools to everyone, but its Open buttons show only to someone signed in as an
 * admin. It reads the role the header already keeps on this phone (it asks for nothing itself),
 * and the admin pages turn away anyone else regardless.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const role = useMyRole(false);
  return isAdminRoleName(role) ? <>{children}</> : null;
}
