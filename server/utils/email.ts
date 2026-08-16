import { useEnv } from './env'

interface Email {
  to: string
  subject: string
  heading: string
  body: string
  action: { label: string, url: string }
  footer?: string
}

function render({ heading, body, action, footer }: Omit<Email, 'to' | 'subject'>) {
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#faf9f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:12px">
    <tr><td style="padding:32px">
      <div style="font-size:15px;font-weight:600;letter-spacing:-0.03em;color:#1c1917">schedra</div>
      <h1 style="margin:24px 0 0;font-size:24px;line-height:1.25;font-weight:600;color:#1c1917">${heading}</h1>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#57534e">${body}</p>
      <a href="${action.url}" style="display:inline-block;margin:28px 0 0;padding:12px 24px;background:#FF3D00;color:#fff;font-size:15px;font-weight:500;text-decoration:none;border-radius:999px">${action.label}</a>
      <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#a8a29e">Or paste this into your browser:<br><span style="color:#78716c;word-break:break-all">${action.url}</span></p>
      ${footer ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e7e5e4;font-size:13px;line-height:1.6;color:#a8a29e">${footer}</p>` : ''}
    </td></tr>
  </table>
</body></html>`
}

export async function sendEmail(email: Email) {
  const env = useEnv()

  if (!env.resendApiKey) {
    console.info(
      `\n─── email not sent (RESEND_API_KEY unset) ───\n`
      + `  to:      ${email.to}\n`
      + `  subject: ${email.subject}\n`
      + `  link:    ${email.action.url}\n`
      + `────────────────────────────────────────────\n`
    )
    return
  }

  await $fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.resendApiKey}` },
    body: {
      from: env.emailFrom,
      to: email.to,
      subject: email.subject,
      html: render(email)
    }
  })
}
