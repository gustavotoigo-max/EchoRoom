// EchoRoom — botão flutuante nas páginas do YouTube.
// Aparece em vídeos (/watch, /shorts) e playlists (/playlist). Ao clicar:
// copia o link, pausa o vídeo desta aba e manda a música para o EchoRoom.
;(() => {
  if (window.__echoroomButton) return
  window.__echoroomButton = true

  const POS_KEY = 'echoroom.buttonTop'

  /** O que está aberto nesta aba: vídeo, short ou playlist. */
  function currentTarget() {
    const u = new URL(location.href)
    const title = readTitle()
    if (u.pathname === '/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') || '')) {
      const v = u.searchParams.get('v')
      const list = u.searchParams.get('list')
      // Manda só o vídeo; no site dá para adicionar a playlist inteira depois.
      const url = `https://www.youtube.com/watch?v=${v}` + (list ? `&list=${list}` : '')
      return { kind: 'video', url, title, id: v }
    }
    const shorts = u.pathname.match(/^\/shorts\/([\w-]{11})/)
    if (shorts) return { kind: 'video', url: `https://www.youtube.com/shorts/${shorts[1]}`, title, id: shorts[1] }
    if (u.pathname === '/playlist' && u.searchParams.get('list')) {
      const list = u.searchParams.get('list')
      return { kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}`, title, id: list }
    }
    return null
  }

  function readTitle() {
    const el =
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
      document.querySelector('h1.ytd-watch-metadata') ||
      document.querySelector('ytd-reel-video-renderer[is-active] h2') ||
      document.querySelector('yt-formatted-string.title.ytmusic-player-bar')
    const t = (el && el.textContent && el.textContent.trim()) || document.title.replace(/\s*-\s*YouTube( Music)?$/, '')
    return t.replace(/^\(\d+\)\s*/, '').slice(0, 200)
  }

  // ---- interface (Shadow DOM: o CSS do YouTube não interfere) -----------------

  const host = document.createElement('div')
  host.id = 'echoroom-floating'
  host.style.cssText = 'position:fixed;right:20px;z-index:2147483646;display:none;'
  const savedTop = Number(localStorage.getItem(POS_KEY))
  host.style.top = savedTop > 0 ? `${Math.min(savedTop, innerHeight - 60)}px` : 'auto'
  if (!(savedTop > 0)) host.style.bottom = '96px'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { display: flex; align-items: stretch; font: 600 13px/1 Roboto, Arial, sans-serif; }
      button { all: unset; box-sizing: border-box; cursor: pointer; }
      .send {
        display: flex; align-items: center; gap: 9px; height: 40px; padding: 0 14px 0 10px;
        background: #13242e; color: #dce8e6; border: 1px solid #24404c; border-right: 0;
        box-shadow: 0 6px 18px rgba(0,0,0,.35); transition: background .12s;
      }
      .send:hover { background: #1a2f3a; }
      .send:focus-visible, .close:focus-visible, .grip:focus-visible { outline: 2px solid #5aa3d6; outline-offset: 2px; }
      .send.ok { color: #55c9a2; }
      .send.err { color: #e0675e; }
      .label { white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
      .grip, .close {
        display: grid; place-items: center; width: 22px; height: 40px;
        background: #0e1a22; color: #5f7d83; border: 1px solid #24404c; box-shadow: 0 6px 18px rgba(0,0,0,.35);
      }
      .grip { cursor: ns-resize; border-right: 0; font-size: 12px; letter-spacing: -2px; }
      .close { font-size: 16px; }
      .grip:hover, .close:hover { color: #dce8e6; }
    </style>
    <div class="wrap">
      <button class="grip" title="Arrastar para cima ou para baixo" aria-label="Mover botão">⋮⋮</button>
      <button class="send" title="">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="5" y="9" width="14" height="14" fill="none" stroke="#2c6e8f" stroke-width="2.5"/>
          <rect x="11" y="9" width="14" height="14" fill="#3fb58e"/>
        </svg>
        <span class="label">Tocar no EchoRoom</span>
      </button>
      <button class="close" title="Esconder nesta aba" aria-label="Esconder botão do EchoRoom">×</button>
    </div>`
  document.documentElement.appendChild(host)

  const sendBtn = root.querySelector('.send')
  const label = root.querySelector('.label')
  const closeBtn = root.querySelector('.close')
  const grip = root.querySelector('.grip')
  let hidden = false
  let busy = false
  let resetTimer = null

  function setLabel(text, cls) {
    label.textContent = text
    sendBtn.classList.remove('ok', 'err')
    if (cls) sendBtn.classList.add(cls)
  }

  function refresh() {
    const t = hidden ? null : currentTarget()
    host.style.display = t ? 'block' : 'none'
    if (t && !busy) {
      setLabel(t.kind === 'playlist' ? 'Tocar playlist no EchoRoom' : 'Tocar no EchoRoom')
      sendBtn.title = `Enviar para a sua sala: ${t.title}`
    }
  }

  sendBtn.addEventListener('click', async () => {
    const t = currentTarget()
    if (!t || busy) return
    busy = true
    clearTimeout(resetTimer)
    setLabel('Enviando…')
    // Copia o link (útil para colar em outro lugar).
    try {
      await navigator.clipboard.writeText(t.url)
    } catch {
      /* sem permissão de área de transferência: segue */
    }
    // Evita ouvir em dobro: pausa o vídeo desta aba (e segura a pausa).
    pauseHere()
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ECHOROOM_SEND', url: t.url, title: t.title })
      if (res && res.ok) setLabel('Enviado para a sala ✓', 'ok')
      else setLabel('Não foi possível enviar', 'err')
    } catch {
      setLabel('Recarregue a página e tente de novo', 'err')
    }
    busy = false
    resetTimer = setTimeout(refresh, 2500)
  })

  /**
   * Pausa o YouTube desta aba. Por alguns segundos, se o player tentar voltar
   * a tocar sozinho (troca de foco, autoplay, próxima da fila), pausa de novo.
   */
  let holdUntil = 0
  function pauseVideos() {
    document.querySelectorAll('video').forEach((v) => {
      try {
        if (!v.paused) v.pause()
      } catch {
        /* ignora */
      }
    })
  }
  function pauseHere() {
    holdUntil = Date.now() + 8000
    pauseVideos()
  }
  document.addEventListener(
    'play',
    (e) => {
      if (Date.now() < holdUntil && e.target instanceof HTMLVideoElement) e.target.pause()
    },
    true,
  )
  // O usuário pode dar play de novo de propósito: libera a pausa ao clicar no player.
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('#movie_player, ytmusic-player, video')) holdUntil = 0
  }, true)
  document.addEventListener('keydown', () => { holdUntil = 0 }, true)

  closeBtn.addEventListener('click', () => {
    hidden = true
    refresh()
  })

  // Arrastar na vertical (posição fica salva).
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startTop = host.getBoundingClientRect().top
    const move = (ev) => {
      const top = Math.max(8, Math.min(innerHeight - 52, startTop + ev.clientY - startY))
      host.style.top = `${top}px`
      host.style.bottom = 'auto'
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      localStorage.setItem(POS_KEY, String(parseInt(host.style.top, 10) || 0))
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
  })

  // O YouTube é uma SPA: acompanha trocas de página.
  let lastHref = ''
  const check = () => {
    if (location.href !== lastHref) {
      lastHref = location.href
      hidden = false
    }
    refresh()
  }
  window.addEventListener('yt-navigate-finish', check)
  window.addEventListener('popstate', check)
  setInterval(check, 1500)
  check()
})()
