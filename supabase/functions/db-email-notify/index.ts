import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: Record<string, unknown>
  old_record: Record<string, unknown> | null
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || Deno.env.get('Resend') || Deno.env.get('Resend ')
if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is required')

const TO_EMAIL = 'andilexmchunu@gmail.com'
const FROM_EMAIL = 'onboarding@resend.dev'

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON payload', { status: 400 })
  }

  const table = payload.table ?? 'unknown'
  const record = payload.record ?? {}

  // Best-effort subject/body; keep it generic since we don’t know all columns for each table.
  const subject = `New ${table} record (${payload.type})`
  const bodyJson = {
    type: payload.type,
    table: payload.schema + '.' + table,
    record,
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject,
      text: `A new record was inserted.\n\n${JSON.stringify(bodyJson, null, 2)}`,
    }),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    return new Response(JSON.stringify({ error: data ?? 'Resend request failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(handler)
