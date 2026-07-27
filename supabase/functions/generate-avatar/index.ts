// supabase/functions/generate-avatar/index.ts
//
// Proxies "generate AI avatar" requests to Pollinations.ai's free image API
// (https://image.pollinations.ai) — no API key, no account, and no billing involved, unlike
// Gemini's "Nano Banana" image model (gemini-2.5-flash-image), which turned out to have a
// 0-request free-tier quota and requires a billing-enabled Google Cloud project.
//
// Age bracket, fitness tier, and net worth tier are always fixed keys derived from the user's
// actual stats (never free text) and checked against the lookup tables below. The About Me
// fields (race, skin tone, hair color/style, eye color, clothing, background) are free text the
// user typed themselves — sanitized/length-capped below, not validated against a fixed list.
// This app has no login (see index.html's SHARED_ROW_ID comment) and Pollinations' endpoint is
// itself a free, ungated public service anyone can already call directly with any prompt, so
// accepting free text here doesn't meaningfully change the risk profile versus that baseline.
// Net worth's clothing/setting phrase is always layered in below even when the user supplies
// their own clothing/background text, so wealth level stays visible either way.
//
// No secrets needed — Pollinations' image endpoint is public, keyless, and unlimited, so this
// function doesn't rate-limit or track usage.

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const CORS_HEADERS = {
  // Lock this down to your actual GitHub Pages origin once deployed, e.g.
  // "https://yourusername.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fixed vocabularies — these three always come from real app stats, never typed by hand.
const AGE_PHRASES: Record<string, string> = {
  young: "a youthful teenage or young-adult character",
  adult: "a young adult character in their 20s to 40s",
  senior: "a distinguished older character with grey hair",
  unknown: "an adult character of indeterminate age",
};
// Written to survive a tight waist-up crop — a "build" adjective alone often doesn't render
// visibly at that framing, so each tier also names a concrete, visible facial/neck cue.
const FITNESS_PHRASES: Record<string, string> = {
  fit: "an athletic, toned build, a lean face, and a defined jawline",
  underweight: "a very thin, underweight build with a slender, narrow face and visible cheekbones",
  overweight: "a clearly overweight build, a round, fuller face, and a soft double chin",
  obese: "a heavyset, obese build, a wide and very full face, a prominent double chin, and a thick neck",
  unknown: "an average build",
};
// Default clothing description, used when the user hasn't typed their own Clothing text.
const WORTH_CLOTHING_PHRASES: Record<string, string> = {
  starter: "wearing simple, plain, worn everyday clothing",
  stable: "wearing neat, casual modern clothing",
  comfortable: "wearing sharp, stylish clothing with subtle nice details",
  wealthy: "wearing a well-tailored, upscale outfit with fine details",
  elite: "wearing an opulent, luxurious outfit with gold accents and jewelry, radiating wealth and success",
};
// Default background/setting, used when the user hasn't typed their own Background text.
const WORTH_SETTING_PHRASES: Record<string, string> = {
  starter: "a plain, modest, no-frills environment",
  stable: "a comfortable, ordinary everyday environment",
  comfortable: "a well-kept, upper-middle-class environment",
  wealthy: "an upscale, high-end environment",
  elite: "an opulent, luxurious environment with lavish, extravagant details",
};
// Short quality cue layered onto the user's OWN clothing/background text (when they provide
// one) so net worth still reads visually even though the wording is theirs, not ours.
const WORTH_QUALITY_WORDS: Record<string, string> = {
  starter: "cheap, worn-out",
  stable: "modest, everyday",
  comfortable: "nice, well-kept",
  wealthy: "expensive, high-end",
  elite: "extravagant, luxury-grade",
};

// Strip newlines/control characters and cap length — this is about keeping the assembled
// prompt sane and bounded, not about blocking any particular content.
function clean(v: unknown, maxLen: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const {
      ageBracket, fitnessTier, worthTier,
      race, skinTone, hairColor, hairStyle, eyeColor, clothing, background,
    } = await req.json();

    const agePhrase = AGE_PHRASES[ageBracket];
    const fitnessPhrase = FITNESS_PHRASES[fitnessTier];
    const clothingDefault = WORTH_CLOTHING_PHRASES[worthTier];
    const settingDefault = WORTH_SETTING_PHRASES[worthTier];
    const qualityWord = WORTH_QUALITY_WORDS[worthTier];
    if (!agePhrase || !fitnessPhrase || !clothingDefault) {
      return json({ error: "Invalid stat keys" }, 400);
    }

    // Free text from the About Me tab — all optional, all cleaned/truncated, no fixed list.
    const raceText = clean(race, 40);
    const skinText = clean(skinTone, 40);
    const hairColorText = clean(hairColor, 40);
    const hairStyleText = clean(hairStyle, 40);
    const eyeText = clean(eyeColor, 40);
    const clothingText = clean(clothing, 80);
    const backgroundText = clean(background, 80);

    const racePhrase = raceText ? `of ${raceText} descent` : "";
    const skinPhrase = skinText ? `${skinText} skin` : "";
    const hairPhrase = [hairStyleText, hairColorText].filter(Boolean).join(" ")
      ? `${[hairStyleText, hairColorText].filter(Boolean).join(" ")} hair` : "";
    const eyePhrase = eyeText ? `${eyeText} eyes` : "";

    // Net worth always shows: either it fully drives clothing/setting (no custom text), or the
    // user's own text is kept but qualified with a wealth-appropriate quality cue.
    const clothingPhrase = clothingText
      ? `wearing ${clothingText} (${qualityWord} quality)`
      : clothingDefault;
    const settingPhrase = backgroundText
      ? `Set in ${backgroundText}, with an overall ${qualityWord} atmosphere reflecting their wealth`
      : `Set in ${settingDefault}`;

    const traits = [fitnessPhrase, skinPhrase, hairPhrase, eyePhrase].filter(Boolean).join(", ");
    const prompt = `A photorealistic portrait photograph of ${agePhrase}`
      + (racePhrase ? `, ${racePhrase}` : "")
      + `, with ${traits}, ${clothingPhrase}. ${settingPhrase}, background softly blurred so the `
      + `subject stays in sharp focus. Real human, natural skin texture and pores, shot on a DSLR `
      + `camera, professional photography, soft natural lighting, waist-up framing so the body build `
      + `is clearly visible, facing forward, centered. Photo, not an illustration, not a cartoon, not `
      + `a painting, not digital art, no text, no watermark, no logos.`;

    // Random seed each call — pressing "Regenerate" is expected to produce a fresh variation,
    // not the same image every time, even with unchanged stats.
    const seed = Math.floor(Math.random() * 1_000_000);

    const imgUrl = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt)
      + `?width=512&height=640&model=flux&nologo=true&seed=${seed}`;

    const imgResp = await fetch(imgUrl);
    if (!imgResp.ok) {
      console.error("Pollinations API error:", imgResp.status, await imgResp.text().catch(() => ""));
      return json({ error: "AI image request failed" }, 502);
    }

    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(await imgResp.arrayBuffer());
    if (bytes.byteLength === 0) {
      return json({ error: "The AI didn't return an image, try again." }, 502);
    }
    const image = `data:${contentType};base64,${encodeBase64(bytes)}`;

    return json({ image });
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
