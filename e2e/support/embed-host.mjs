import { createServer } from 'node:http'

const schedraOrigin = process.env.SCHEDRA_ORIGIN || 'http://127.0.0.1:3102'

function page(kind) {
  const floating = kind === 'floating'
  const team = kind === 'team'
  const bookingUrl = team
    ? `${schedraOrigin}/team/embed-team/team-demo`
    : `${schedraOrigin}/embed-host/website-demo`
  const trigger = floating
    ? ''
    : `<button id="book-demo" type="button"
        data-schedra-embed="${bookingUrl}"
        data-schedra-theme="light"
        data-schedra-accent="#2563EB"
        data-schedra-name="Website Visitor"
        data-schedra-email="visitor@example.com">Book a demo</button>`
  const loaderAttributes = floating
    ? `data-schedra-floating="${bookingUrl}" data-schedra-label="Book now" data-schedra-theme="light" data-schedra-accent="#2563EB"`
    : ''

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Customer website</title>
      <style>
        body{margin:0;padding:48px;font-family:system-ui;background:#eef2ff;color:#172554}
        main{max-width:720px;margin:auto;padding:48px;border-radius:24px;background:white;box-shadow:0 24px 70px #1e3a8a22}
        button{border:0;border-radius:999px;padding:14px 22px;background:#2563eb;color:#fff;font:600 15px system-ui;cursor:pointer}
      </style>
    </head>
    <body>
      <main><h1>Acme consulting</h1><p>Book without leaving this website.</p>${trigger}</main>
      <script>
        window.embedEvents = [];
        ['open','ready','booking-completed','close','error'].forEach(function(type){
          window.addEventListener('schedra:' + type, function(event){ window.embedEvents.push({ type:type, detail:event.detail }); });
        });
      </script>
      <script async src="${schedraOrigin}/embed.js" ${loaderAttributes}></script>
    </body>
  </html>`
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('ok')
    return
  }

  const kind = request.url === '/floating' ? 'floating' : request.url === '/team' ? 'team' : 'personal'
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' ${schedraOrigin}; frame-src ${schedraOrigin}; style-src 'unsafe-inline'`
  })
  response.end(page(kind))
})

server.listen(3103, '127.0.0.1')

function shutdown() {
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
