// supabase/functions/upload-resume/index.ts
//
// Uploads a Jobs-tab resume PDF to a Google Drive folder named "Uploaded Resumes" on the app
// owner's behalf — the browser never talks to Google directly and never sees any Google
// credentials. Reuses the exact same one-time-authorized Google account/refresh token as
// upload-fitness-photo (see that function's header comment for what "the user's Drive" means
// for a no-login app like this one), just targeting a different, resume-specific folder.
//
// Requires the same Supabase secrets already set for upload-fitness-photo:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
// No new secret is required for the folder: rather than a second GOOGLE_DRIVE_*_FOLDER_ID to
// configure, this function finds a Drive folder literally named "Uploaded Resumes" (creating
// it on first run if it doesn't exist yet) — deliberately not sharing upload-fitness-photo's
// GOOGLE_DRIVE_FOLDER_ID, since that one may be unset (root) or pointed at a photos folder.
// Override the folder by setting GOOGLE_DRIVE_RESUMES_FOLDER_ID if you'd rather point this at
// a specific existing folder instead of the by-name lookup.

import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const CORS_HEADERS = {
  // Lock this down to your actual GitHub Pages origin once deployed, e.g.
  // "https://yourusername.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — plenty for a resume PDF, keeps abuse bounded
const RESUMES_FOLDER_NAME = "Uploaded Resumes";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { fileBase64, filename, mimeType } = await req.json();

    if (!fileBase64 || typeof fileBase64 !== "string") {
      return json({ error: "Missing fileBase64" }, 400);
    }
    if (mimeType !== "application/pdf") {
      return json({ error: "Only PDF files are supported" }, 400);
    }
    const safeFilename = (typeof filename === "string" && filename.trim())
      ? filename.trim().slice(0, 150)
      : `resume-${new Date().toISOString().slice(0, 10)}.pdf`;

    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(fileBase64);
    } catch {
      return json({ error: "fileBase64 is not valid base64" }, 400);
    }
    if (bytes.byteLength === 0) return json({ error: "Empty file" }, 400);
    if (bytes.byteLength > MAX_BYTES) return json({ error: "File too large (max 15MB)" }, 400);

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
    const explicitFolderId = Deno.env.get("GOOGLE_DRIVE_RESUMES_FOLDER_ID");
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

    let folderId = explicitFolderId || null;
    if (!folderId) {
      try {
        folderId = await findOrCreateResumesFolder(access_token);
      } catch (e) {
        console.error("Resolving Uploaded Resumes folder failed:", e);
        return json({ error: "Could not find or create the \"Uploaded Resumes\" Drive folder" }, 502);
      }
    }

    const metadata: Record<string, unknown> = { name: safeFilename, parents: [folderId] };

    // Multipart upload: a JSON metadata part + the raw file bytes, joined by a boundary —
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

    // Make the file link-viewable so "View in Drive" works without the visitor needing a
    // Google login — same trade-off as upload-fitness-photo (see its comment on this same
    // call): anyone with the file's (long, unguessable) id could view it. If the permission
    // update fails, the upload itself still succeeded — webViewLink just won't be openable
    // by anyone but the app owner's own Google account.
    const permResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${uploaded.id}/permissions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      },
    );
    if (!permResp.ok) {
      console.error("Drive permission update failed:", permResp.status, await permResp.text().catch(() => ""));
    }

    return json({ fileId: uploaded.id, webViewLink: uploaded.webViewLink });
  } catch (err) {
    console.error(err);
    return json({ error: "Unexpected error" }, 500);
  }
});

// Looks up a non-trashed folder named exactly "Uploaded Resumes" anywhere the authorized
// account can see; creates it (in Drive root) on first-ever call if none is found yet, so no
// manual "create a folder and paste its ID" setup step is needed for this feature specifically.
async function findOrCreateResumesFolder(accessToken: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${RESUMES_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const listResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (listResp.ok) {
    const { files } = await listResp.json();
    if (files && files.length > 0) return files[0].id;
  }
  const createResp = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: RESUMES_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!createResp.ok) {
    throw new Error(`Could not create "${RESUMES_FOLDER_NAME}" folder: ${createResp.status}`);
  }
  const created = await createResp.json();
  return created.id;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
