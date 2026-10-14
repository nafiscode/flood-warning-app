/**
 * The legend's picture of one of the person's own places, the same shape the map draws
 * (lib/mine-marks.ts): a pin with a house for their home, focus brackets around a dot for a
 * watched place. Drawn still; the movement belongs to the map.
 */
export function MineGlyph({ home, color }: { home: boolean; color: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6 shrink-0"
      data-mine-glyph={home ? "home" : "watch"}
    >
      {home ? (
        <>
          <path
            d="M12 22.5 L6.6 13.6 A7 7 0 1 1 17.4 13.6 Z"
            fill={color}
            stroke="var(--jaga-surface, #fff)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M8.4 9.6 L12 6.3 L15.6 9.6"
            fill="none"
            stroke="var(--jaga-surface, #fff)"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="9.6" y="9.2" width="4.8" height="3.8" fill="var(--jaga-surface, #fff)" />
        </>
      ) : (
        <>
          <circle
            cx="12"
            cy="12"
            r="3.4"
            fill={color}
            stroke="var(--jaga-surface, #fff)"
            strokeWidth="1.4"
          />
          <path
            d="M4 7.5 V4 H7.5 M16.5 4 H20 V7.5 M20 16.5 V20 H16.5 M7.5 20 H4 V16.5"
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
    </svg>
  );
}
