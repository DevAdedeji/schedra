import { useEnv } from '../config/env'
import { fetchWithTimeout } from './fetch'
import nodemailer from 'nodemailer'
import { logEvent } from '../observability/logger'

let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null

export interface EmailDetail {
  label: string
  value: string
  url?: string
}

export interface EmailBranding {
  name: string
  logoUrl?: string
  accentColor: string
  hideSchedraBranding: boolean
}

export interface Email {
  to: string
  subject: string
  preheader?: string
  heading: string
  body: string
  details?: EmailDetail[]
  action: { label: string, url: string }
  footer?: string
  branding?: EmailBranding
}

export class EmailDeliveryError extends Error {
  readonly permanent: boolean
  readonly statusCode?: number

  constructor(message: string, options: { permanent: boolean, statusCode?: number, cause?: unknown }) {
    super(message, { cause: options.cause })
    this.name = 'EmailDeliveryError'
    this.permanent = options.permanent
    this.statusCode = options.statusCode
  }
}

/** Recipient/message validation failures cannot succeed on a later retry. */
export function isPermanentEmailDeliveryError(error: unknown) {
  if (error instanceof EmailDeliveryError) return error.permanent
  if (!error || typeof error !== 'object') return false

  const providerError = error as { code?: unknown, responseCode?: unknown }
  const responseCode = Number(providerError.responseCode)
  return providerError.code === 'EENVELOPE'
    || (Number.isInteger(responseCode) && responseCode >= 500 && responseCode < 600)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\'': '&#39;',
    '"': '&quot;'
  })[character]!)
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function safeAccentColor(value?: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : '#FF5A2F'
}

function contrastColor(hex: string) {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
  return luminance > 0.58 ? '#1c1917' : '#ffffff'
}

function emailBrand(email: Email) {
  const name = email.branding?.name.trim() || 'schedra'
  const accentColor = safeAccentColor(email.branding?.accentColor)
  const logoUrl = email.branding?.logoUrl ? safeHttpUrl(email.branding.logoUrl) : undefined
  const mark = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="" width="36" height="36" style="display:block;max-width:120px;width:auto;height:36px;object-fit:contain">`
    : `<span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:${accentColor};border-radius:7px;color:${contrastColor(accentColor)};font-size:16px;font-weight:700">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`

  return { name, accentColor, mark }
}

function paragraphs(body: string) {
  return body
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p style="margin:12px 0 0;font-size:16px;line-height:1.65;color:#57534e">${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`)
    .join('')
}

function detailRows(details: EmailDetail[]) {
  return details.map(({ label, value, url }, index) => {
    const href = url ? safeHttpUrl(url) : undefined
    const renderedValue = href
      ? `<a href="${escapeHtml(href)}" style="color:#c2410c;text-decoration:underline;text-decoration-color:#fdba74;text-underline-offset:3px;word-break:break-word">${escapeHtml(value)}</a>`
      : escapeHtml(value)

    return `<tr>
      <td class="detail-label" style="padding:${index === 0 ? '0' : '14px 0 0'};width:112px;vertical-align:top;font-size:13px;line-height:1.5;font-weight:600;color:#78716c">${escapeHtml(label)}</td>
      <td class="detail-value" style="padding:${index === 0 ? '0' : '14px'} 0 0 18px;vertical-align:top;font-size:14px;line-height:1.5;font-weight:500;color:#1c1917">${renderedValue}</td>
    </tr>`
  }).join('')
}

export function renderEmailHtml(email: Email) {
  const preheader = email.preheader ?? email.body.split(/\n/)[0] ?? email.heading
  const actionUrl = safeHttpUrl(email.action.url)
  if (!actionUrl) throw new Error('Email action URL must use HTTP or HTTPS.')
  const brand = emailBrand(email)
  const poweredBy = !email.branding
    ? 'Sent by Schedra · Scheduling that works around you'
    : email.branding.hideSchedraBranding
      ? `Sent by ${escapeHtml(brand.name)}`
      : `Sent by ${escapeHtml(brand.name)} · Powered by Schedra`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(email.subject)}</title>
  <style>
    @media screen and (max-width:480px) {
      .email-shell { padding:20px 10px !important; }
      .email-card-padding { padding:28px 22px !important; }
      .detail-label, .detail-value { display:block !important; width:auto !important; padding-left:0 !important; }
      .detail-value { padding-top:3px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:1px">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#8199;&#65279;&#847;&zwnj;&nbsp;&#8199;&#65279;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#f5f5f4">
    <tr><td class="email-shell" align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
        <tr><td style="padding:0 4px 20px">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="vertical-align:middle">${brand.mark}</td>
            <td style="padding-left:10px;vertical-align:middle;font-size:17px;font-weight:700;letter-spacing:-0.03em;color:#1c1917">${escapeHtml(brand.name)}</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#fff;border:1px solid #e7e5e4;border-radius:16px;overflow:hidden">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td class="email-card-padding" style="padding:40px 40px 36px">
              <h1 style="margin:0;font-size:28px;line-height:1.25;letter-spacing:-0.035em;font-weight:700;color:#1c1917">${escapeHtml(email.heading)}</h1>
              ${paragraphs(email.body)}
              ${email.details?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:28px;padding:20px;background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px">${detailRows(email.details)}</table>` : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr>
                <td style="border-radius:10px;background:${brand.accentColor}">
                  <a href="${escapeHtml(actionUrl)}" style="display:inline-block;min-height:20px;padding:14px 22px;color:${contrastColor(brand.accentColor)};font-size:15px;line-height:20px;font-weight:650;text-decoration:none;border-radius:10px">${escapeHtml(email.action.label)}</a>
                </td>
              </tr></table>
              <p style="margin:28px 0 0;font-size:12px;line-height:1.6;color:#a8a29e">If the button does not work, copy and paste this link into your browser:<br><a href="${escapeHtml(actionUrl)}" style="color:#78716c;word-break:break-all;text-decoration:underline">${escapeHtml(actionUrl)}</a></p>
              ${email.footer ? `<p style="margin:28px 0 0;padding-top:24px;border-top:1px solid #e7e5e4;font-size:13px;line-height:1.65;color:#78716c">${escapeHtml(email.footer)}</p>` : ''}
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:20px 20px 0;font-size:12px;line-height:1.6;color:#a8a29e">${poweredBy}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function renderEmailText(email: Email) {
  const details = email.details?.length
    ? `\n\n${email.details.map(({ label, value }) => `${label}: ${value}`).join('\n')}`
    : ''
  const footer = email.footer ? `\n\n${email.footer}` : ''

  const brandName = email.branding?.name.trim() || 'Schedra'
  const signature = !email.branding
    ? 'Schedra'
    : email.branding.hideSchedraBranding
      ? brandName
      : `${brandName} · Powered by Schedra`
  return `${email.heading}\n\n${email.body}${details}\n\n${email.action.label}: ${email.action.url}${footer}\n\n— ${signature}`
}

export async function sendEmail(email: Email, idempotencyKey?: string) {
  const env = useEnv()

  if (env.emailDeliveryMode === 'log') {
    logEvent('info', 'email_delivery_skipped', {
      reason: 'No transactional email transport is configured'
    })
    return
  }

  const html = renderEmailHtml(email)
  const text = renderEmailText(email)

  if (env.emailDeliveryMode === 'smtp') {
    smtpTransport ??= nodemailer.createTransport(env.smtpUrl!)
    try {
      await smtpTransport.sendMail({
        from: env.emailFrom,
        to: email.to,
        subject: email.subject,
        html,
        text,
        headers: idempotencyKey ? { 'X-Schedra-Idempotency-Key': idempotencyKey } : undefined
      })
    } catch (error) {
      if (isPermanentEmailDeliveryError(error)) {
        throw new EmailDeliveryError('Email provider permanently rejected the recipient or message.', {
          permanent: true,
          cause: error
        })
      }
      throw error
    }
    return
  }

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.resendApiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({
      from: env.emailFrom,
      to: email.to,
      subject: email.subject,
      html,
      text
    })
  })

  if (!response.ok) {
    throw new EmailDeliveryError(`Email provider request failed (${response.status}).`, {
      // Resend uses 422 for an invalid recipient or invalid message payload.
      // Repeating the same request cannot repair user input.
      permanent: response.status === 422,
      statusCode: response.status
    })
  }
}
