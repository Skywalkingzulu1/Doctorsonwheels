import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type WebhookPayload = {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: Record<string, unknown>
  old_record: Record<string, unknown> | null
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || Deno.env.get('Resend') || Deno.env.get('Resend ')
const TO_EMAIL = 'andilexmchunu@gmail.com'
const FROM_EMAIL = 'onboarding@resend.dev'

const SLACK_CLIENT_ID = '11588188943664.11555005281811'
const SLACK_CLIENT_SECRET = '15b870d34662fff4cab31734cbc0425f'

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url)

  // Handle OAuth installation flow (GET)
  if (req.method === 'GET') {
    const code = url.searchParams.get('code')
    const redirectUri = `${url.origin}${url.pathname}`

    if (!code) {
      // Redirect user to Slack authorization page
      const slackAuthUrl = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=incoming-webhook,chat:write,chat:write.public&redirect_uri=${encodeURIComponent(redirectUri)}`
      return Response.redirect(slackAuthUrl, 302)
    }

    // Exchange code for OAuth credentials
    try {
      const res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: SLACK_CLIENT_ID,
          client_secret: SLACK_CLIENT_SECRET,
          code: code,
          redirect_uri: redirectUri,
        }),
      })

      const oauthData = await res.json()
      if (!oauthData.ok) {
        return new Response(`Slack OAuth Error: ${oauthData.error}`, { status: 400 })
      }

      const webhookUrl = oauthData.incoming_webhook?.url
      const channel = oauthData.incoming_webhook?.channel

      if (!webhookUrl) {
        return new Response('No webhook URL returned from Slack', { status: 400 })
      }

      // Try storing it in database
      let dbSaved = false
      let dbErrorMsg = ''
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        if (supabaseUrl && supabaseServiceKey) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey)
          const { error } = await supabase.from('slack_settings').insert({
            webhook_url: webhookUrl,
            channel: channel,
          })
          if (!error) {
            dbSaved = true
          } else {
            dbErrorMsg = error.message
          }
        }
      } catch (err) {
        dbErrorMsg = err.message
      }

      // Return success page with instructions
      let html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Slack Integration Complete</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7f6; color: #2d3748; padding: 40px; }
            .card { background: white; max-width: 600px; margin: 0 auto; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); }
            h1 { color: #4a154b; font-size: 24px; margin-bottom: 20px; }
            p { line-height: 1.6; }
            code { background: #edf2f7; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 14px; word-break: break-all; }
            pre { background: #2d3748; color: #fff; padding: 15px; border-radius: 6px; overflow-x: auto; font-family: monospace; }
            .success-badge { display: inline-block; background-color: #c6f6d5; color: #22543d; padding: 4px 12px; border-radius: 9999px; font-weight: bold; margin-bottom: 20px; }
            .warning-badge { display: inline-block; background-color: #feebc8; color: #744210; padding: 4px 12px; border-radius: 9999px; font-weight: bold; margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Doctors on Wheels Slack Integration</h1>
      `

      if (dbSaved) {
        html += `
            <div class="success-badge">Success</div>
            <p>Your Slack application has been successfully authorized and integrated!</p>
            <p>Incoming webhook configuration has been saved to the database table <code>public.slack_settings</code>.</p>
            <p>Every time someone adds data to your database, a notification will be sent to the Slack channel: <strong>${channel}</strong>.</p>
        `
      } else {
        html += `
            <div class="warning-badge">Authorized (Action Needed)</div>
            <p>Your Slack application is authorized, but we couldn't write the configuration to your database table <code>public.slack_settings</code> (Error: ${dbErrorMsg || 'Table may not exist'}).</p>
            <p>To finalize the setup, please run the following SQL command in your <strong>Supabase SQL Editor</strong> to create the table, then install again:</p>
            <pre>CREATE TABLE IF NOT EXISTS public.slack_settings (
    id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    webhook_url text NOT NULL,
    channel text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);</pre>
            <p>Alternatively, you can manually set the webhook URL as a Supabase Secret by running the following command in your terminal:</p>
            <pre>supabase secrets set SLACK_WEBHOOK_URL="${webhookUrl}"</pre>
            <p>Or add a secret named <code>SLACK_WEBHOOK_URL</code> in your Supabase Dashboard under <strong>Settings &gt; API &gt; Secrets</strong>.</p>
        `
      }

      html += `
          </div>
        </body>
        </html>
      `

      return new Response(html, {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
      })

    } catch (error) {
      return new Response(`Failed to complete OAuth flow: ${error.message}`, { status: 500 })
    }
  }

  // Handle database triggers (POST)
  if (req.method === 'POST') {
    let payload: WebhookPayload
    try {
      payload = await req.json()
    } catch {
      return new Response('Invalid JSON payload', { status: 400 })
    }

    const table = payload.table ?? 'unknown'
    const record = payload.record ?? {}
    const schema = payload.schema ?? 'public'

    // Get Slack webhook URL from environment or database
    let slackWebhookUrl = Deno.env.get('SLACK_WEBHOOK_URL')

    if (!slackWebhookUrl) {
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        if (supabaseUrl && supabaseServiceKey) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey)
          const { data, error } = await supabase
            .from('slack_settings')
            .select('webhook_url')
            .order('created_at', { ascending: false })
            .limit(1)

          if (!error && data && data.length > 0) {
            slackWebhookUrl = data[0].webhook_url
          }
        }
      } catch (err) {
        console.error('Error fetching Slack settings from DB:', err)
      }
    }

    let slackError = null
    if (slackWebhookUrl) {
      try {
        // Send notification to Slack
        const slackMessage = {
          text: `🔔 *New database activity on ${schema}.${table}!*`,
          attachments: [
            {
              color: '#4a154b', // Slack aubergine color
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*Table:* \`${schema}.${table}\`\n*Action:* \`${payload.type}\``,
                  },
                },
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: `*Record Details:*\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``,
                  },
                },
              ],
            },
          ],
        }

        const slackRes = await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(slackMessage),
        })

        if (!slackRes.ok) {
          slackError = `Slack webhook returned status ${slackRes.status}`
        }
      } catch (err) {
        slackError = err.message
      }
    } else {
      console.warn('SLACK_WEBHOOK_URL not configured. Skipping Slack notification.')
      slackError = 'SLACK_WEBHOOK_URL not configured'
    }

    // Send email using Resend (existing logic)
    let emailError = null
    if (RESEND_API_KEY) {
      try {
        const subject = `New ${table} record (${payload.type})`
        const bodyJson = {
          type: payload.type,
          table: schema + '.' + table,
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

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          emailError = data ?? 'Resend request failed'
        }
      } catch (err) {
        emailError = err.message
      }
    } else {
      emailError = 'RESEND_API_KEY is required'
    }

    if (slackError && emailError) {
      return new Response(JSON.stringify({ error: { slack: slackError, email: emailError } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, slack: slackWebhookUrl ? 'sent' : 'skipped', email: RESEND_API_KEY ? 'sent' : 'skipped' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response('Method not allowed', { status: 405 })
}

Deno.serve(handler)
