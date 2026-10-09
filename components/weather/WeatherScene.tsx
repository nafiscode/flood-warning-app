import { moonAt, moonPath } from "@/lib/moon";
import { SCENE_LOOKS, type Scene } from "@/lib/weather-scene";
import styles from "./WeatherScene.module.css";

type Props = {
  scene: Scene;
  /** The clock, so the moon is drawn in the shape it has tonight. */
  now: number;
};

/**
 * The moving sky behind the temperature (the owner's request, 10 Oct 2026). It is decoration:
 * it says nothing the words beside it do not, it is hidden from screen readers, and the numbers
 * are never drawn on top of anything that moves under them.
 *
 * Every piece is a plain element with one CSS animation (WeatherScene.module.css), and the
 * positions are fixed here rather than random, so the same weather always looks the same and a
 * test can see it.
 */
export function WeatherScene({ scene, now }: Props) {
  const look = SCENE_LOOKS[scene];
  const moon = look.moon ? moonAt(now) : null;
  const lit = moon ? moonPath(moon.lit, moon.waxing) : null;

  return (
    <div
      aria-hidden="true"
      data-weather-scene={scene}
      className={styles.scene}
      style={
        {
          "--sky-top": look.sky[0],
          "--sky-bottom": look.sky[1],
        } as React.CSSProperties
      }
    >
      {look.sun && <span className={styles.sun} />}

      {look.stars &&
        STARS.map(([top, left, delay], i) => (
          <span
            key={i}
            className={styles.star}
            style={{ top: `${top}%`, left: `${left}%`, animationDelay: `${delay}s` }}
          />
        ))}

      {moon && (
        <svg className={styles.moon} viewBox="-12 -12 24 24" role="presentation">
          {/* The dark disc, so a crescent still reads as a moon and not as a sliver of light. */}
          <circle cx="0" cy="0" r="10" fill="rgba(226,238,248,0.07)" />
          {lit && <path d={lit} fill="#E9F2F8" />}
        </svg>
      )}

      {look.clouds
        ? CLOUDS.slice(0, look.clouds).map(([top, scale, duration, delay], i) => (
            <span
              key={i}
              className={`${styles.cloud} ${look.ink === "light" ? styles.cloudDark : ""}`}
              style={{
                top: `${top}%`,
                left: 0,
                transform: `scale(${scale})`,
                animationDuration: `${duration}s`,
                animationDelay: `-${delay}s`,
              }}
            />
          ))
        : null}

      {look.mist &&
        MIST.map(([top, duration, delay], i) => (
          <span
            key={i}
            className={styles.mist}
            style={{
              top: `${top}%`,
              animationDuration: `${duration}s`,
              animationDelay: `-${delay}s`,
            }}
          />
        ))}

      {look.drops &&
        RAIN.map(([left, delay, duration], i) => (
          <span
            key={i}
            className={look.drops === "streaks" ? styles.streak : styles.drop}
            style={{
              left: `${left}%`,
              top: "-8%",
              animationDelay: `-${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        ))}

      {look.glass &&
        BEADS.map(([left, top, size, delay], i) => (
          <span
            key={i}
            className={styles.bead}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${size}px`,
              height: `${size * 1.15}px`,
              animationDelay: `-${delay}s`,
            }}
          />
        ))}

      {look.flakes &&
        FLAKES.map(([left, delay, duration], i) => (
          <span
            key={i}
            className={styles.flake}
            style={{
              left: `${left}%`,
              top: "-6%",
              animationDelay: `-${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        ))}

      {look.flash && <span className={styles.flash} />}
    </div>
  );
}

/* Fixed positions, not random: the same weather looks the same every time the page opens. */
const STARS: [number, number, number][] = [
  [14, 8, 0],
  [28, 19, 1.3],
  [10, 31, 2.1],
  [40, 12, 0.7],
  [22, 44, 2.8],
  [52, 27, 1.6],
  [16, 58, 0.4],
  [36, 67, 2.3],
  [58, 52, 1],
  [26, 82, 3.1],
  [48, 88, 0.9],
  [64, 72, 2.6],
];

/** top %, scale, seconds for a crossing, seconds already into it. */
const CLOUDS: [number, number, number, number][] = [
  [8, 1, 52, 0],
  [34, 0.72, 68, 24],
  [58, 1.2, 84, 48],
];

const MIST: [number, number, number][] = [
  [42, 30, 0],
  [62, 38, 12],
];

/** left %, seconds already fallen, seconds for the fall. */
const RAIN: [number, number, number][] = [
  [6, 0, 1],
  [14, 0.35, 1.2],
  [23, 0.7, 0.9],
  [31, 0.15, 1.1],
  [39, 0.55, 1],
  [47, 0.9, 1.25],
  [56, 0.25, 0.95],
  [64, 0.6, 1.15],
  [72, 0.05, 1.05],
  [81, 0.45, 1],
  [89, 0.8, 1.2],
  [96, 0.3, 0.9],
];

/** left %, top %, size px, seconds already run. */
const BEADS: [number, number, number, number][] = [
  [12, 22, 7, 0],
  [27, 52, 5, 3.4],
  [44, 18, 9, 6.1],
  [58, 61, 6, 1.8],
  [73, 35, 8, 4.7],
  [88, 58, 5, 7.5],
];

const FLAKES: [number, number, number][] = [
  [10, 0, 7],
  [25, 2.5, 8.5],
  [41, 5, 6.5],
  [57, 1.2, 9],
  [73, 3.8, 7.5],
  [90, 6.2, 8],
];
