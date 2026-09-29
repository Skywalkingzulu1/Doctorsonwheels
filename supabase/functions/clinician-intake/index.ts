import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

// US clinician intake for /us-careers.html.
//
// Deployed with verify_jwt = false on purpose: applicants are anonymous, they
// have not signed in, and requiring a session would mean a wall between a
// physician and applying. The data arriving here is applicant-supplied and is
// NOT protected health information -- it describes the applicant, and no
// patient data is reachable from this path. So an open endpoint is acceptable
// PROVIDED it cannot read or write anything else. That is what the design
// below enforces:
//
//   * The service-role key is used only inside this function and is never
//     returned to the caller. It is needed because clinician_applications has
//     RLS enabled with zero policies, so the anon key cannot write to it.
//   * The only table touched is clinician_applications; the only bucket is
//     clinician-credentials, which is private and has no storage.objects
//     policies at all. A stored certificate of insurance is therefore not
//     reachable by guessing a path -- the failure mode of the existing
//     waitlist flow, which pushes JSON to a public Cloudinary folder.
//   * The endpoint is rate limited per IP, because an open write endpoint with
//     no limiter is a spam target.
//
// What this function does NOT do, and must not be read as doing:
//   * It does not verify that the applicant is the NPI holder. NPPES confirms
//     an NPI is registered and active; it does not bind a number to a person.
//     Identity is confirmed later against a state licence and a certificate of
//     insurance naming the same individual. review_status is never set to
//     'approved' anywhere in this code.
//   * It does not verify malpractice coverage. The submitted value is
//     self-declared. Only the uploaded certificate proves it, and a human
//     reads it.
//
// Actions:
//   verify-npi  Check an NPI against NPPES. No write.
//   submit      Create the application row. NPI is looked up as part of it.
//   upload      Store one document, validated by file content.
//
// Why the upload is proxied rather than handed to the browser as a signed
// URL: the bucket has no storage.objects policies, so a signed URL still ends
// in an insert that RLS rejects. Loosening that would mean granting anon
// INSERT on the bucket, which would let anyone write objects under any other
// applicant's prefix. Proxying keeps the bucket fully closed and adds two
// checks a signed URL cannot do: the declared Content-Type is verified against
// the file's actual magic bytes, and size is enforced on real byte length
// rather than on a header the client controls.

const NPI_LOOKUP = 'https://npiregistry.cms.hhs.gov/api/?version=2.1'

const RATE_LIMIT = { windowSecs: 3600, maxSubmits: 5, maxUploads: 10 }

// Mirrors the bucket's file_size_limit. Checked here too, so an oversized
// file is rejected with a clear message rather than a generic storage error
// after the bytes have already crossed the network.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

// A declared Content-Type is attacker-controlled, so the file's own leading
// bytes decide whether it is accepted.
const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Uint8Array) => boolean }> = [
  { ext: 'pdf', mime: 'application/pdf', test: (b) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && String.fromCharCode(...b.slice(8, 12)) === 'WEBP' },
]

const MAX_TEXT = 2000

function corsHeaders(req: Request): Record<string, string> {
  // Only this site may call the function. No credentials are involved, so the
  // specific origin is echoed rather than '*'.
  const origin = req.headers.get('origin') ?? ''
  const allowed = /^https:\/\/(www\.)?docsonwheels\.co\.za$/.test(origin) ? origin : ''
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

function clientIp(req: Request): string {
  // Only used to bucket rate limits, never for authorization, so a spoofed
  // header can at worst move a caller into a different bucket.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip') ?? 'unknown'
}

function clean(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, max)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

const COVERAGE_VALUES = new Set([
  'occurrence',
  'occurrence_below',
  'claims_made',
  'claims_made_below',
  'employer_only',
  'none',
])

function validate(body: Record<string, unknown>): string | null {
  if (!clean(body.name, 200)) return 'name is required'
  if (!EMAIL_RE.test(clean(body.email, 320).toLowerCase())) {
    return 'a valid email address is required'
  }
  if (!clean(body.phone, 40)) return 'phone is required'
  if (!clean(body.specialty, 120)) return 'specialty is required'
  if (!clean(body.license_state_primary, 120)) return 'license state is required'
  if (!/^[0-9]{10}$/.test(clean(body.npi, 10))) return 'NPI must be 10 digits'
  if (!COVERAGE_VALUES.has(clean(body.malpractice_coverage, 40))) {
    return 'malpractice coverage selection is invalid'
  }
  return null
}

async function checkRateLimit(
  sb: ReturnType<typeof createClient>,
  bucket: string,
  key: string,
  max: number,
): Promise<boolean> {
  const { data, error } = await sb.rpc('intake_rate_limit_hit', {
    p_bucket: bucket,
    p_key: key,
    p_window_secs: RATE_LIMIT.windowSecs,
    p_max: max,
  })

  // Fail closed. An open write endpoint with a broken limiter is precisely the
  // case the limiter exists for, so refuse rather than write unmetered.
  if (error) {
    console.error('rate limit rpc failed:', error.message)
    return false
  }

  const rows = (data ?? []) as Array<{ hits: number }>
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return false
  return row.hits <= max
}

type NppesResult = {
  found: boolean
  name: string | null
  status: string | null
  taxonomy: string | null
  error: string | null
}

async function lookupNpi(npi: string): Promise<NppesResult> {
  const miss: NppesResult = { found: false, name: null, status: null, taxonomy: null, error: null }

  let url: URL
  try {
    url = new URL(NPI_LOOKUP)
    url.searchParams.set('number', npi)
  } catch {
    return { ...miss, error: 'could not build lookup url' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { ...miss, error: `registry returned ${res.status}` }

    const parsed = (await res.json()) as {
      results?: Array<{
        basic?: {
          first_name?: string
          last_name?: string
          middle_name?: string
          name_suffix?: string
          credential?: string
          status?: string
        }
        taxonomies?: Array<{ desc?: string; primary?: boolean }>
      }>
    }

    const first = parsed.results?.[0]
    if (!first) return miss

    const b = first.basic ?? {}
    const name = [b.first_name, b.middle_name, b.last_name, b.name_suffix]
      .filter(Boolean)
      .join(' ')
      .trim()

    const taxonomies = first.taxonomies ?? []
    const primary = taxonomies.find((t) => t.primary) ?? taxonomies[0]

    return {
      found: true,
      name: name || null,
      status: b.status ?? null,
      taxonomy: primary?.desc ?? null,
      error: null,
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ...miss,
      error: aborted ? 'registry lookup timed out' : 'registry lookup failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405)

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const ip = clientIp(req)
  const url = new URL(req.url)
  const action = clean(url.searchParams.get('action'), 40)

  try {
    // -----------------------------------------------------------------
    // verify-npi -- no write.
    // -----------------------------------------------------------------
    if (action === 'verify-npi') {
      const npi = clean(url.searchParams.get('npi'), 10)
      if (!/^[0-9]{10}$/.test(npi)) {
        return json(req, { valid: false, error: 'NPI must be 10 digits' }, 400)
      }

      if (!(await checkRateLimit(sb, 'verify', ip, 30))) {
        return json(req, { error: 'too many checks, try again later' }, 429)
      }

      // Cheap rejection first, so an obvious typo never costs a network call.
      const { data: luhnOk, error: luhnErr } = await sb.rpc('is_valid_npi', { candidate: npi })
      if (luhnErr) console.error('is_valid_npi failed:', luhnErr.message)

      if (luhnOk === false) {
        return json(req, {
          valid: false,
          checksum_ok: false,
          error: 'That NPI fails its checksum. Please check the digits.',
        })
      }

      const result = await lookupNpi(npi)
      return json(req, {
        valid: result.found,
        checksum_ok: true,
        registry_name: result.name,
        registry_status: result.status,
        registry_taxonomy: result.taxonomy,
        unavailable: result.error !== null,
        note: result.found
          ? 'Found in the NPPES registry. We still verify your identity and licence separately.'
          : result.error
            ? 'The NPPES registry could not be reached, so this could not be confirmed yet.'
            : 'That NPI is not active in the NPPES registry. You can still apply and we will follow up.',
      })
    }

    // -----------------------------------------------------------------
    // submit -- create the application row.
    // -----------------------------------------------------------------
    if (action === 'submit') {
      let body: Record<string, unknown>
      try {
        body = await req.json()
      } catch {
        return json(req, { error: 'body must be JSON' }, 400)
      }

      const problem = validate(body)
      if (problem) return json(req, { error: problem }, 400)

      if (!(await checkRateLimit(sb, 'submit', ip, RATE_LIMIT.maxSubmits))) {
        return json(req, { error: 'Too many applications from this network. Email us instead.' }, 429)
      }

      const npi = clean(body.npi, 10)
      const email = clean(body.email, 320).toLowerCase()

      // Re-checked server-side. The client result is a convenience, not a gate.
      const { data: luhnOk } = await sb.rpc('is_valid_npi', { candidate: npi })
      if (luhnOk === false) {
        return json(req, { error: 'That NPI fails its checksum. Please check the digits.' }, 400)
      }

      const registry = await lookupNpi(npi)

      const { data: existing } = await sb
        .from('clinician_applications')
        .select('id')
        .eq('npi', npi)
        .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .maybeSingle()

      if (existing) {
        return json(req, {
          error: 'We already have an application from this NPI today. Check your email, or contact us if that is wrong.',
        }, 409)
      }

      const { data: inserted, error: insertErr } = await sb
        .from('clinician_applications')
        .insert({
          name: clean(body.name, 200),
          email,
          phone: clean(body.phone, 40),
          specialty: clean(body.specialty, 120),
          npi,
          license_state_primary: clean(body.license_state_primary, 120),
          license_states_additional: clean(body.license_states_additional, 300) || null,
          malpractice_coverage: clean(body.malpractice_coverage, 40),
          visits_per_week: clean(body.visits_per_week, 60) || null,
          notes: clean(body.notes, MAX_TEXT) || null,
          posting_version: clean(body.posting_version, 20) || '2026-09-29',
          npi_verified: registry.found,
          npi_registry_name: registry.name,
          npi_registry_status: registry.status,
          npi_registry_taxonomy: registry.taxonomy,
          npi_verified_at: registry.found ? new Date().toISOString() : null,
          npi_check_error: registry.error,
          review_status: registry.found ? 'awaiting_documents' : 'npi_failed',
          source: 'us_careers_page',
          user_agent: clean(req.headers.get('user-agent'), 300) || null,
        })
        .select('id')
        .single()

      if (insertErr) {
        console.error('insert failed:', insertErr.message)
        return json(req, { error: 'Could not record your application. Please try again.' }, 500)
      }

      return json(req, {
        ok: true,
        application_id: inserted.id,
        npi_verified: registry.found,
        registry_name: registry.name,
        registry_status: registry.status,
        registry_taxonomy: registry.taxonomy,
        message: registry.found
          ? 'NPI found in the NPPES registry.'
          : 'Your NPI was not found in the NPPES registry. Your application is recorded and a credentialing specialist will follow up.',
      })
    }

    // -----------------------------------------------------------------
    // upload -- store a document.
    // -----------------------------------------------------------------
    if (action === 'upload') {
      const appId = clean(url.searchParams.get('application_id'), 64)
      const kind = clean(url.searchParams.get('doc_kind'), 20)

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
        return json(req, { error: 'invalid application id' }, 400)
      }
      if (kind !== 'coi' && kind !== 'license') {
        return json(req, { error: 'doc_kind must be coi or license' }, 400)
      }

      if (!(await checkRateLimit(sb, 'upload', ip, RATE_LIMIT.maxUploads))) {
        return json(req, { error: 'Too many uploads from this network.' }, 429)
      }

      const declared = Number(req.headers.get('content-length') ?? '0')
      if (declared > MAX_UPLOAD_BYTES) {
        return json(req, { error: 'File is larger than 10 MB.' }, 413)
      }

      const { data: app } = await sb
        .from('clinician_applications')
        .select('id, npi')
        .eq('id', appId)
        .maybeSingle()

      if (!app) return json(req, { error: 'application not found' }, 404)

      const bytes = new Uint8Array(await req.arrayBuffer())
      if (bytes.length === 0) return json(req, { error: 'the file was empty' }, 400)
      if (bytes.length > MAX_UPLOAD_BYTES) {
        return json(req, { error: 'File is larger than 10 MB.' }, 413)
      }

      const sig = SIGNATURES.find((s) => s.test(bytes))
      if (!sig) {
        return json(req, { error: 'Upload a real PDF, JPEG, PNG or WebP file.' }, 415)
      }

      // Path is derived server-side from the application id, so the client
      // cannot steer the write into another applicant's directory.
      const path = `${appId}/${kind}.${sig.ext}`

      const { error: upErr } = await sb.storage
        .from('clinician-credentials')
        .upload(path, bytes, { contentType: sig.mime, upsert: true })

      if (upErr) {
        console.error('upload failed:', upErr.message)
        return json(req, { error: 'Could not store the file. Please try again.' }, 500)
      }

      const now = new Date().toISOString()
      const { error: updErr } = await sb
        .from('clinician_applications')
        .update(
          kind === 'coi'
            ? { coi_path: path, coi_uploaded_at: now }
            : { license_doc_path: path, license_doc_uploaded_at: now },
        )
        .eq('id', appId)
      if (updErr) console.error('path record failed:', updErr.message)

      return json(req, { ok: true, path, size: bytes.length, content_type: sig.mime })
    }

    return json(req, { error: 'unknown action' }, 400)
  } catch (err) {
    console.error('unhandled error:', err)
    return json(req, { error: 'internal error' }, 500)
  }
})
