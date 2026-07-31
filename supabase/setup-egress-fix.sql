-- Run this whole file once in the Supabase SQL editor (Project > SQL Editor > New query).
-- It's the two pieces needed for the egress fix: an "icons" Storage bucket for goal/finance
-- images (js/core.js), and three RPC functions so the Valorant store-check scripts
-- (scripts/valorant-lib.mjs) can patch one field without reading the whole app_data row.
-- Both assume the same "no login, anyone can read/write" model already used for app_data
-- (see the comment at the top of js/persistence.js).

-- ============================================================
-- 1. "icons" Storage bucket — goal/finance icon uploads
-- ============================================================

insert into storage.buckets (id, name, public)
values ('icons', 'icons', true)
on conflict (id) do nothing;

create policy "Anyone can read icons"
on storage.objects for select
using (bucket_id = 'icons');

create policy "Anyone can upload icons"
on storage.objects for insert
with check (bucket_id = 'icons');

create policy "Anyone can update icons"
on storage.objects for update
using (bucket_id = 'icons');

create policy "Anyone can delete icons"
on storage.objects for delete
using (bucket_id = 'icons');

-- ============================================================
-- 2. Valorant daily-store RPCs — patch app_data without reading it first
-- ============================================================

create or replace function valorant_set_daily_store(p_label text, p_result jsonb)
returns void
language sql
as $$
  update app_data
  set data = jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{valorant}', coalesce(data->'valorant', '{}'::jsonb), true),
        array['valorant','dailyStores', p_label],
        p_result,
        true
      ),
      updated_at = now()
  where id = 'shared';
$$;

create or replace function valorant_set_daily_store_error(p_label text, p_message text)
returns void
language sql
as $$
  update app_data
  set data = jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{valorant}', coalesce(data->'valorant', '{}'::jsonb), true),
        array['valorant','dailyStores', p_label],
        coalesce(data->'valorant'->'dailyStores'->p_label, '{}'::jsonb) || jsonb_build_object('error', p_message),
        true
      ),
      updated_at = now()
  where id = 'shared';
$$;

create or replace function valorant_delete_daily_store(p_label text)
returns void
language sql
as $$
  update app_data
  set data = data #- array['valorant','dailyStores', p_label],
      updated_at = now()
  where id = 'shared';
$$;

-- No explicit GRANT needed — Postgres grants EXECUTE on new functions to PUBLIC by default,
-- and the existing "Anyone can read and write" RLS policy on app_data covers the UPDATE inside
-- since these run as SECURITY INVOKER (the default) under the caller's (anon) role.

-- ============================================================
-- 3. Optional: immediately purge the old AI avatar image from the row
--    (otherwise it only disappears the next time the app calls save())
-- ============================================================

-- update app_data set data = data #- '{profile,avatarImage}' where id = 'shared';
