"use client";

import { useState } from "react";
import { HouseholdsView } from "@/components/authority/TeamReads";
import type { TeamHousehold } from "@/lib/coverage";

/**
 * The registered households as an admin reads them (spec section 9: "read, logged"): the same
 * list a team sees, on the same terms. No phone number is in it; one is fetched by a tap, for one
 * household, through the function that writes the look to the access log.
 */
export function AdminHouseholds({ households }: { households: TeamHousehold[] }) {
  const [phones, setPhones] = useState<Record<string, string | null>>({});

  function ask(id: string) {
    fetch("/api/admin/household-phone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { phone: string | null };
      })
      .then(
        (answer) => setPhones((seen) => ({ ...seen, [id]: answer.phone })),
        () => setPhones((seen) => ({ ...seen, [id]: null })),
      );
  }

  return <HouseholdsView households={households} phones={phones} onPhone={ask} />;
}
