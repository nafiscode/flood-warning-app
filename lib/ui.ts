/** Shared form styles: tap targets of at least 48 px, body text at 18 px (CLAUDE.md). */
export const card = "flex flex-col gap-4 rounded-2xl border border-jaga-line bg-jaga-surface p-5";
export const buttonPrimary =
  "inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-xl bg-jaga-slate px-5 py-2 text-center font-medium text-white active:translate-y-px disabled:opacity-60";
export const buttonSecondary =
  "inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-5 py-2 text-center font-medium text-jaga-ink active:translate-y-px disabled:opacity-60";
/**
 * The shell of an offer card: a teal-edged card for something the page invites a visitor to do,
 * rather than something it is telling them. Shared by the two cards under the hero (18 Oct) so
 * that "as equals" is one string and not two that drift apart.
 */
export const offerCard =
  "flex flex-col gap-3 rounded-xl border-2 border-jaga-teal-ink bg-jaga-surface p-4";
/**
 * A quiet button: a tint of the brand teal, an outline and a label, sized for a thumb but not
 * asking for the attention the primary one does. For an action that sits beside the content
 * rather than at the end of a flow.
 *
 * The teal is the colour this app already uses for something to press or follow, and it is never
 * a status (docs/brand.md): the alert palette is the only thing that shows a level. On a laptop
 * it answers the pointer - Tailwind only applies `hover:` where a pointer really hovers, so a
 * phone never gets a colour stuck on after a tap - and `prefers-reduced-motion` turns the fade
 * off in globals.css while the colours still change.
 *
 * **The label is the brand ink, not the teal**: computed against the tint it sits on, teal text
 * would read at 4.50:1 at rest and **3.89:1 once the pointer deepens the tint**, under the 4.5
 * that body text needs. The ink reads 10.2:1 and 8.9:1 instead, and the teal is left to do the
 * colouring where it only has to clear 3:1 - the border and the fill.
 */
export const buttonQuiet =
  "inline-flex min-h-tap items-center gap-2 rounded-xl border border-jaga-teal-ink bg-jaga-teal-ink/10 px-4 py-2 text-start font-medium text-jaga-ink transition-colors hover:bg-jaga-teal-ink/20 hover:shadow-sm active:translate-y-px";
export const input =
  "min-h-tap w-full rounded-xl border border-jaga-text-2 bg-jaga-surface px-4 py-2 text-body text-jaga-text";
export const label = "font-medium";
export const hint = "text-small text-jaga-text-2";
export const notice = "rounded-xl border border-jaga-line bg-jaga-ground px-4 py-3";
export const errorNotice =
  "rounded-xl border-2 border-jaga-edge bg-jaga-surface px-4 py-3 font-medium text-jaga-ink";
export const checkRow = "flex min-h-tap items-start gap-3 py-2";
export const checkBox = "mt-1 size-6 shrink-0 accent-jaga-teal-ink";
