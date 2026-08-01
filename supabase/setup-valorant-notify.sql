-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query), same place
-- setup-egress-fix.sql was run. Adds one read-only RPC so scripts/valorant-lib.mjs can fetch a
-- single tracked account's wishlist (for the wishlist-match push notification) without pulling
-- the whole app_data row. Same "id = 'shared'" row and SECURITY INVOKER default as the other
-- valorant RPCs in setup-egress-fix.sql — no extra GRANT needed, the existing "Anyone can read
-- and write" RLS policy on app_data already covers it.

create or replace function valorant_get_wishlist(p_label text)
returns jsonb
language sql
as $$
  select coalesce(data->'valorant'->'wishlist'->p_label, '[]'::jsonb)
  from app_data where id = 'shared';
$$;
