// supabase/functions/upload-fitness-photo/index.ts
//
// Uploads a fitness progress photo to a Google Drive folder on the app owner's behalf,
// fully automatically — the browser never talks to Google directly and never sees any
// Google credentials. This app has no login (see index.html's SHARED_ROW_ID comment), so
// "the user's Drive" here means the one Google account that was authorized once, up front,
// during setup (see README.md), not a per-visitor account.
//
// Requires these Supabase secrets (set once, see README.md "Setup" section):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN  — from a one-time OAuth
//     consent (scope: https://www.googleapis.com/auth/drive.file) that never expires until
//     revoked, letting this function mint a fresh access token on every call.
//   GOOGLE_DRIVE_FOLDER_ID (optional) — Drive folder to upload into; uploads to Drive's
//     root "My Drive" if unset.

import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const CORS_HEADERS = {
  // Lock this down to your actual GitHub Pages origin once deployed, e.g.
  // "https://yourusername.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — plenty for a phone photo, keeps abuse bounded

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { imageBase64, filename, mimeType } = await req.json();

    if (!imageBase64 || typeof imageBase64 !== "string") {
      return json({ error: "Missing imageBase64" }, 400);
    }
    if (!mimeType || typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
      return json({ error: "Invalid or missing mimeType" }, 400);
    }
    const safeFilename = (typeof filename === "string" && filename.trim())
      ? filename.trim().slice(0, 120)
      : `progress-${new Date().toISOString().slice(0, 10)}.jpg`;

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(imageBase64);
    } catch {
      return json({ error: "imageBase64 is not valid base64" }, 400);
    }
    if (bytes.byteLength === 0) return json({ error: "Empty image" }, 400);
    if (bytes.byteLength > MAX_BYTES) return json({ error: "Image too large (max 15MB)" }, 400);

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID");
    if (!clientId || !clientSecret || !refreshToken) {
      return json({ error: "Server misconfigured: missing Google Drive credentials" }, 500);
    }

    // Exchange the long-lived refresh token for a short-lived access token — done on every
    // call rather than cached, since Edge Functions are stateless between invocations.
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenResp.ok) {
      console.error("Google token refresh failed:", await tokenResp.text().catch(() => ""));
      return json({ error: "Could not authenticate with Google Drive" }, 502);
    }
    const { access_token } = await tokenResp.json();
    if (!access_token) return json({ error: "Google did not return an access token" }, 502);

    const metadata: Record<string, unknown> = { name: safeFilename };
    if (folderId) metadata.parents = [folderId];

    // Multipart upload: a JSON metadata part + the raw image bytes, joined by a boundary —
    // Drive's multipart/related upload format (see Drive API v3 docs).
    const boundary = "p25_" + crypto.randomUUID().replace(/-/g, "");
    const encoder = new TextEncoder();
    const preamble = encoder.encode(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadata)}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`,
    );
    const closing = encoder.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(preamble.length + bytes.length + closing.length);
    body.set(preamble, 0);
    body.set(bytes, preamble.length);
    body.set(closing, preamble.length + bytes.length);

    const uploadResp = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!uploadResp.ok) {
      console.error("Drive upload failed:", uploadResp.status, await uploadResp.text().catch(() => ""));
      return json({ error: "Upload to Google Drive failed" }, 502);
    }
    const uploaded = await uploadResp.json();

    return json({ fileId: uploaded.id, webViewLink: uploaded.webViewLink });
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
