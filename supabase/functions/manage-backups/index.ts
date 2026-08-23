// supabase/functions/manage-backups/index.ts
//
// Lets the client browse and restore the daily backups created by
// scripts/backup-supabase.sh, without ever exposing the service_role key — or the
// "backups" Storage bucket itself — to the browser. That bucket is deliberately
// private (service_role only) so this repo staying public never exposes backed-up
// data; this function is the one server-side hop allowed to read it.
//
// This function only reads a backup and hands its contents back to the client —
// it does not write anything. The client applies the restored data locally and
// saves it back through the normal app_data path (see index.html's doRestore()).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  // Lock this down to your actual GitHub Pages origin once deployed, e.g.
  // "https://yourusername.github.io"
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Backups are uploaded as "<YYYY-MM-DD>.json" at the bucket root — reject anything else
// so a malformed request can't be used to probe other paths in the bucket.
const FILE_NAME_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { action, file } = await req.json().catch(() => ({}));

    if (action === "list") {
      const { data, error } = await supabase.storage.from("backups").list("", {
        sortBy: { column: "name", order: "desc" },
      });
      if (error) return json({ error: error.message }, 500);
      const files = (data || [])
        .filter((f) => FILE_NAME_RE.test(f.name))
        .map((f) => ({ name: f.name, updatedAt: f.updated_at }));
      return json({ files });
    }

    if (action === "restore") {
      if (typeof file !== "string" || !FILE_NAME_RE.test(file)) {
        return json({ error: "Invalid file name" }, 400);
      }
      const { data, error } = await supabase.storage.from("backups").download(file);
      if (error) return json({ error: "Backup not found" }, 404);

      let parsed;
      try {
        parsed = JSON.parse(await data.text());
      } catch {
        return json({ error: "Backup file is not valid JSON" }, 500);
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return json({ error: "Backup file doesn't contain the expected data" }, 500);
      }

      // Several backup file shapes exist and all must keep working:
      //  - Legacy (before the Jobs tab got its own app_data row): a single-element array with no
      //    "id" key, [{ data: {...whole state, jobs still embedded...} }], because the old backup
      //    script only selected `data`. Every backup taken before that change looks like this.
      //  - Current: one element per fetched row, tagged by id — e.g.
      //    [{id:"jobs",...},{id:"notes",...},{id:"scratch",...},{id:"shared",...}].
      //    Rows MUST be selected by .id, never by array position: the script orders by id.asc, so
      //    "jobs", "notes" and "scratch" ALL sort before "shared" and index 0 is NOT the main state.
      // The jobs, notes and scratch rows may each legitimately be absent (account never used that
      // tab, or the backup predates that tab's split) — not an error; the corresponding field just
      // stays null. For jobs and notes the client then falls back to any copy still embedded in the
      // shared blob; scratch has no such fallback, because it has never lived anywhere but its own
      // row, so a backup without it simply predates the feature and an empty page is correct.
      let mainData;
      let jobsData = null;
      let notesData = null;
      let scratchData = null;
      if (parsed[0].id === undefined) {
        mainData = parsed[0].data;
      } else {
        // deno-lint-ignore no-explicit-any
        const sharedRow = parsed.find((r: any) => r && r.id === "shared");
        // deno-lint-ignore no-explicit-any
        const jobsRow = parsed.find((r: any) => r && r.id === "jobs");
        // deno-lint-ignore no-explicit-any
        const notesRow = parsed.find((r: any) => r && r.id === "notes");
        // deno-lint-ignore no-explicit-any
        const scratchRow = parsed.find((r: any) => r && r.id === "scratch");
        mainData = sharedRow ? sharedRow.data : undefined;
        jobsData = jobsRow ? jobsRow.data : null;
        notesData = notesRow ? notesRow.data : null;
        scratchData = scratchRow ? scratchRow.data : null;
      }
      if (!mainData) return json({ error: "Backup file doesn't contain the expected data" }, 500);
      return json({ data: mainData, jobsData, notesData, scratchData });
    }

    return json({ error: "Unknown action" }, 400);
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
