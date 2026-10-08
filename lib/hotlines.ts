/** Official Thai hotlines, always one tap away and available offline (safety rule 4). */
export const HOTLINES = [
  { key: "ddpm", number: "1784" },
  { key: "medical", number: "1669" },
  { key: "police", number: "191" },
  { key: "fire", number: "199" },
] as const;

export type HotlineKey = (typeof HOTLINES)[number]["key"];

/**
 * The project's own help line, once the owner has one (spec open item 2). Until then it is not
 * shown anywhere: no button may point nowhere.
 */
export function projectLine(): string | null {
  const number = (process.env.NEXT_PUBLIC_PROJECT_LINE ?? "").replace(/[^0-9+]/g, "");
  return number === "" ? null : number;
}
