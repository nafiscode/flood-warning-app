/** Official Thai hotlines, always one tap away and available offline (safety rule 4). */
export const HOTLINES = [
  { key: "ddpm", number: "1784" },
  { key: "medical", number: "1669" },
  { key: "police", number: "191" },
  { key: "fire", number: "199" },
] as const;

export type HotlineKey = (typeof HOTLINES)[number]["key"];
