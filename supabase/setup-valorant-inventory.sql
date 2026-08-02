-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query), same place
-- setup-egress-fix.sql was run. Adds the three RPC functions scripts/valorant-lib.mjs calls to
-- patch valorant.ownedSkins[label] (the "owned skins" check triggered by the Valorant tab's
-- "Check Owned Skins" button) without reading/writing the whole app_data row — same pattern and
-- same "id = 'shared'" row as the daily-store RPCs in setup-egress-fix.sql.

create or replace function valorant_set_owned_skins(p_label text, p_result jsonb)
returns void
language sql
as $$
  update app_data
  set data = jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{valorant}', coalesce(data->'valorant', '{}'::jsonb), true),
        array['valorant','ownedSkins', p_label],
        p_result,
        true
      ),
      updated_at = now()
  where id = 'shared';
$$;

create or replace function valorant_set_owned_skins_error(p_label text, p_message text)
returns void
language sql
as $$
  update app_data
  set data = jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{valorant}', coalesce(data->'valorant', '{}'::jsonb), true),
        array['valorant','ownedSkins', p_label],
        coalesce(data->'valorant'->'ownedSkins'->p_label, '{}'::jsonb) || jsonb_build_object('error', p_message),
        true
      ),
      updated_at = now()
  where id = 'shared';
$$;

create or replace function valorant_delete_owned_skins(p_label text)
returns void
language sql
as $$
  update app_data
  set data = data #- array['valorant','ownedSkins', p_label],
      updated_at = now()
  where id = 'shared';
$$;

-- No explicit GRANT needed — same reasoning as setup-egress-fix.sql: Postgres grants EXECUTE on
-- new functions to PUBLIC by default, and the existing "Anyone can read and write" RLS policy on
-- app_data covers the UPDATE inside since these run as SECURITY INVOKER (the default) under the
-- caller's (anon) role.
