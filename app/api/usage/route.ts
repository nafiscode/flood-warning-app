import { after } from "next/server";
import { gateToken } from "@/lib/push-server";
import { createPublicClient, NO_STORE } from "@/lib/supabase/public";
import { supabaseConfigured } from "@/lib/supabase/env";
import { headerText, readAgent, roughCoordinate } from "@/lib/usage";

/**
 * "The app was opened" (the owner, 14 Oct: the admins' usage dashboard). The phone sends it once
 * a visit with navigator.sendBeacon and never waits for the answer. This route adds what only the
 * server can know - the kind of device from the browser's description, and the rough place
 * Vercel reads from the internet address (city, cut to 0.1 degree) - and passes it to the
 * database with the push gate token, so nobody can type a place in for someone else.
 *
 * The internet address itself is never read here and never stored. Page changes and "still on
 * screen" go from the phone straight to the database (usage_ping), not through this route, so a
 * busy night costs no extra Vercel calls a minute.
 */
const MAX_BODY = 2_000;

export async function POST(request: Request) {
  const done = () => new Response(null, { status: 204, headers: { "Cache-Control": NO_STORE } });
  const token = gateToken();
  if (!token || !supabaseConfigured()) return done();

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return done();
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return done();
  }
  if (!body || typeof body !== "object") return done();

  const h = request.headers;
  const agent = readAgent(h.get("user-agent") ?? "", Number(body.touch) || 0);
  const hit = {
    install: body.install,
    session: body.session,
    path: typeof body.path === "string" ? body.path.slice(0, 200) : "/",
    locale: body.locale,
    installed: body.installed === true,
    push: body.push === true,
    signedIn: body.signedIn === true,
    tambon: typeof body.tambon === "string" ? body.tambon : null,
    areaFrom: body.areaFrom,
    watched: Number(body.watched) || 0,
    memory: Number(body.memory) || null,
    cores: Number(body.cores) || null,
    net: body.net,
    screen: Number(body.screen) || null,
    fcp: Number.isFinite(Number(body.fcp)) ? Math.round(Number(body.fcp)) : null,
    ready: Number.isFinite(Number(body.ready)) ? Math.round(Number(body.ready)) : null,
    ...agent,
    country: h.get("x-vercel-ip-country"),
    region: headerText(h.get("x-vercel-ip-country-region"), 60),
    city: headerText(h.get("x-vercel-ip-city")),
    lat: roughCoordinate(h.get("x-vercel-ip-latitude"), 90),
    lon: roughCoordinate(h.get("x-vercel-ip-longitude"), 180),
  };

  // The phone does not wait for this; the answer goes back before the database is asked.
  after(async () => {
    try {
      await createPublicClient().rpc("usage_open", { p_token: token, p_hit: hit });
    } catch {
      // A note that does not arrive is a visit not counted, nothing more.
    }
  });
  return done();
}
