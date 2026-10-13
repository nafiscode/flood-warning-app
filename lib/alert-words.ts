/**
 * An alert's reviewed words for one reader. No imports: the service worker, the server and the
 * screens all use it.
 */
const THAI_AREA = "พื้นที่";

/**
 * A reviewed template with one place put where its "{area}" is. Nothing else of the reviewed
 * text is touched.
 */
export function fillArea(template: string, area: string): string {
  // Thai templates say "ในพื้นที่ {area}"; "พื้นที่ของคุณ" already begins with that word.
  const doubled = `${THAI_AREA} {area}`;
  return area.startsWith(THAI_AREA) && template.includes(doubled)
    ? template.replace(doubled, area)
    : template.replace("{area}", area);
}

/**
 * An alert's words for one reader. The stored message names the alert's whole area, which can
 * be hundreds of tambons that are not theirs; where the alert carries its template
 * (`template_th|ms|en`), the reader's own place goes in that spot instead: a tambon's name, or
 * "your area". An alert with no template keeps its stored words. Thai when the reader's
 * language has no reviewed text.
 */
export function alertWords(messages: Record<string, string>, locale: string, area: string): string {
  const lang = messages[locale] ? locale : "th";
  const template = messages[`template_${lang}`];
  if (template && template.includes("{area}") && area !== "") return fillArea(template, area);
  return messages[lang] ?? "";
}
