// supabase/functions/pinterest-feed/index.ts
//
// Reads a Pinterest profile's public RSS feeds and returns its pins as JSON.
//
// Why a server-side function at all: Pinterest serves no CORS headers, so the browser
// can't fetch the .rss files directly. This function is a plain proxy — no API key, no
// service-role client, no usage counter (unlike suggest-subtasks): the feeds are free
// public files and nothing here is billable.
//
// Why it fetches every board instead of just the profile feed: /feed.rss is a fixed
// window of the ~25 most recent saves, with no pagination — ?page= and ?limit= are
// ignored, verified. So on its own it can only ever surface what you pinned lately.
// Each BOARD's feed has its own ~26-item window, and a board you last touched a year
// ago returns year-old pins, so merging every board is what reaches back into the
// archive: measured 138-380 unique pins across real profiles, versus 23 from the
// profile feed alone.
//
// Scope note: this reads the profile's OWN pins. The logged-in home feed (pins from
// accounts you follow) is private and has no RSS or public API, so it isn't what this reads.
//
// Two actions, on the same function:
//   { username }        -> { pins, boards }   the feed merge described above
//   { resolve: [link] } -> { videos }         mp4 URL per pin link, for the video pins among them
//
// Why "resolve" is separate rather than folded into the feed read: RSS carries only a pin's
// cover image, so learning whether a pin is a video means fetching the pin PAGE. Doing that
// for every pin in the merged pool (measured 138-380) would be dozens of times the work of
// the feed read itself, for pins the client is about to throw away — it keeps ~25. So the
// client picks first, then asks about just those. Note the mp4 URL is only ever handed to the
// browser, which loads it straight from v1.pinimg.com; video bytes never pass through here.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The username is interpolated straight into the URL path, so this pattern IS the SSRF
// guard — it admits no "/", ".", ":" or "@", which is what would let a crafted value
// point the fetch at some other host or path.
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,58}$/;

// Path segments under /<user>/ that are Pinterest's own pages, not boards.
const RESERVED_SLUGS = new Set([
  "_saved", "_created", "_shop", "_tools", "pins", "boards", "followers", "following",
  "activity", "likes", "about", "more_ideas", "sent", "topics", "today", "ideas", "settings",
]);

// Same role as USERNAME_RE, for the "resolve" action: these URLs come from the client, so this
// pattern is what stops a crafted value turning this function into an open fetch proxy. It pins
// the host to pinterest.<tld> (optionally a country subdomain) and the path to a single /pin/<id>.
// The subdomain group has to admit "www." (what the RSS <link> actually emits) as well as the
// two-letter country hosts like "uk." — hence {2,3}, not {2}.
const PIN_URL_RE = /^https:\/\/(?:[a-z]{2,3}\.)?pinterest\.[a-z]{2,3}(?:\.[a-z]{2,3})?\/pin\/[A-Za-z0-9_-]{1,64}\/?$/i;

// Pin pages embed their video renditions as JSON. Anchored to the videos CDN host so nothing
// else on the page can match. Only .mp4 — Pinterest also serves .m3u8 (HLS), which <video>
// can't play outside Safari, so admitting it would hand the client an unplayable URL.
const VIDEO_URL_RE = /https:\/\/v\d*\.pinimg\.com\/videos\/[^"'\s<>\\]+\.mp4/gi;

const MAX_PINS = 500;
const MAX_BOARDS = 30;   // bounds the fan-out; profiles surface ~5-15 boards in their HTML anyway
const MAX_RESOLVE = 40;  // the client picks 25; the slack is for a future larger pick count
const CONCURRENCY = 6;   // parallel feed fetches — the whole merge lands in ~1-4s
const FETCH_TIMEOUT_MS = 10000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { username } = body;

    // Checked before the username branch so a resolve call needs no username at all.
    if (Array.isArray(body.resolve)) return await resolveVideos(body.resolve);

    if (!username || typeof username !== "string" || !USERNAME_RE.test(username)) {
      return json({ error: "Invalid Pinterest username." }, 400);
    }

    const slugs = (await discoverBoards(username)).slice(0, MAX_BOARDS);

    // The profile feed goes first: it's the only one that's guaranteed to exist, and it's
    // also the freshest, so it still carries today's saves even if board discovery fails.
    const urls = [
      `https://www.pinterest.com/${username}/feed.rss`,
      ...slugs.map((s) => `https://www.pinterest.com/${username}/${s}.rss`),
    ];

    const pins: Array<Record<string, string>> = [];
    const seen = new Set<string>();
    let profileFeedOk = false;

    // Worker pool rather than a bare Promise.all over every URL — a profile with 30 boards
    // would otherwise open 31 sockets at once, which is where Pinterest starts rate-limiting.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < urls.length) {
          const idx = cursor++;
          const got = await fetchPins(urls[idx]);
          if (idx === 0 && got !== null) profileFeedOk = true;
          for (const p of got || []) {
            // A pin saved to a board also shows in the profile feed — dedupe on the pin page
            // URL so it can't win the random draw twice.
            const key = p.link || p.url;
            if (seen.has(key)) continue;
            seen.add(key);
            if (pins.length < MAX_PINS) pins.push(p);
          }
        }
      }),
    );

    if (!pins.length) {
      return json({
        error: profileFeedOk
          ? "That Pinterest profile has no public pins to show."
          : "Couldn't read that Pinterest profile — check the username is right and the profile is public.",
      }, 404);
    }

    return json({ pins, boards: slugs.length });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error" }, 500);
  }
});

// Fetches each pin page and returns { [pinUrl]: mp4Url } for the ones that are videos. Pins that
// aren't videos, or that fail to load, are simply absent from the map — the client shows their
// cover image as a still, which is exactly what it did before videos existed, so a total failure
// here degrades to the old behaviour rather than to an error.
async function resolveVideos(links: unknown[]): Promise<Response> {
  const urls = [
    ...new Set(links.filter((l): l is string => typeof l === "string" && PIN_URL_RE.test(l))),
  ].slice(0, MAX_RESOLVE);
  if (!urls.length) return json({ videos: {} });

  const videos: Record<string, string> = {};
  let cursor = 0;
  // Same worker pool as the feed merge, for the same reason: 25 sockets opened at once is where
  // Pinterest starts rate-limiting, and a rate-limited page just looks like "not a video".
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < urls.length) {
        const url = urls[cursor++];
        const mp4 = await fetchPinVideo(url);
        if (mp4) videos[url] = mp4;
      }
    }),
  );
  return json({ videos });
}

async function fetchPinVideo(pinUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(pinUrl, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return extractVideoUrl(await resp.text());
  } catch (err) {
    console.error("Pin page fetch failed", pinUrl, err);
    return null;
  }
}

function extractVideoUrl(html: string): string | null {
  // The URLs sit inside embedded JSON, where every "/" is escaped as "\/". Unescaping the whole
  // document first means one plain pattern covers both that and any unescaped occurrence.
  const matches = html.replace(/\\\//g, "/").match(VIDEO_URL_RE);
  if (!matches) return null;

  const uniq = [...new Set(matches)];
  // 720p is the sweet spot for a phone-sized full-screen slideshow — visually indistinguishable
  // from 1080p at this size and roughly a third of the bytes. These are the user's own bytes
  // (loaded direct from the CDN), but a slideshow that advances every few seconds can still
  // burn through a mobile data plan, so prefer the smaller rendition.
  for (const want of ["/720p/", "/480p/", "/1080p/"]) {
    const hit = uniq.find((u) => u.includes(want));
    if (hit) return hit;
  }
  return uniq[0];
}

// Board slugs come from the profile page's own HTML (board links appear as "/<user>/<slug>/",
// sometimes with escaped slashes inside embedded JSON). Best-effort by design: Pinterest lazy-
// loads boards past the first screenful, so a profile with dozens of boards yields the first
// ~10-15 — still an order of magnitude more pins than the profile feed alone. Any failure here
// returns [] and the caller falls back to just the profile feed.
async function discoverBoards(username: string): Promise<string[]> {
  let html: string;
  try {
    const resp = await fetch(`https://www.pinterest.com/${username}/`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    html = await resp.text();
  } catch (err) {
    console.error("Board discovery failed", err);
    return [];
  }

  const re = new RegExp('[\\\\"]/' + username + '\\\\?/([A-Za-z0-9_-]{2,80})\\\\?/', "gi");
  const slugs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1];
    if (RESERVED_SLUGS.has(slug.toLowerCase())) continue;
    slugs.add(slug);
  }
  return [...slugs];
}

// null = the feed couldn't be read at all (vs [] = read fine, no pins in it).
async function fetchPins(url: string): Promise<Array<Record<string, string>> | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/rss+xml, text/xml, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return parsePins(await resp.text());
  } catch (err) {
    console.error("Feed fetch failed", url, err);
    return null;
  }
}

// Regex parsing rather than a DOM/XML parser: Deno has no built-in XML parser, and the
// shape here is fixed and simple — each <item> holds the pin page <link> and an <img>
// buried inside an HTML-escaped <description>.
function parsePins(xml: string) {
  const pins: Array<Record<string, string>> = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const item of items) {
    const imgMatch = item.match(/&lt;img src=&quot;(https:\/\/i\.pinimg\.com\/[^&]+)&quot;/);
    if (!imgMatch) continue;

    const fallbackUrl = imgMatch[1];
    // Pinterest's RSS always links the 236px thumbnail. The same path under /736x/ is the
    // full-size render — good enough for a full-screen slideshow, and far smaller than
    // /originals/ (which also isn't always a .jpg). The client keeps fallbackUrl and swaps
    // back to it on error, for the rare pin with no 736x variant.
    const url = fallbackUrl.replace("/236x/", "/736x/");

    const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const title = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "";

    pins.push({
      id: link || url,
      url,
      fallbackUrl,
      link: link.trim(),
      title: decodeEntities(title).trim().slice(0, 200),
    });
  }

  return pins;
}

function decodeEntities(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
