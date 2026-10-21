import type { Metadata } from "next";
import { PRIVATE_PAGE } from "@/lib/seo";

/**
 * Every page under /account, in one place: a crawler must not keep any of them, and a page added
 * here later is closed by default rather than by somebody remembering.
 *
 * These pages are a person's own - their area, their watched places, their household, the state
 * of what they have sent - so none of them is a page a search result could usefully point at, and
 * several of them are covered data (safety rule 5). robots.txt asks a crawler not to fetch them;
 * this is the half that still holds when it arrived by a link from somewhere else.
 *
 * It renders nothing of its own: the layout exists only to carry this one line down the tree.
 */
export const metadata: Metadata = PRIVATE_PAGE;

export default function AccountLayout({ children }: LayoutProps<"/[locale]/account">) {
  return children;
}
