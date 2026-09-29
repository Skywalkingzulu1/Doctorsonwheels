-- Parity correction for the Luhn pass.
--
-- The doubling pass runs left to right over a 14-character window, so the
-- rightmost payload character sits at position 14. Alternating from there
-- means EVEN positions are the doubled ones, not odd. Getting this backwards
-- rejects valid NPIs, which is the more expensive mistake of the two: it looks
-- like a database problem when it is a typo filter.
--
-- The parity is now derived from the position rather than hard-coded to a
-- parity literal, so the expression is self-evidently correct on inspection.

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
