// supabase/functions/tft-proxy/index.ts
//
// Riot's official API (unlike Valorant's HenrikDev API) doesn't send CORS headers,
// so the browser can't call api.riotgames.com directly — every request gets blocked
// by the browser before it even reaches Riot. This function is a thin server-side
// hop for the TFT tracker: the client sends a small structured request (a "kind" plus
// the handful of params that kind needs), and this function is the ONLY place that
// turns that into an actual https://*.api.riotgames.com URL, built from a fixed
// per-kind template with allowlisted platform values — never from a client-supplied
// path or URL — so this can't be turned into an open proxy to arbitrary hosts.
//
// The Riot API key itself is supplied by the caller on every request (mirroring how
// the Valorant tracker stores its own HenrikDev key client-side) rather than stored
// as a server secret, since it's a personal key the app's single user manages themselves.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// TFT platform routing -> the regional routing cluster used for account-v1 and match-v1.
// (tft/league/v1 and tft/summoner/v1 are platform-routed directly, no translation needed.)
const PLATFORM_TO_REGIONAL: Record<string, string> = {
  na1: "americas", br1: "americas", la1: "americas", la2: "americas", oc1: "americas",
  euw1: "europe", eun1: "europe", tr1: "europe", ru: "europe", me1: "europe",
  kr: "asia", jp1: "asia",
  // Riot's newer Southeast Asia platform shards, confirmed by Riot Developer Relations to
  // route through the "sea" regional cluster: https://x.com/RiotGamesDevRel/status/1611171470012739584
  ph2: "sea", sg2: "sea", th2: "sea", tw2: "sea", vn2: "sea",
};

const MATCH_ID_RE = /^[A-Za-z0-9_-]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { apiKey, kind, platform } = body;

    if (typeof apiKey !== "string" || !apiKey) return json({ error: "Missing Riot API key" }, 400);
    if (typeof platform !== "string" || !(platform in PLATFORM_TO_REGIONAL)) {
      return json({ error: "Invalid or unsupported region" }, 400);
    }
    const regional = PLATFORM_TO_REGIONAL[platform];
    const headers = { "X-Riot-Token": apiKey, Accept: "application/json" };

    let url: string;
    if (kind === "account") {
      const { name, tag } = body;
      if (typeof name !== "string" || !name || typeof tag !== "string" || !tag) {
        return json({ error: "Missing name/tag" }, 400);
      }
      url = "https://" + regional + ".api.riotgames.com/riot/account/v1/accounts/by-riot-id/"
        + encodeURIComponent(name) + "/" + encodeURIComponent(tag);
    } else if (kind === "league") {
      const { puuid } = body;
      if (typeof puuid !== "string" || !puuid) return json({ error: "Missing puuid" }, 400);
      url = "https://" + platform + ".api.riotgames.com/tft/league/v1/by-puuid/" + encodeURIComponent(puuid);
    } else if (kind === "matchIds") {
      const { puuid, count } = body;
      if (typeof puuid !== "string" || !puuid) return json({ error: "Missing puuid" }, 400);
      const c = Math.min(20, Math.max(1, parseInt(count, 10) || 5));
      url = "https://" + regional + ".api.riotgames.com/tft/match/v1/matches/by-puuid/"
        + encodeURIComponent(puuid) + "/ids?count=" + c;
    } else if (kind === "match") {
      const { matchId } = body;
      if (typeof matchId !== "string" || !MATCH_ID_RE.test(matchId)) {
        return json({ error: "Invalid matchId" }, 400);
      }
      url = "https://" + regional + ".api.riotgames.com/tft/match/v1/matches/" + encodeURIComponent(matchId);
    } else {
      return json({ error: "Unknown kind" }, 400);
    }

    const riotRes = await fetch(url, { headers });
    const text = await riotRes.text();
    // Pass Riot's response (and status code) straight through — the client already
    // knows how to read Riot's { status: { message } } error shape.
    return new Response(text, { status: riotRes.status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
