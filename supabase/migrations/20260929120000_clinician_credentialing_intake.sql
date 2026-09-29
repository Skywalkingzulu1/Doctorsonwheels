-- US clinician credentialing intake.
--
-- Holds applications from /us-careers.html. These rows describe the APPLICANT,
-- so they are not patient data -- but a certificate of insurance and a state
-- licence are sensitive professional documents, so the table is closed by
-- default: RLS on, zero policies, no grants to anon or authenticated.
--
-- The only writer is the clinician-intake Edge Function, which holds the
-- service-role key. That is the point of the design -- an unauthenticated
-- applicant cannot write here directly, only through the function, which
-- validates, rate limits and records who called.

create table if not exists public.clinician_applications (
  id                          uuid primary key default gen_random_uuid(),
  name                        text        not null,
  email                       text        not null,
  phone                       text        not null,
  specialty                   text        not null,
  npi                         text        not null,
  license_state_primary       text        not null,
  license_states_additional   text,
  malpractice_coverage        text        not null,
  visits_per_week             text,
  posting_version             text        not null default '2026-09-29',
  notes                       text,

  -- Filled in by the Edge Function from the NPPES registry lookup. Note this
  -- confirms the NPI is registered and active; it does NOT bind the number to
  -- the person who typed it in.
  npi_verified                boolean     not null default false,
  npi_registry_name           text,
  npi_registry_status         text,
  npi_registry_taxonomy       text,
  npi_verified_at             timestamptz,
  npi_check_error             text,

  -- Object keys inside the clinician-credentials bucket. Paths only; the
  -- bucket is private and has no storage.objects policies, so these strings
  -- are useless to anyone outside the service role.
  coi_path                    text,
  coi_uploaded_at             timestamptz,
  license_doc_path            text,
  license_doc_uploaded_at     timestamptz,

  review_status               text        not null default 'pending',
  reviewed_at                 timestamptz,
  review_notes                text,

  source                      text        not null default 'us_careers_page',
  user_agent                  text,
  submitted_at                timestamptz not null default now(),
  created_at                  timestamptz not null default now(),

  constraint clinician_applications_npi_check
    check (npi ~ '^[0-9]{10}$'),

  -- 'approved' is only ever set by a human in credentialing. The intake
  -- function writes 'npi_failed' or 'awaiting_documents' and nothing else.
  constraint clinician_applications_review_status_check
    check (review_status in ('pending', 'npi_failed', 'awaiting_documents',
                             'in_review', 'approved', 'rejected'))
);

create index if not exists idx_clinician_applications_email
  on public.clinician_applications (lower(email));
create index if not exists idx_clinician_applications_npi
  on public.clinician_applications (npi);
create index if not exists idx_clinician_applications_status
  on public.clinician_applications (review_status, created_at desc);

-- One application per NPI per calendar day. This is the real duplicate guard;
-- the 24h lookup in the Edge Function is only a friendlier error message.
create unique index if not exists uniq_clinician_app_npi_day
  on public.clinician_applications (npi, ((created_at at time zone 'utc')::date));

alter table public.clinician_applications enable row level security;

-- Belt and braces: RLS with zero policies already denies everything, but an
-- explicit revoke means a later "enable all policies" sweep cannot quietly
-- expose this table.
revoke all on public.clinician_applications from anon, authenticated;

-- Private bucket for credentialing documents. No storage.objects policies are
-- created, so nothing in here is readable with a client key, and documents are
-- reached only through the service-role Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinician-credentials',
  'clinician-credentials',
  false,
  10485760,
  '{application/pdf,image/jpeg,image/png,image/webp}'
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
