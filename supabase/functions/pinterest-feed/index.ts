// supabase/functions/pinterest-feed/index.ts
//
// Reads a Pinterest profile's public RSS feed and returns its pins as JSON.
//
// Why a server-side function at all: Pinterest serves no CORS headers, so the browser
// can't fetch the .rss file directly. This function is a plain proxy — no API key, no
// service-role client, no usage counter (unlike suggest-subtasks): the feed is a free
// public file and nothing here is billable.
//
// Scope note: https://www.pinterest.com/<user>/feed.rss is the user's OWN recent pins
// across their boards. The logged-in home feed (pins from accounts you follow) is private
// and has no RSS or public API, so it deliberately isn't what this reads.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The username is interpolated straight into the URL path, so this pattern IS the SSRF
// guard — it admits no "/", ".", ":" or "@", which is what would let a crafted value
// point the fetch at some other host or path.
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,58}$/;

const MAX_PINS = 50;
const FETCH_TIMEOUT_MS = 10000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { username } = await req.json();

    if (!username || typeof username !== "string" || !USERNAME_RE.test(username)) {
      return json({ error: "Invalid Pinterest username." }, 400);
    }

    let resp: Response;
    try {
      resp = await fetch(`https://www.pinterest.com/${username}/feed.rss`, {
        headers: { "User-Agent": UA, "Accept": "application/rss+xml, text/xml, */*" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      console.error("Pinterest fetch failed", err);
      return json({ error: "Couldn't reach Pinterest — try again in a moment." }, 502);
    }

    if (!resp.ok) {
      return json({
        error: "Couldn't read that Pinterest profile — check the username is right and the profile is public.",
      }, 404);
    }

    const pins = parsePins(await resp.text());
    return json({ pins });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error" }, 500);
  }
});

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

    if (pins.length >= MAX_PINS) break;
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
