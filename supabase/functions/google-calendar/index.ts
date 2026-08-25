// supabase/functions/google-calendar/index.ts
//
// Reads the app owner's Google Calendar and returns a trimmed agenda as JSON. Read-only:
// the scope below cannot create, edit or delete anything, so no bug on either side of this
// wire can touch a real calendar entry.
//
// Why a server-side function at all: the same reason upload-fitness-photo is one. This app
// has no login (see js/persistence.js's SHARED_ROW_ID comment), so there is no per-visitor
// Google account to consent — "the calendar" is the one account authorized once, up front,
// during setup. Doing it in the browser instead would mean a Web OAuth client, a consent
// popup, authorized JS origins (which rules out opening index.html off the filesystem), and
// a live Google access token sitting in page memory. None of that buys anything here.
//
// Requires these Supabase secrets (set once, see README.md "Setup"):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  — shared with upload-fitness-photo/upload-resume.
//   GOOGLE_CALENDAR_REFRESH_TOKEN — from a one-time OAuth consent with scope
//     https://www.googleapis.com/auth/calendar.readonly
//   GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET (optional) — only needed if that
//     consent was done against a DIFFERENT OAuth client than the Drive one (see getAccessToken()).
//
// That last one is deliberately NOT the existing GOOGLE_REFRESH_TOKEN. That token carries
// only drive.file, so it would have to be re-consented into a combined Drive+Calendar token
// to work here — and Fitness progress photos and Jobs resume uploads both depend on it. A
// separate secret means the worst case of a Calendar mistake is that Calendar breaks.
//
// Two actions, on the same function:
//   { action: "calendars" }            -> { calendars }  the account's calendar list, for the picker
//   { action: "events", calendarIds }  -> { events }      merged, trimmed, sorted by start

const CORS_HEADERS = {
  // Lock this down to your actual GitHub Pages origin once deployed, e.g.
  // "https://yourusername.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// A calendar id is interpolated into the URL path below, so this pattern IS the SSRF guard —
// exactly the role USERNAME_RE plays in pinterest-feed. It admits no "/", ":" or "?", which is
// what would let a crafted value point the fetch at another host or path. "primary" is Google's
// alias for the account's own calendar; everything else is either an email-shaped id or one of
// the *.calendar.google.com ids Google mints for secondary/holiday/group calendars (those are
// email-shaped too, e.g. en.malaysia#holiday@group.v.calendar.google.com).
const CAL_ID_RE = /^(primary|[A-Za-z0-9._%+#-]{1,120}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,24})$/;

const MAX_CALENDARS = 10; // bounds the fan-out; a person's calendar list is single digits
const MAX_RESULTS = 250; // Google's own per-page cap for events.list
const MAX_WINDOW_DAYS = 60; // bounds how much history/future one call can ask Google for
const FETCH_TIMEOUT_MS = 10000;
const DAY_MS = 86400000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body && typeof body.action === "string" ? body.action : "events";

    const token = await getAccessToken();
    if (typeof token !== "string") return token; // an error Response, already shaped

    if (action === "calendars") return await listCalendars(token);
    if (action === "events") return await listEvents(token, body);
    return json({ error: 'Unknown action "' + action + '"' }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error" }, 500);
  }
});

// Exchange the long-lived refresh token for a short-lived access token — done on every call
// rather than cached, since Edge Functions are stateless between invocations. Returns the token
// string on success, or a ready-to-return error Response on failure.
async function getAccessToken(): Promise<string | Response> {
  // A refresh token is bound to the OAuth client that ISSUED it — handing it to a different
  // client id/secret fails with invalid_client, not with anything that names the real problem.
  // That matters because the Drive functions' client is a Desktop-app one, and the OAuth
  // Playground can only be used with a WEB-application client (it needs
  // https://developers.google.com/oauthplayground registered as a redirect URI, a field Desktop
  // clients don't have). So anyone taking the Playground route may well end up with a second
  // client, and these two optional secrets are how that's expressed. Unset — the normal case,
  // one client for everything — this falls back to the shared pair.
  const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID") || Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET") || Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_CALENDAR_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    return json({ error: "Server misconfigured: missing Google Calendar credentials" }, 500);
  }

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!tokenResp.ok) {
    console.error("Google token refresh failed:", await tokenResp.text().catch(() => ""));
    return json({ error: "Could not authenticate with Google Calendar" }, 502);
  }
  const { access_token } = await tokenResp.json();
  if (!access_token) return json({ error: "Google did not return an access token" }, 502);
  return access_token as string;
}

// The account's calendar list, trimmed to what the picker needs. `selected`/`primary` are passed
// through so the client can default sensibly the first time, before anything has been chosen.
async function listCalendars(token: string): Promise<Response> {
  const url = "https://www.googleapis.com/calendar/v3/users/me/calendarList" +
    "?minAccessRole=reader&showHidden=false&maxResults=250";
  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) {
    console.error("calendarList failed:", resp.status, await resp.text().catch(() => ""));
    return json({ error: "Couldn't read your calendar list from Google." }, 502);
  }
  const data = await resp.json();
  const calendars = (data.items || [])
    .filter((c: Record<string, unknown>) =>
      typeof c.id === "string" && CAL_ID_RE.test(c.id as string)
    )
    .map((c: Record<string, unknown>) => ({
      id: c.id,
      summary: c.summaryOverride || c.summary || c.id,
      primary: !!c.primary,
      selected: !!c.selected,
      backgroundColor: typeof c.backgroundColor === "string" ? c.backgroundColor : "",
    }));
  return json({ calendars });
}

// { calendarId -> backgroundColor } for the agenda's colour coding. Non-fatal: an unreadable list
// just means no colours, and the client falls back to its own accent.
//
// The "primary" alias needs its own entry. calendarList reports that calendar under its real id
// (the account's email address) with primary:true — so a request for the literal string "primary",
// which is what an untouched picker sends, would find nothing to match.
async function fetchCalendarColors(token: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250&fields=items(id,primary,backgroundColor)",
      { headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!resp.ok) return map;
    const data = await resp.json();
    for (const c of data.items || []) {
      if (typeof c.id !== "string" || typeof c.backgroundColor !== "string") continue;
      map[c.id] = c.backgroundColor;
      if (c.primary) map["primary"] = c.backgroundColor;
    }
  } catch (err) {
    console.error("calendarList colours failed:", err);
  }
  return map;
}

async function listEvents(token: string, body: Record<string, unknown>): Promise<Response> {
  // An empty/absent list means "just the account's own calendar" — the same thing the client
  // shows before you have ever opened the picker.
  const rawIds = Array.isArray(body.calendarIds) && body.calendarIds.length
    ? body.calendarIds
    : ["primary"];
  const ids = (rawIds as unknown[])
    .filter((id): id is string => typeof id === "string" && CAL_ID_RE.test(id))
    .slice(0, MAX_CALENDARS);
  if (!ids.length) return json({ error: "No valid calendar ids given." }, 400);

  const now = Date.now();
  const timeMin = parseIso(body.timeMinIso, now);
  // Clamp the far edge rather than rejecting it: a client asking for too much gets less data,
  // not an error it has to handle.
  const maxEnd = timeMin + MAX_WINDOW_DAYS * DAY_MS;
  const timeMax = Math.min(parseIso(body.timeMaxIso, timeMin + 14 * DAY_MS), maxEnd);
  if (timeMax <= timeMin) return json({ error: "timeMaxIso must be after timeMinIso." }, 400);

  const maxResults = clampInt(body.maxResults, 250, 1, MAX_RESULTS);

  // The per-calendar colour is resolved HERE rather than left to the client to correlate, because
  // the client's calendar list is only fetched when the Calendar pane is opened — and the "coming
  // up" bubble fires on app load, before that has ever happened. Doing it server-side means one
  // small extra Google call per agenda refresh and no ordering problem on the page. It runs
  // alongside the event fetches rather than before them, so it costs no latency.
  const [colors, ...settled] = await Promise.all([
    fetchCalendarColors(token),
    ...ids.map((id) => fetchCalendarEvents(token, id, timeMin, timeMax, maxResults)),
  ]) as [Record<string, string>, ...Array<Array<Record<string, unknown>> | null>];

  const events: Array<Record<string, unknown>> = [];
  const failed: string[] = [];
  settled.forEach((res, i) => {
    if (res === null) failed.push(ids[i]);
    else {
      for (const ev of res) ev.color = colors[ids[i]] || "";
      events.push(...res);
    }
  });

  // One unreadable calendar must not blank the agenda — the others still render, and the client
  // is told which ones are missing. Only a total failure is an error.
  if (failed.length === ids.length) {
    return json({ error: "Couldn't read your calendar from Google." }, 502);
  }

  events.sort((a, b) => (a.startMs as number) - (b.startMs as number));
  return json({ events, failed, fetchedAt: Date.now() });
}

// Returns the trimmed events for one calendar, or null if that calendar couldn't be read.
async function fetchCalendarEvents(
  token: string,
  calendarId: string,
  timeMin: number,
  timeMax: number,
  maxResults: number,
): Promise<Array<Record<string, unknown>> | null> {
  // singleEvents=true is mandatory, not a nicety: without it a weekly standup comes back ONCE, as
  // a master event carrying an RRULE, and this app would have to implement recurrence expansion
  // itself. With it Google returns the concrete instances that actually fall in the window.
  // orderBy=startTime is only legal alongside it, which is the other half of the reason.
  const url =
    "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(calendarId) +
    "/events?singleEvents=true&orderBy=startTime&maxResults=" + maxResults +
    "&timeMin=" + encodeURIComponent(new Date(timeMin).toISOString()) +
    "&timeMax=" + encodeURIComponent(new Date(timeMax).toISOString());
  try {
    const resp = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.error("events.list failed:", calendarId, resp.status, await resp.text().catch(() => ""));
      return null;
    }
    const data = await resp.json();
    const out: Array<Record<string, unknown>> = [];
    for (const item of data.items || []) {
      if (item && item.status === "cancelled") continue;
      const trimmed = trimEvent(item, calendarId);
      if (trimmed) out.push(trimmed);
    }
    return out;
  } catch (err) {
    console.error("events.list threw:", calendarId, err);
    return null;
  }
}

// The whole payload the browser is ever given for an event, bar the `color` that listEvents()
// attaches afterwards. Google's raw item also carries
// attendee email addresses, the full description, conference join links and organiser details —
// this app's browser context is an unauthenticated shared row, so none of that crosses the wire.
//
// allDay is resolved here rather than client-side because it's a Google quirk: a timed event
// carries start.dateTime, an all-day one carries start.date ("2026-08-25", no zone). Deciding it
// once, on the side that knows, is what keeps the client from having to.
function trimEvent(e: Record<string, unknown>, calendarId: string) {
  const start = e.start as Record<string, string> | undefined;
  const end = e.end as Record<string, string> | undefined;
  if (!start) return null;
  const allDay = !start.dateTime;
  const startIso = start.dateTime || start.date;
  const endIso = (end && (end.dateTime || end.date)) || startIso;
  if (!startIso) return null;
  // An all-day date carries no zone, so Date.parse() reads it as UTC midnight and it can land on
  // the wrong local day east or west of Greenwich. Appending T00:00:00 makes it local midnight
  // instead — note the client re-derives this the same way for its own day grouping.
  const startMs = Date.parse(allDay ? startIso + "T00:00:00" : startIso);
  if (!isFinite(startMs)) return null;
  return {
    id: String(e.id || ""),
    calendarId,
    summary: typeof e.summary === "string" ? e.summary.slice(0, 300) : "(no title)",
    location: typeof e.location === "string" ? e.location.slice(0, 200) : "",
    htmlLink: typeof e.htmlLink === "string" ? e.htmlLink : "",
    allDay,
    startIso,
    endIso,
    startMs,
  };
}

function parseIso(v: unknown, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const ms = Date.parse(v);
  return isFinite(ms) ? ms : fallback;
}

function clampInt(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  if (!isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
