// supabase/functions/suggest-subtasks/index.ts
//
// Proxies "suggest subtasks" requests to the Anthropic API.
// The API key never touches the browser — it lives only as a Supabase secret,
// read here via Deno.env.get(). The client calls this function by name
// (supabase.functions.invoke), not api.anthropic.com directly.
//
// Cost safety:
//  - DAILY_LIMIT caps how many AI calls can happen per day, across the whole app.
//  - MAX_TOKENS caps the size (and therefore cost) of every individual call.
//  - Uses Haiku, the cheapest current Claude model, since subtask suggestions
//    are a short, simple task that doesn't need a bigger model.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAILY_LIMIT = 30;      // total AI calls allowed per day, tune to taste
const MAX_TOKENS = 300;      // hard cap per call — plenty for 5 short subtask strings
const MODEL = "claude-haiku-4-5-20251001";

const CORS_HEADERS = {
  // Lock this down to your actual GitHub Pages origin once deployed, e.g.
  // "https://yourusername.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { goalTitle, contextLine } = await req.json();

    if (!goalTitle || typeof goalTitle !== "string" || goalTitle.length > 200) {
      return json({ error: "Invalid goalTitle" }, 400);
    }
    if (contextLine && (typeof contextLine !== "string" || contextLine.length > 2000)) {
      return json({ error: "Invalid contextLine" }, 400);
    }

    // Service-role client, used ONLY inside this server-side function to check/update
    // the daily usage counter. This key is a Supabase secret too — never exposed to the browser.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: usageRow } = await supabase
      .from("ai_usage")
      .select("count")
      .eq("day", today)
      .maybeSingle();

    if (usageRow && usageRow.count >= DAILY_LIMIT) {
      return json({ error: "Daily AI suggestion limit reached. Try again tomorrow." }, 429);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY" }, 500);
    }

    const prompt = `Goal: "${goalTitle}". ${contextLine || "Suggest 5 concise, actionable subtasks (each under 8 words) to help finish this goal."} Respond with ONLY a raw JSON array of strings, nothing else.`;

    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error("Anthropic API error:", errText);
      return json({ error: "AI request failed" }, 502);
    }

    const data = await anthropicResp.json();
    const text = (data.content || [])
      .filter((c: { type: string }) => c.type === "text")
      .map((c: { text: string }) => c.text)
      .join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const suggestions = JSON.parse(clean);

    // Only bump the counter after a successful, billable call.
    await supabase.from("ai_usage").upsert(
      { day: today, count: (usageRow?.count || 0) + 1 },
      { onConflict: "day" },
    );

    return json({ suggestions });
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
