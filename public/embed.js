(function () {
  'use strict'

  if (window.SchedraEmbed && window.SchedraEmbed.version) return

  var currentScript = document.currentScript
  var scriptOrigin = currentScript && currentScript.src
    ? new URL(currentScript.src, window.location.href).origin
    : 'https://schedra.xyz'
  var active = null
  var previousOverflow = ''
  var previousPaddingRight = ''

  function validAccent(value) {
    var normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
    return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : ''
  }

  function theme(value) {
    if (value === 'light' || value === 'dark') return value
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function embedPath(value) {
    var bookingUrl = new URL(value, scriptOrigin)
    if (bookingUrl.origin !== scriptOrigin) {
      throw new Error('The booking link must use the same Schedra origin as embed.js.')
    }

    var parts = bookingUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parts[0] === 'team' && parts.length === 3) {
      return '/embed/team/' + encodeURIComponent(parts[1]) + '/' + encodeURIComponent(parts[2])
    }
    if (parts.length === 2) {
      return '/embed/personal/' + encodeURIComponent(parts[0]) + '/' + encodeURIComponent(parts[1])
    }
    throw new Error('Use a personal or team event-type booking link.')
  }

  function dispatch(type, detail) {
    window.dispatchEvent(new CustomEvent('schedra:' + type, { detail: detail || {} }))
  }

  function lockPage() {
    previousOverflow = document.documentElement.style.overflow
    previousPaddingRight = document.documentElement.style.paddingRight
    var scrollbar = window.innerWidth - document.documentElement.clientWidth
    document.documentElement.style.overflow = 'hidden'
    if (scrollbar > 0) document.documentElement.style.paddingRight = scrollbar + 'px'
  }

  function unlockPage() {
    document.documentElement.style.overflow = previousOverflow
    document.documentElement.style.paddingRight = previousPaddingRight
  }

  function close(reason) {
    if (!active) return
    var state = active
    active = null
    window.removeEventListener('message', state.onMessage)
    document.removeEventListener('keydown', state.onKeydown, true)
    window.clearTimeout(state.readyTimer)
    unlockPage()
    state.host.remove()
    if (state.previousFocus && typeof state.previousFocus.focus === 'function') {
      state.previousFocus.focus({ preventScroll: true })
    }
    dispatch('close', { reason: reason || 'api' })
  }

  function open(options) {
    options = options || {}
    var bookingUrl = options.bookingUrl || options.url
    if (!bookingUrl) throw new Error('SchedraEmbed.open requires a bookingUrl.')
    close('replaced')

    var path = embedPath(bookingUrl)
    var accent = validAccent(options.accent)
    var resolvedTheme = theme(options.theme)
    var query = new URLSearchParams({
      parentOrigin: window.location.origin,
      theme: resolvedTheme,
      source: 'embed',
      referrer: window.location.hostname
    })
    var parentQuery = new URL(window.location.href).searchParams
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (key) {
      var value = parentQuery.get(key)
      if (value) query.set(key, value.slice(0, 200))
    })
    if (accent) query.set('accent', accent)
    if (options.name) query.set('name', String(options.name).slice(0, 120))
    if (options.email) query.set('email', String(options.email).slice(0, 320))

    var host = document.createElement('div')
    host.setAttribute('data-schedra-overlay', '')
    var shadow = host.attachShadow({ mode: 'open' })
    var style = document.createElement('style')
    style.textContent = [
      ':host{all:initial;position:fixed;inset:0;z-index:2147483000;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '*,*::before,*::after{box-sizing:border-box}',
      '.backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(10,9,8,.68);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}',
      '.dialog{position:relative;width:min(1040px,100%);height:min(900px,92dvh);overflow:hidden;border:1px solid rgba(255,255,255,.16);border-radius:20px;background:#f5f4f2;box-shadow:0 32px 100px rgba(0,0,0,.34)}',
      'iframe{display:block;width:100%;height:100%;border:0;background:#f5f4f2}',
      '.close{position:absolute;top:12px;right:12px;z-index:3;display:grid;width:38px;height:38px;padding:0;place-items:center;border:1px solid rgba(120,113,108,.24);border-radius:999px;background:rgba(255,255,255,.94);color:#292524;box-shadow:0 4px 18px rgba(0,0,0,.12);cursor:pointer}',
      '.close:hover{background:#fff}.close:focus-visible{outline:3px solid ' + (accent || '#FF3D00') + ';outline-offset:2px}',
      '.close svg{width:18px;height:18px}',
      '.loading{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;background:#f5f4f2;color:#78716c;font-size:14px;text-align:center;transition:opacity .18s ease}',
      '.loading-row{display:flex;align-items:center;justify-content:center;gap:10px}',
      '.loading[data-ready=true]{pointer-events:none;opacity:0}',
      '.spinner{width:18px;height:18px;border:2px solid #d6d3d1;border-top-color:' + (accent || '#FF3D00') + ';border-radius:50%;animation:spin .75s linear infinite}',
      '.retry{display:none;min-height:36px;padding:8px 14px;border:1px solid #d6d3d1;border-radius:9px;background:#fff;color:#292524;font:600 13px/1 system-ui,-apple-system,sans-serif;cursor:pointer}',
      '.loading[data-error=true] .spinner{display:none}.loading[data-error=true] .retry{display:inline-flex;align-items:center}',
      '@keyframes spin{to{transform:rotate(360deg)}}',
      '@media(max-width:640px){.backdrop{padding:0}.dialog{width:100%;height:100dvh;border:0;border-radius:0}.close{top:max(10px,env(safe-area-inset-top));right:10px}}',
      '@media(prefers-reduced-motion:reduce){.spinner{animation-duration:1.5s}.loading{transition:none}}'
    ].join('')

    var backdrop = document.createElement('div')
    backdrop.className = 'backdrop'
    var dialog = document.createElement('div')
    dialog.className = 'dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-label', options.title || 'Book a meeting')

    var loading = document.createElement('div')
    loading.className = 'loading'
    loading.setAttribute('role', 'status')
    var spinner = document.createElement('span')
    spinner.className = 'spinner'
    spinner.setAttribute('aria-hidden', 'true')
    var loadingText = document.createElement('span')
    loadingText.textContent = 'Loading available times…'
    var loadingRow = document.createElement('div')
    loadingRow.className = 'loading-row'
    loadingRow.append(spinner, loadingText)
    var retryButton = document.createElement('button')
    retryButton.type = 'button'
    retryButton.className = 'retry'
    retryButton.textContent = 'Try again'
    loading.append(loadingRow, retryButton)

    var frame = document.createElement('iframe')
    frame.title = options.title || 'Schedra booking'
    frame.src = scriptOrigin + path + '?' + query.toString()
    frame.referrerPolicy = 'no-referrer'
    frame.setAttribute('allow', 'clipboard-write')
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox')

    var closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'close'
    closeButton.setAttribute('aria-label', 'Close booking')
    closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    closeButton.addEventListener('click', function () { close('button') })
    backdrop.addEventListener('click', function (event) {
      if (event.target === backdrop) close('backdrop')
    })

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close('escape')
        return
      }
      if (event.key !== 'Tab') return
      var focusables = loading.getAttribute('data-error') === 'true'
        ? [closeButton, retryButton]
        : [closeButton, frame]
      var index = focusables.indexOf(shadow.activeElement)
      if (event.shiftKey && index <= 0) {
        event.preventDefault()
        frame.focus()
      } else if (!event.shiftKey && index === focusables.length - 1) {
        event.preventDefault()
        closeButton.focus()
      }
    }

    function onMessage(event) {
      if (event.origin !== scriptOrigin || event.source !== frame.contentWindow) return
      var message = event.data
      if (!message || message.source !== 'schedra-embed' || message.version !== 1) return
      if (message.type === 'ready') {
        window.clearTimeout(active && active.readyTimer)
        loading.removeAttribute('data-error')
        loading.setAttribute('data-ready', 'true')
        dispatch('ready')
      } else if (message.type === 'booking.completed') {
        dispatch('booking-completed', message.payload)
      } else if (message.type === 'close') {
        close('embed')
      }
    }

    function showLoadError() {
      if (!active || active.frame !== frame || loading.getAttribute('data-ready') === 'true') return
      loading.setAttribute('data-error', 'true')
      loadingText.textContent = 'The booking page did not load. Check your connection and try again.'
      retryButton.focus()
      dispatch('error', { message: 'The booking page did not load.' })
    }

    function armReadyTimeout() {
      window.clearTimeout(active && active.readyTimer)
      loading.removeAttribute('data-ready')
      loading.removeAttribute('data-error')
      loadingText.textContent = 'Loading available times…'
      var timer = window.setTimeout(showLoadError, 15000)
      if (active) active.readyTimer = timer
    }

    retryButton.addEventListener('click', function () {
      var retryUrl = new URL(frame.src)
      retryUrl.searchParams.set('_retry', Date.now().toString())
      frame.src = retryUrl.toString()
      armReadyTimeout()
      frame.focus()
    })
    frame.addEventListener('error', showLoadError)

    dialog.append(loading, frame, closeButton)
    backdrop.append(dialog)
    shadow.append(style, backdrop)
    document.body.append(host)

    active = {
      host: host,
      frame: frame,
      previousFocus: document.activeElement,
      onMessage: onMessage,
      onKeydown: onKeydown,
      readyTimer: 0
    }
    window.addEventListener('message', onMessage)
    document.addEventListener('keydown', onKeydown, true)
    lockPage()
    armReadyTimeout()
    closeButton.focus()
    dispatch('open', { bookingUrl: bookingUrl })
    return { close: close }
  }

  function optionsFrom(element) {
    return {
      bookingUrl: element.getAttribute('data-schedra-embed'),
      theme: element.getAttribute('data-schedra-theme') || 'auto',
      accent: element.getAttribute('data-schedra-accent') || '',
      name: element.getAttribute('data-schedra-name') || '',
      email: element.getAttribute('data-schedra-email') || '',
      title: element.getAttribute('data-schedra-title') || 'Book a meeting'
    }
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest('[data-schedra-embed]') : null
    if (!trigger || trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') return
    event.preventDefault()
    try {
      open(optionsFrom(trigger))
    } catch (error) {
      dispatch('error', { message: error instanceof Error ? error.message : 'Could not open booking.' })
    }
  })

  function addFloatingButton(script) {
    var url = script && script.getAttribute('data-schedra-floating')
    if (!url) return
    var button = document.createElement('button')
    button.type = 'button'
    button.textContent = script.getAttribute('data-schedra-label') || 'Book a meeting'
    button.setAttribute('data-schedra-embed', url)
    button.setAttribute('data-schedra-theme', script.getAttribute('data-schedra-theme') || 'auto')
    button.setAttribute('data-schedra-accent', script.getAttribute('data-schedra-accent') || '#FF3D00')
    button.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147482000;border:0;border-radius:999px;padding:13px 20px;background:' + (validAccent(script.getAttribute('data-schedra-accent')) || '#FF3D00') + ';color:white;font:600 14px/1 system-ui,-apple-system,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.22);cursor:pointer'
    document.body.append(button)
  }

  window.SchedraEmbed = { version: '1.0.0', open: open, close: close }
  window.Schedra = window.Schedra || window.SchedraEmbed

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { addFloatingButton(currentScript) }, { once: true })
  } else {
    addFloatingButton(currentScript)
  }
})()
