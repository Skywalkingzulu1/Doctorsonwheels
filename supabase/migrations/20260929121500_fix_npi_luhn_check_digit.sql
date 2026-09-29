-- Luhn check for NPI, using the correct NPI prefix.
--
-- The NPI check digit is computed over '80840' + the first 9 digits of the
-- NPI, not over the bare 10 digits. Running plain Luhn over the 10 digits
-- accepts a large share of numbers that are not real NPIs, so this is only a
-- cheap typo filter -- NPPES remains the authority.
--
-- Kept executable by anon/authenticated on purpose: it is IMMUTABLE, touches
-- no table, and returns nothing but a boolean, so exposing it leaks nothing
-- and lets the Edge Function do the fast local rejection.

create or replace function public.is_valid_npi(candidate text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select
    candidate is not null
    and candidate ~ '^[0-9]{10}$'
    and (
      select (
        with prefix as (
          select '80840' || left(candidate, 9) as s
        ),
        digits as (
          select
            substring(s from i for 1)::int as d,
            -- 14-character window; positions 14, 12, 10, ... 2 are doubled.
            (i % 2) = 0 as double_it
          from prefix, generate_series(1, 14) as i
        ),
        summed as (
          select sum(
            case
              when double_it then case when d * 2 > 9 then d * 2 - 9 else d * 2 end
              else d
            end
          ) as total
          from digits
        )
        select ((10 - (total % 10)) % 10) = substring(candidate from 10 for 1)::int
        from summed
      )
    );
$$;
