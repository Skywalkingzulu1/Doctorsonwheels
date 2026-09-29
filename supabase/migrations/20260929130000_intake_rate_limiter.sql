-- Per-IP rate limiting for the public intake endpoint.
--
-- clinician-intake runs with verify_jwt = false, because applicants have not
-- signed in. An open write endpoint with no limiter is a spam target, and this
-- is the only thing standing between that and a full table.
--
-- Counter rows are written by a SECURITY DEFINER function so the Edge Function
-- never needs direct table access, and EXECUTE is revoked from anon and
-- authenticated so the browser cannot inflate or drain someone else's bucket.
-- Only the service role may call it.

create table if not exists public.intake_rate_limits (
  bucket       text                     not null,
  key          text                     not null,
  window_start timestamptz              not null,
  hits         integer                  not null default 0,
  constraint intake_rate_limits_pkey primary key (bucket, key, window_start)
);

create index if not exists idx_intake_rate_limits_sweep
  on public.intake_rate_limits (window_start);

alter table public.intake_rate_limits enable row level security;
revoke all on public.intake_rate_limits from anon, authenticated;

create or replace function public.intake_rate_limit_hit(
  p_bucket      text,
  p_key         text,
  p_window_secs integer,
  p_max         integer
)
returns table (hits integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_bucket is null or p_bucket = '' or p_key is null then
    raise exception 'invalid rate limit arguments';
  end if;

  -- Snap to the window so all callers in the same interval share a row.
  v_window := to_timestamp(
    floor(extract(epoch from now()) / greatest(p_window_secs, 1))
      * greatest(p_window_secs, 1)
  );

  insert into public.intake_rate_limits (bucket, key, window_start, hits)
  values (p_bucket, p_key, v_window, 1)
  on conflict (bucket, key, window_start)
    do update set hits = public.intake_rate_limits.hits + 1
  returning intake_rate_limits.hits into v_hits;

  -- Opportunistic sweep. Cheap enough to run on every call and keeps stale
  -- windows from accumulating without a scheduled job.
  delete from public.intake_rate_limits
   where window_start < now() - interval '1 day';

  return query select v_hits;
end;
$$;

revoke all on function public.intake_rate_limit_hit(text, text, integer, integer)
  from anon, authenticated;
