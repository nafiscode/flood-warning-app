import type { AbstractIntlMessages } from "next-intl";

type Messages = Record<string, AbstractIntlMessages>;

/**
 * Only the texts a page's interactive parts need go to the browser (slow 3G): the layout sends
 * the language switcher's, and each of these pages adds its own.
 */
function pick(messages: AbstractIntlMessages, namespaces: string[]): AbstractIntlMessages {
  return Object.fromEntries(namespaces.map((n) => [n, (messages as Messages)[n]!]));
}

export function homeMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return {
    ...pick(messages, ["home", "alert", "sos", "places", "hotlines"]),
    // The area chooser's province list.
    map: { province: all.map!.province! },
  };
}

/**
 * The SOS screens: their own text, the hotline names, the area chooser's (home.area and the
 * province list) for when GPS fails, and the report form's depth labels.
 */
export function sosMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Messages;
  return {
    ...pick(messages, ["sos", "report", "hotlines", "home"]),
    map: { province: all.map!.province! },
  };
}

export function reportMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["report", "sos", "hotlines"]);
}

export function mapMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  return pick(messages, ["map", "home", "alert", "sos", "places", "hotlines"]);
}
