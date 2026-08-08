-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).
-- It turns on live cross-device sync for the shared app_data row (see js/realtime.js).
--
-- Without this, js/realtime.js still loads and the app works exactly as before — the channel
-- just never reaches SUBSCRIBED, and you get a one-time console warning pointing back here.
-- Nothing else in the app depends on it.

-- ============================================================
-- Publish app_data changes over Realtime
-- ============================================================

-- supabase_realtime is the publication Supabase's Realtime server reads from; a table only
-- emits postgres_changes events once it's a member. Adding a table that's already there is an
-- error rather than a no-op, hence the guard — this file is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_data'
  ) then
    alter publication supabase_realtime add table app_data;
  end if;
end $$;

-- No RLS change is needed. Postgres Changes authorizes each subscriber by re-checking the table's
-- SELECT policy as that subscriber, and app_data's existing "Anyone can read and write" policy
-- (for all using (true) with check (true) — see the comment at the top of js/persistence.js)
-- already covers anon. Realtime therefore inherits exactly the same "no login, anyone with the
-- link" trade-off the rest of this app is built on: it is a live feed of the shared row, so
-- treat it as no more private than the row itself.

-- Optional. REPLICA IDENTITY DEFAULT (the default) means the `old` half of an UPDATE event only
-- carries the primary key. js/realtime.js only ever reads `payload.new`, so DEFAULT is what we
-- want: switching to FULL would double the WAL volume for this table and push the *previous*
-- copy of the whole blob over the wire on every save, for data nothing reads.
--   alter table app_data replica identity full;   -- <- deliberately NOT enabled

-- ============================================================
-- Verify
-- ============================================================
-- Should return one row:
--   select schemaname, tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and tablename = 'app_data';
-- The dashboard equivalent is Database > Replication > supabase_realtime.
