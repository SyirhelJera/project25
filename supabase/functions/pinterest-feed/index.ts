// supabase/functions/pinterest-feed/index.ts
//
// Reads a Pinterest profile's public pins and returns them as JSON.
//
// Why a server-side function at all: the RSS half of this serves no CORS headers, so the browser
// can't fetch the .rss files directly. This function is a plain proxy — no API key, no
// service-role client, no usage counter (unlike suggest-subtasks): everything it reads is a free
// public file and nothing here is billable.
//
// Why it fetches every BOARD instead of just the profile: /feed.rss is a fixed window of the ~25
// most recent saves, with no pagination — ?page= and ?limit= are ignored, verified — and the
// pidgets user endpoint is a similar 50-item window. So on their own they can only ever surface
// what you pinned lately, and a slideshow drawing 25 a day out of a 24-pin pool shows the same
// photos every morning. Each BOARD has its own window, and a board you last touched a year ago
// returns year-old pins, so merging every board is what reaches back into the archive: measured
// 450 unique pins across 9 boards on a real profile, versus 24 from the profile feed alone.
//
// Two sources, in that order of preference:
//
//   1. pidgets — api.pinterest.com/v3/pidgets/{users/<user>,boards/<user>/<slug>}/pins/. The public
//      JSON behind Pinterest's embeddable widgets. 50 pins per call (RSS gives 24-26), and each pin
//      carries the BOARD it lives on, which is now the only working way to discover boards at all
//      (see discoverBoards below).
//   2. RSS — /<user>/feed.rss and /<user>/<board>.rss. Kept as the fallback for any board pidgets
//      refuses, and for the profile as a whole if pidgets ever goes away.
//
// Scope note: this reads the profile's OWN pins. The logged-in home feed (pins from accounts you
// follow) is private and has no RSS or public API, so it isn't what this reads.
//
// Two actions, on the same function:
//   { username, boards?, discover?, creators?, keywords?, exclude? }
//        -> { pins, boards, boardSlugs, creatorIds, discovered?, matched? }  the merge below
//   { resolve: [link] }   -> { videos }                     mp4 URL per pin link, for video pins
//
// DISCOVER MODE returns pins the profile has never saved, which is a different question from
// everything above and needed its own answer. There is no keyless route to "pins like these":
// Pinterest's internal /resource/…Resource/get/ endpoints answer `Invalid Resource Request`
// without a session, its search and topic pages are client-rendered, and pidgets has no related
// or search method (all four verified). What pidgets *does* carry is `native_creator` — the
// Pinterest user who made a pin you saved — and it accepts a numeric user id in the same path a
// username goes in. So the taste graph is already in your own boards: the people you save FROM.
// Discover harvests those creator ids out of your own pins, samples a few, reads their recent
// pins, and subtracts everything you already have. Measured on a real profile: 131 creators
// behind 149 saved pins, 121 of them readable, 5,805 pins never saved.
//
// KEYWORDS narrow that, because reading a creator's whole feed is indiscriminate by construction:
// someone who made one car photo also pins recipes, nail art and (measured) outright scam boards.
// `keywords` keeps pins, `exclude` drops them. See the keyword-filter section for why matching is
// whole-word rather than prefix, and why a pin's board name is better evidence than its own
// description.
//
// Why "resolve" is separate rather than folded into the feed read: neither source says whether a
// pin is a video, so learning that means fetching the pin PAGE. Doing that for every pin in the
// merged pool (measured 138-450) would be dozens of times the work of the merge itself, for pins
// the client is about to throw away — it keeps ~25. So the client picks first, then asks about just
// those. Note the mp4 URL is only ever handed to the browser, which loads it straight from
// v1.pinimg.com; video bytes never pass through here.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The username is interpolated straight into the URL path, so this pattern IS the SSRF
// guard — it admits no "/", ".", ":" or "@", which is what would let a crafted value
// point the fetch at some other host or path.
const USERNAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,58}$/;

// Same role for board slugs, which are interpolated into the same paths. Slugs arrive from three
// places — the client's remembered list, Pinterest's own pin records, and a search engine — and
// only this pattern decides which of them may become a URL.
const SLUG_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,79}$/;

// And for creator ids in discover mode, which go into the same `/users/<x>/pins/` path a username
// does. Pinterest's user ids are decimal, so this is deliberately digits-only rather than a reuse
// of USERNAME_RE: the ids come from pin records and from the client's remembered list, and nothing
// that isn't a plain number has any business being interpolated into that URL.
const CREATOR_ID_RE = /^[0-9]{1,32}$/;

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

// Every image URL pidgets hands back is https://i.pinimg.com/<size>x/<path>, and the same <path>
// exists under every other size. Capturing the path is what lets pidgets produce the same
// { url: 736x, fallbackUrl: 236x } pair the RSS path already produces.
const PINIMG_RE = /^https:\/\/i\.pinimg\.com\/\d+x\/([A-Za-z0-9/._-]+)$/;

// The merged pool handed back for the client to draw its day from. Sized so a profile with a
// normal number of boards is returned WHOLE: the client shows each pin once before repeating any
// (pickPinterestPins in js/motivation.js), and a pool truncated mid-fan-out would silently hide
// whichever boards lost the race to fill it. Nothing here is stored — the client keeps 25 — so the
// only cost is one response a day, ~160KB at this ceiling.
const MAX_PINS = 800;
const MAX_BOARDS = 30;   // bounds the fan-out
const MAX_RESOLVE = 40;  // the client picks 25; the slack is for a future larger pick count
const CONCURRENCY = 6;   // parallel fetches — the whole merge lands in ~1-4s
const FETCH_TIMEOUT_MS = 10000;
// Below this many known boards the merge is thin enough to be worth one extra, best-effort search
// (see discoverBoardsViaSearch). Above it, that call never happens at all.
const SEARCH_DISCOVERY_BELOW = 5;
// Discover mode: how many of the known creators to read per sync, and the ceiling on how many are
// remembered. Sampling rather than reading all of them is the whole cost control — a real profile
// referenced 131 creators, and 131 more fetches would push one daily sync past half a minute for
// pins that are thrown away unseen. 12 creators is ~600 candidates, which is 24 days of picks
// before the sample even has to repeat, and a *different* 12 are drawn next time.
const DISCOVER_CREATOR_SAMPLE = 12;
const MAX_CREATORS = 400;
// With a keyword filter on, one batch of creators often isn't enough — measured on a real profile,
// "house" went 13 → 30 → 59 matches across three batches while "cars" plateaued at 14. So discover
// samples again while the filtered pool is thin, bounded by rounds rather than by matches so a
// topic nobody the profile follows pins about can't turn one sync into 131 fetches.
const DISCOVER_MAX_ROUNDS = 3;
// "Thin" for that widening, and also the point at which board-name matches alone are deemed enough
// that the looser description matches aren't needed. Two days' worth of picks.
const DISCOVER_MIN_POOL = 60;
const MAX_TERMS = 20;
const MAX_TERM_LEN = 40;
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

    // Boards the client already knows about, from previous syncs. Discovery only ever sees the
    // boards you pinned to LATELY, so remembering them client-side is what makes the known set
    // grow instead of resetting to "whatever's recent" on every sync.
    const remembered: string[] = Array.isArray(body.boards)
      ? body.boards.filter((s: unknown): s is string => typeof s === "string" && SLUG_RE.test(s))
      : [];

    // Creator ids the client already knows, same growing-set reasoning as `boards` above: a sync
    // only harvests creators from the pins it happens to read, so remembering them client-side is
    // what turns 14 boards' worth of sampling into a taste graph that keeps widening.
    const rememberedCreators: string[] = Array.isArray(body.creators)
      ? body.creators.filter((s: unknown): s is string => typeof s === "string" && CREATOR_ID_RE.test(s))
      : [];
    const discover = body.discover === true;
    const include = parseTerms(body.keywords);
    const exclude = parseTerms(body.exclude);

    const pins: Array<Record<string, string>> = [];
    const seen = new Set<string>();
    // Every pin id the profile already has. In discover mode this is the exclusion set rather than
    // the answer, which is why it is tracked separately from `seen` (that one is keyed by page URL
    // and is capped by MAX_PINS; this one must stay complete or already-saved pins leak through).
    const ownIds = new Set<string>();
    const creators = new Set<string>(rememberedCreators);
    // Which of YOUR boards each creator turned up on. This is the strongest signal available for a
    // keyword filter and it costs nothing extra: you filed their pin under "aviation-world", so
    // when the collection is asked for aviation they are the creators to read first — far better
    // than sampling 12 of 131 at random and hoping. Built here because this pass is the only place
    // that sees a creator id and your own board name on the same record.
    const creatorBoards = new Map<string, string>();
    const addPins = (got: Array<Record<string, string>> | null) => {
      for (const p of got || []) {
        if (p.pinId) ownIds.add(p.pinId);
        if (p.creator) {
          creators.add(p.creator);
          if (p.boardName) {
            const prev = creatorBoards.get(p.creator) || "";
            // Bounded: a prolific creator can appear on many boards, and this is only ever fed to
            // the word matcher.
            if (prev.length < 200 && !prev.includes(p.boardName)) creatorBoards.set(p.creator, prev + " " + p.boardName);
          }
        }
        // A pin saved to a board also shows in the profile feed — dedupe on the pin page
        // URL so it can't win the random draw twice.
        const key = p.link || p.url;
        if (seen.has(key)) continue;
        seen.add(key);
        if (pins.length < MAX_PINS) pins.push(p);
      }
    };

    // One call, two answers: the 50 most recent pins, and the boards they sit on.
    const profile = await fetchPidgetsUser(username);
    addPins(profile && profile.pins);

    const slugs = await discoverBoards(username, remembered, profile ? profile.slugs : []);

    // Entry 0 is the profile RSS; every other entry is a board slug. Worker pool rather than a
    // bare Promise.all over every board — a profile with 30 boards would otherwise open 31 sockets
    // at once, which is where Pinterest starts rate-limiting.
    const work = ["", ...slugs];
    const liveSlugs: string[] = [];
    let profileOk = !!profile;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < work.length) {
          const idx = cursor++;
          if (idx === 0) {
            const got = await fetchRssPins(`https://www.pinterest.com/${username}/feed.rss`);
            if (got !== null) profileOk = true;
            addPins(got);
            continue;
          }
          const slug = work[idx];
          // pidgets first (50 pins vs RSS's 26); the board's RSS is the fallback for a board it
          // refuses, so one endpoint changing shape can't empty a board that still has a feed.
          let got = await fetchPidgetsBoard(username, slug);
          if (got === null) got = await fetchRssPins(`https://www.pinterest.com/${username}/${slug}.rss`, slug);
          if (got !== null && got.length) liveSlugs.push(slug);
          addPins(got);
        }
      }),
    );

    if (!pins.length) {
      return json({
        error: profileOk
          ? "That Pinterest profile has no public pins to show."
          : "Couldn't read that Pinterest profile — check the username is right and the profile is public.",
      }, 404);
    }

    const creatorIds = [...creators].slice(0, MAX_CREATORS);

    // boardSlugs is the boards that actually returned pins just now. The client unions it with
    // what it already had (working ones first), so a board that has gone quiet drifts to the tail
    // of its list and eventually falls off the cap, while a one-off failure costs nothing.
    const base = { boards: liveSlugs.length, boardSlugs: liveSlugs, creatorIds };

    if (!discover) {
      // Your own saves are already yours, so a filter here is only ever narrowing — but it narrows
      // to nothing if the terms describe a board you don't have, and an empty slideshow is never
      // the right answer to that. `matched` is what lets the client say so.
      const kept = applyFilter(pins, include, exclude);
      return json({ ...base, pins: (kept.length ? kept : pins).map(forWire), matched: kept.length });
    }

    // Creators to read first: the ones that matched on an earlier sync, plus — from scratch, with
    // no history at all — the ones whose pins you filed on a board of your own that the keywords
    // describe. The second half is what makes the very first filtered sync land on topic.
    const rememberedHits: string[] = Array.isArray(body.hits)
      ? body.hits.filter((s: unknown): s is string => typeof s === "string" && CREATOR_ID_RE.test(s))
      : [];
    const seeded = include.length
      ? [...creatorBoards.entries()].filter(([, boards]) => anyTerm(normWords(boards), include)).map(([id]) => id)
      : [];
    const preferred = [...new Set(rememberedHits.concat(seeded))].slice(0, MAX_CREATORS);
    const { pins: found, hits } = await discoverPins(creatorIds, ownIds, include, exclude, preferred);
    // Falling back to the profile's own pins rather than erroring: discover is a *preference*, and
    // a collection that empties itself because a handful of creators went private, or the keywords
    // matched nothing anyone pins, or a first sync hasn't harvested anyone yet, is worse than one
    // showing pins you've seen. The client is told which it got (`discovered`), so it can say so
    // rather than silently looking broken.
    // Hits are merged with what the client already had rather than replacing it: one sync only
    // learns about the creators it happened to sample, so replacing would forget a good creator the
    // moment a round didn't draw them.
    const hitList = [...new Set(hits.concat(rememberedHits))].slice(0, MAX_CREATORS);
    if (!found.length) {
      const kept = applyFilter(pins, include, exclude);
      return json({ ...base, pins: (kept.length ? kept : pins).map(forWire), discovered: 0, matched: kept.length, hits: hitList });
    }
    return json({ ...base, pins: found.map(forWire), discovered: found.length, matched: found.length, hits: hitList });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error" }, 500);
  }
});

/* ---------- keyword filter ----------

   Discover reads a creator's WHOLE recent feed, and someone who made one car photo you saved also
   pins recipes, nail art and (measured, on a real profile) outright scam boards. Keywords are how
   you say what the collection is for.

   Matching is **whole-word with plural tolerance**, never prefix. Measured on real pins, prefix
   matching had "car" hitting "hair CARE", "CARPET" and "CARDIGAN" — which is the same off-topic
   noise the filter exists to remove, arriving through the filter itself. So a term matches a word,
   or that word ± a trailing "s"/"es", and a multi-word term matches only as a consecutive phrase.
   The cost is that "car" misses "supercar"; with thousands of candidates and 25 slots a day,
   precision is worth far more than recall, and a second keyword covers the miss.

   The two fields are NOT equal evidence, which is the other measured finding. A pin's `boardName`
   is the board its creator filed it under and is the honest topic — "cars 🏎️" holds car photos.
   A `desc` is marketing copy: the description-only matches for car terms were a *running* pin whose
   blurb said "blacked out Porsche" and a *t-shirt* pin listing "Car Tshirts • BMW". So an INCLUDE
   term is tried against the board name first and only falls back to descriptions to fill a thin
   day (see filterPins), while an EXCLUDE term is matched against both at once — not wanting nail
   art is a reason to drop a pin however the words got there. */

function normWords(s: string): string[] {
  return decodeEntities(String(s || "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

// Equal, or one is the other plus "s"/"es". A pair of direct comparisons rather than a stemmer:
// stemming disagrees with itself across "dress"/"dresses" and there is no dictionary here.
function sameWord(a: string, b: string): boolean {
  return a === b || a === b + "s" || b === a + "s" || a === b + "es" || b === a + "es";
}

function hasTerm(textWords: string[], termWords: string[]): boolean {
  if (!termWords.length || termWords.length > textWords.length) return false;
  outer:
  for (let i = 0; i + termWords.length <= textWords.length; i++) {
    for (let j = 0; j < termWords.length; j++) if (!sameWord(textWords[i + j], termWords[j])) continue outer;
    return true;
  }
  return false;
}

const anyTerm = (words: string[], terms: string[][]) => terms.some((t) => hasTerm(words, t));

// Splits the pool into { on, maybe } against the include terms, dropping anything an exclude term
// hits. `on` matched the board name, `maybe` only a description — the caller decides how far down
// that ladder it has to go. With no include terms everything that survives exclusion is `on`.
function filterPins(
  list: Array<Record<string, string>>,
  include: string[][],
  exclude: string[][],
): { on: Array<Record<string, string>>; maybe: Array<Record<string, string>> } {
  const on: Array<Record<string, string>> = [];
  const maybe: Array<Record<string, string>> = [];
  for (const p of list) {
    const board = normWords(p.boardName || "");
    const desc = normWords(p.desc || "");
    if (exclude.length && (anyTerm(board, exclude) || anyTerm(desc, exclude))) continue;
    if (!include.length) { on.push(p); continue; }
    if (anyTerm(board, include)) on.push(p);
    else if (anyTerm(desc, include)) maybe.push(p);
  }
  return { on, maybe };
}

// The ladder filterPins sets up, walked once: board-name matches, plus description matches only if
// those alone can't fill a day. Used for a pool that is already in hand (the profile's own pins);
// discoverPins runs the same ladder but can go and fetch more creators first.
function applyFilter(
  list: Array<Record<string, string>>,
  include: string[][],
  exclude: string[][],
): Array<Record<string, string>> {
  if (!include.length && !exclude.length) return list;
  const { on, maybe } = filterPins(list, include, exclude);
  return on.length >= DISCOVER_MIN_POOL ? on : on.concat(maybe);
}

// Terms as the client sends them: free text, so they are length-capped and count-capped here
// because they are matched against every pin in a pool of up to MAX_PINS.
function parseTerms(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  const out: string[][] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const words = normWords(t.slice(0, MAX_TERM_LEN));
    if (words.length && words.length <= 6) out.push(words);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

// `pinId` and `creator` are this function's own bookkeeping — the discover exclusion set and the
// taste graph. The client reads neither, and on a 500-pin response they are ~20KB of it, so they
// are dropped at the boundary rather than shipped. This is also what keeps the record the client
// sees to the one documented shape, whichever source it came from.
function forWire(p: Record<string, string>) {
  const { pinId: _pinId, creator: _creator, boardName: _boardName, desc: _desc, ...rest } = p;
  return rest;
}

/* ---------- discover: pins the profile has never saved ----------

   Reads a random sample of the creators behind pins already saved, and returns their recent pins
   minus everything the profile already has. Three things hold it up.

   The sample is **random every sync and deliberately small** — the cost control described at
   DISCOVER_CREATOR_SAMPLE, but also the variety mechanism: re-reading the same twelve creators
   daily would rebuild the same candidate pool, which is the very complaint this whole feature
   exists to answer. Drawing a fresh twelve makes the reachable pool the *whole* creator list.

   A creator that can't be read is skipped, never retried and never fatal: of 131 on a real
   profile, 10 were gone or private, and a discover pass that failed because one account went
   private would be a slideshow that breaks itself.

   And the exclusion is by pin id against the profile's OWN pins, gathered in the same request.
   It must not be done against the client's `seenIds` instead: that list is what stops repeats
   among pins already picked, a different job, and it is capped — using it here would let saved
   pins back in as soon as it rolled over. */
async function discoverPins(
  creatorIds: string[],
  ownIds: Set<string>,
  include: string[][],
  exclude: string[][],
  preferred: string[],
): Promise<{ pins: Array<Record<string, string>>; hits: string[] }> {
  if (!creatorIds.length) return { pins: [], hits: [] };

  const filtering = include.length > 0 || exclude.length > 0;
  // Creators that matched the keywords on a previous sync go first. Without this a narrow topic is
  // a fresh dice roll every time — measured on a real profile, "car" terms found 1 pin in a random
  // 36-creator draw, because the taste graph is mostly fashion accounts and the handful of car
  // creators rarely came up. A creator who pins cars keeps pinning cars, so remembering them is
  // what turns the filter from a lottery into something that sharpens with use.
  const prefer = new Set(filtering ? preferred.filter((id) => CREATOR_ID_RE.test(id)) : []);
  const hot = shuffled(creatorIds.filter((id) => prefer.has(id)));
  const rest = shuffled(creatorIds.filter((id) => !prefer.has(id)));

  const raw: Array<Record<string, string>> = [];
  const taken = new Set<string>();
  const hits = new Set<string>();
  // Unfiltered, one batch is plenty and always was. Filtered, a batch can yield almost nothing for
  // a narrow topic, so keep drawing batches while the on-topic pool is thin — bounded by rounds,
  // never by "until we have enough", or a keyword nobody the profile follows pins about would walk
  // the entire creator list one sync.
  const rounds = filtering ? DISCOVER_MAX_ROUNDS : 1;
  // Each filtered round is mostly known-good creators plus a few new ones, so the pool stays on
  // topic without ossifying into the same faces — the same reason the sample was random to begin
  // with. A round is still DISCOVER_CREATOR_SAMPLE fetches either way.
  const fromHot = filtering ? Math.ceil(DISCOVER_CREATOR_SAMPLE * 2 / 3) : 0;
  let hotAt = 0, restAt = 0;

  for (let round = 0; round < rounds; round++) {
    const sample: string[] = [];
    while (sample.length < fromHot && hotAt < hot.length) sample.push(hot[hotAt++]);
    while (sample.length < DISCOVER_CREATOR_SAMPLE && restAt < rest.length) sample.push(rest[restAt++]);
    // Hot creators can outnumber the reserved share once the rest are exhausted.
    while (sample.length < DISCOVER_CREATOR_SAMPLE && hotAt < hot.length) sample.push(hot[hotAt++]);
    if (!sample.length) break;

    let cursor = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < sample.length) {
          const id = sample[cursor++];
          const got = await fetchPidgetsCreator(id);
          const mine: Array<Record<string, string>> = [];
          for (const p of got || []) {
            if (!p.pinId || ownIds.has(p.pinId) || taken.has(p.pinId)) continue;
            taken.add(p.pinId);
            mine.push(p);
            if (raw.length < MAX_PINS) raw.push(p);
          }
          // "Matched" means a BOARD-name hit, not a description one: the description tier is the
          // loose fill, so counting it here would promote creators whose blurbs merely mention the
          // word — which is the noise the two tiers exist to separate.
          if (filtering && filterPins(mine, include, exclude).on.length) hits.add(id);
        }
      }),
    );

    if (!filtering) break;
    if (filterPins(raw, include, exclude).on.length >= DISCOVER_MIN_POOL) break;
  }

  return { pins: applyFilter(raw, include, exclude), hits: [...hits] };
}

// Fisher-Yates over a copy: a caller's order is its remembered list, which must not be reshuffled
// into the response.
function shuffled(list: string[]): string[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// A creator's own recent pins. Same endpoint as fetchPidgetsUser, which accepts a numeric user id
// wherever a username goes — that equivalence is what makes the whole feature possible, since a
// pin record names its creator by id and never by name.
async function fetchPidgetsCreator(id: string): Promise<Array<Record<string, string>> | null> {
  if (!CREATOR_ID_RE.test(id)) return null;
  const data = await fetchPidgets(`https://api.pinterest.com/v3/pidgets/users/${id}/pins/`);
  return data ? normalizePidgetPins(data) : null;
}

/* ---------- board discovery ----------

   Pinterest turned off server-rendering for logged-out visitors (its own page data lists
   `lop_unauth_lockdown_profile` / `_board` / `_search` as enabled), so scraping board links out of
   the profile HTML — which is what this used to do — now returns nothing at all, on every profile.
   That is not a cosmetic loss: with no boards the merge falls back to the ~24-pin profile feed, and
   a collection that picks 25 pins a day out of 24 shows an identical slideshow every morning.

   So discovery is now three sources, cheapest and most reliable first:
     1. what the client already knows (remembered across syncs, so the set only grows),
     2. the `board` object Pinterest attaches to each pin in the pidgets response — authoritative,
        free, already fetched, but only covers boards you pinned to within your last 50 saves,
     3. a plain web search, best-effort, and only when the first two came up thin.
   Any of them may return nothing without breaking the others. */
async function discoverBoards(username: string, remembered: string[], fromPins: string[]): Promise<string[]> {
  const out: string[] = [];
  const add = (s: string) => {
    if (!SLUG_RE.test(s) || RESERVED_SLUGS.has(s.toLowerCase())) return;
    if (out.includes(s)) return;
    out.push(s);
  };
  remembered.forEach(add);
  fromPins.forEach(add);

  if (out.length < SEARCH_DISCOVERY_BELOW) {
    for (const s of await discoverBoardsViaSearch(username)) add(s);
  }
  return out.slice(0, MAX_BOARDS);
}

// Boards a search engine has indexed for this profile. Strictly a bonus: it is the only source that
// can name a board you haven't pinned to in months, which is exactly the archive the slideshow wants
// — but it is someone else's HTML, it may be rate-limited from a datacenter IP, and a private
// profile is not indexed at all. Every one of those degrades to [] and the merge carries on with the
// boards it already had. It is also why this runs only when discovery is thin: once a profile's
// boards are known and remembered client-side, this call never happens again.
async function discoverBoardsViaSearch(username: string): Promise<string[]> {
  try {
    const q = encodeURIComponent(`site:pinterest.com/${username}/`);
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    // Results are wrapped in a redirect whose real target sits in the uddg= query parameter.
    // Anchored to the end, so only a board page matches — not a pin, not a board section.
    const boardRe = new RegExp(
      `^https://(?:[a-z]{2,3}\\.)?pinterest\\.[a-z.]{2,7}/${username}/([A-Za-z0-9_-]{1,80})/?$`,
      "i",
    );
    const slugs = new Set<string>();
    const re = /uddg=([^&"']+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let target: string;
      try { target = decodeURIComponent(m[1]); } catch { continue; }
      const hit = target.match(boardRe);
      if (hit) slugs.add(hit[1]);
    }
    return [...slugs];
  } catch (err) {
    console.error("Search board discovery failed", err);
    return [];
  }
}

/* ---------- pidgets ---------- */

// The 50 most recent pins on the profile, plus every board they mention. null = couldn't read it
// at all, which is what makes the caller lean on the profile RSS instead.
async function fetchPidgetsUser(
  username: string,
): Promise<{ pins: Array<Record<string, string>>; slugs: string[] } | null> {
  const data = await fetchPidgets(`https://api.pinterest.com/v3/pidgets/users/${username}/pins/`);
  if (!data) return null;

  const slugs = new Set<string>();
  for (const raw of data) {
    const url = (raw && raw.board && typeof raw.board.url === "string") ? raw.board.url : "";
    // Pinterest gives it as "/<user>/<slug>/". Matching the username back out is what stops a
    // collaborative board on someone else's profile joining this profile's fan-out.
    const m = url.match(/^\/([^/]+)\/([^/]+)\/$/);
    if (m && m[1].toLowerCase() === username.toLowerCase()) slugs.add(m[2]);
  }
  return { pins: normalizePidgetPins(data), slugs: [...slugs] };
}

async function fetchPidgetsBoard(username: string, slug: string): Promise<Array<Record<string, string>> | null> {
  const data = await fetchPidgets(`https://api.pinterest.com/v3/pidgets/boards/${username}/${slug}/pins/`);
  // The BOARD endpoint omits the `board` object the user endpoint puts on every pin (verified), so
  // without this the keyword filter's primary field is empty for every pin on your own boards —
  // which is most of them. The slug is the name in URL form ("aviation-world"), and normWords()
  // splits on the hyphen anyway, so it matches exactly what the display name would have matched.
  return data ? normalizePidgetPins(data, slug) : null;
}

// null = the endpoint couldn't be read, or answered with something that wasn't a pin list (vs []
// = read fine, no pins on it) — the same distinction fetchRssPins draws, and the caller's fallback
// to RSS depends on it.
// deno-lint-ignore no-explicit-any
async function fetchPidgets(url: string): Promise<Array<Record<string, any>> | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    const pins = body && body.data && body.data.pins;
    return Array.isArray(pins) ? pins : null;
  } catch (err) {
    console.error("pidgets fetch failed", url, err);
    return null;
  }
}

// Into the same record shape parsePins() emits, so the client can't tell the two sources apart.
// Note a pidgets pin's own `link` is the DESTINATION website, not the pin page — the pin page has
// to be built from the id, and it is that pin page URL the "resolve" action is keyed by.
// deno-lint-ignore no-explicit-any
function normalizePidgetPins(raw: Array<Record<string, any>>, fallbackBoard = "") {
  const pins: Array<Record<string, string>> = [];
  for (const p of raw) {
    const id = String((p && p.id) || "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) continue;

    const images = (p && p.images) || {};
    let path = "";
    for (const key of ["564x", "474x", "237x", "236x"]) {
      const src = (images[key] && typeof images[key].url === "string") ? images[key].url : "";
      const m = src.match(PINIMG_RE);
      if (m) { path = m[1]; break; }
    }
    if (!path) continue;

    // The pin's own id and the id of the Pinterest user who made it. Both are server-side
    // bookkeeping for discover mode — the exclusion set and the taste graph — and neither is read
    // by the client, but they ride on the record because this is the only place that has them.
    const creator = String((p && p.native_creator && p.native_creator.id) || "");
    // The board its creator filed it under, and its full description — the two things the keyword
    // filter reads, and the reason it can tell a car photo from a t-shirt advert that says "BMW".
    // Both are internal: forWire() strips them, so neither costs the client anything.
    const boardName = decodeEntities(String((p && p.board && p.board.name) || fallbackBoard)).trim();
    const desc = decodeEntities(String((p && p.description) || "")).trim();

    const link = `https://www.pinterest.com/pin/${id}/`;
    pins.push({
      id: link,
      // Same /736x/ full-size render the RSS path asks for, and the same /236x/ fallback for the
      // rare pin that has no 736x variant.
      url: `https://i.pinimg.com/736x/${path}`,
      fallbackUrl: `https://i.pinimg.com/236x/${path}`,
      link,
      title: desc.slice(0, 200),
      pinId: id,
      ...(CREATOR_ID_RE.test(creator) ? { creator } : {}),
      ...(boardName ? { boardName } : {}),
      ...(desc ? { desc } : {}),
    });
  }
  return pins;
}

/* ---------- video resolve ---------- */

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

/* ---------- RSS ---------- */

// null = the feed couldn't be read at all (vs [] = read fine, no pins in it).
async function fetchRssPins(url: string, boardName = ""): Promise<Array<Record<string, string>> | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/rss+xml, text/xml, */*" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return parsePins(await resp.text(), boardName);
  } catch (err) {
    console.error("Feed fetch failed", url, err);
    return null;
  }
}

// Regex parsing rather than a DOM/XML parser: Deno has no built-in XML parser, and the
// shape here is fixed and simple — each <item> holds the pin page <link> and an <img>
// buried inside an HTML-escaped <description>.
function parsePins(xml: string, boardName = "") {
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
    // Carried for the same reason the pidgets path carries it: discover subtracts the profile's
    // own pins by id, and a board read through RSS rather than pidgets must contribute to that
    // exclusion set too, or pins you already saved come back as "new". RSS names no creator, so
    // these boards widen the exclusion set without widening the taste graph.
    const pinId = (link.match(/\/pin\/([A-Za-z0-9_-]{1,64})\/?\s*$/) || [])[1] || "";
    // RSS names no board on the item, but the CALLER knows which board's feed this is, so the
    // keyword filter's primary field survives the fallback path. The profile feed passes nothing,
    // which is right: those pins span every board and no one name would be true of them.
    const desc = decodeEntities(title).trim();

    pins.push({
      id: link || url,
      url,
      fallbackUrl,
      link: link.trim(),
      title: desc.slice(0, 200),
      ...(pinId ? { pinId } : {}),
      ...(boardName ? { boardName } : {}),
      ...(desc ? { desc } : {}),
    });
  }

  return pins;
}

function decodeEntities(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // Numeric forms as well as named: board names are full of them (`frankkkkkk&#129782;`), and a
    // keyword filter matching against a name still carrying `&#129782;` is matching noise.
    .replace(/&#(\d{1,7});/g, (_m, d) => { try { return String.fromCodePoint(Number(d)); } catch { return " "; } })
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
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
