import type { AbstractIntlMessages } from "next-intl";

type Messages = Record<string, AbstractIntlMessages>;

/**
 * The words of the journey line and of the "My requests" page: its own namespace, plus the two
 * lines of the quiet feedback ask that sits at the foot of that page once nothing is still open
 * (A15). The form's own words do not travel with it - the ask is a link, and the words arrive
 * with /feedback itself.
 */
export function journeyMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return {
    journey: all.journey!,
    feedback: { ask: (all.feedback as Messages).ask! },
  };
}
