/**
 * When the sun is down, so the app can turn dark by itself (the owner's note, 9 Oct): dark after
 * sunset, light again at sunrise, with nothing for anyone to switch.
 *
 * The times come from the date and a place, with the usual sunrise equation, and are compared
 * against the clock of the phone. No permission is asked for and no position is sent anywhere:
 * the place is the area the person already chose on the home screen, or the middle of the four
 * provinces until they choose one.
 *
 * Checked against published times for Pattani: sunrise 06:03 and sunset 18:04 on 9 October,
 * 06:02/18:33 at the June solstice, 06:22/18:05 at the December one.
 */

/** The middle of Pattani, Yala, Narathiwat and Songkhla: used until a person picks their area. */
export const SERVICE_CENTRE = { lat: 6.8, lon: 101.2 };

const RAD = Math.PI / 180;

/**
 * Sunrise and sunset for the day that moment falls in, in milliseconds since the epoch.
 * Null where the sun neither rises nor sets that day (far north or south; never here).
 */
export function sunTimes(
  now: number,
  lat: number,
  lon: number,
): { sunrise: number; sunset: number } | null {
  const jd = now / 86400000 + 2440587.5;
  // The equation counts longitude west of Greenwich as positive.
  const lw = -lon;
  const n = Math.round(jd - 2451545.0009 - lw / 360);
  const meanNoon = 2451545.0009 + lw / 360 + n;
  const anomaly = (357.5291 + 0.98560028 * (meanNoon - 2451545)) % 360;
  const centre =
    1.9148 * Math.sin(anomaly * RAD) +
    0.02 * Math.sin(2 * anomaly * RAD) +
    0.0003 * Math.sin(3 * anomaly * RAD);
  const ecliptic = (anomaly + centre + 180 + 102.9372) % 360;
  const transit =
    meanNoon + 0.0053 * Math.sin(anomaly * RAD) - 0.0069 * Math.sin(2 * ecliptic * RAD);
  const sinDeclination = Math.sin(ecliptic * RAD) * Math.sin(23.44 * RAD);
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  // -0.833 degrees: the sun's edge at the horizon, with the air bending its light.
  const cosHourAngle =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDeclination) /
    (Math.cos(lat * RAD) * cosDeclination);
  if (cosHourAngle > 1 || cosHourAngle < -1) return null;
  const hourAngle = Math.acos(cosHourAngle) / RAD;
  const toMs = (julian: number) => (julian - 2440587.5) * 86400000;
  return { sunrise: toMs(transit - hourAngle / 360), sunset: toMs(transit + hourAngle / 360) };
}

/** True between sunset and the next sunrise. Where the sun never sets, between 18:00 and 06:00. */
export function isNight(now: number, lat: number, lon: number): boolean {
  const times = sunTimes(now, lat, lon);
  if (!times) {
    const hour = new Date(now).getHours();
    return hour < 6 || hour >= 18;
  }
  return now < times.sunrise || now >= times.sunset;
}

/** When the theme should change next: the coming sunrise or sunset. */
export function nextChange(now: number, lat: number, lon: number): number {
  const today = sunTimes(now, lat, lon);
  if (!today) return now + 3600000;
  if (now < today.sunrise) return today.sunrise;
  if (now < today.sunset) return today.sunset;
  const tomorrow = sunTimes(now + 86400000, lat, lon);
  return tomorrow ? tomorrow.sunrise : now + 3600000;
}
