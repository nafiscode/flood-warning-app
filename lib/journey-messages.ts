import type { AbstractIntlMessages } from "next-intl";

/** The words of the journey line and of the "My requests" page: one namespace, nothing else. */
export function journeyMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return { journey: (messages as Record<string, AbstractIntlMessages>).journey! };
}
