// EchoRoom — botão flutuante nas páginas do YouTube.
// Aparece em vídeos (/watch, /shorts) e playlists (/playlist).
// - Clique no botão: copia o link, pausa o vídeo desta aba e põe na fila da sala.
// - Setinha ao lado: abre as playlists pessoais para salvar a música numa delas.
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
      * { box-sizing: border-box; }
      .wrap { position: relative; display: flex; align-items: stretch; font: 600 13px/1.2 Inter, Roboto, Arial, sans-serif; color: #ecebf7;
        filter: drop-shadow(0 8px 22px rgba(0,0,0,.45)); }
      button { all: unset; box-sizing: border-box; cursor: pointer; }
      .bar { display: flex; align-items: stretch; background: #10111a; border: 1px solid #2c2e45; position: relative; }
      .bar::before { content: ''; position: absolute; left: -1px; right: -1px; top: -1px; height: 2px;
        background: linear-gradient(90deg, #8b5cff 0%, #4c8dff 55%, #2fe0c4 100%); }
      .send { display: flex; align-items: center; gap: 9px; height: 42px; padding: 0 14px 0 10px; transition: background .12s; }
      .send:hover, .more:hover, .more[aria-expanded="true"] { background: #1e1f30; }
      .send.ok .label { color: #2fe0c4; }
      .send.err .label { color: #ff5c7a; }
      .label { white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
      .more { display: grid; place-items: center; width: 34px; border-left: 1px solid #2c2e45; color: #a3a4c2; }
      .more svg { transition: transform .15s; }
      .more[aria-expanded="true"] svg { transform: rotate(180deg); color: #ecebf7; }
      .grip, .close { display: grid; place-items: center; width: 22px; color: #6a6c8c; background: #0a0b11; border: 1px solid #2c2e45; }
      .grip { cursor: ns-resize; border-right: 0; font-size: 12px; letter-spacing: -2px; }
      .close { border-left: 0; font-size: 16px; }
      .grip:hover, .close:hover { color: #ecebf7; }
      button:focus-visible, input:focus-visible { outline: 2px solid #9479ff; outline-offset: 2px; }

      .menu { position: absolute; right: 22px; bottom: calc(100% + 8px); width: 290px; max-height: 360px; display: none; flex-direction: column;
        background: #07080c; border: 1px solid #2c2e45; }
      .menu.open { display: flex; }
      .menu.below { bottom: auto; top: calc(100% + 8px); }
      .menu header { padding: 10px 12px 8px; color: #a3a4c2; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
        border-bottom: 1px solid #1b1c2a; display: flex; justify-content: space-between; gap: 8px; }
      .menu header span:last-child { text-transform: none; letter-spacing: 0; font-weight: 600; color: #6a6c8c; }
      .list { overflow-y: auto; padding: 4px; }
      .item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; }
      .item:hover:not([aria-disabled="true"]) { background: #7c5cff; }
      .item:hover:not([aria-disabled="true"]) small { color: #e6e0ff; }
      .item b { flex: none; width: 26px; height: 26px; display: grid; place-items: center; color: #fff;
        background: linear-gradient(135deg, #ff5c7a, #8b5cff); font-size: 12px; }
      .item span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .item small { color: #6a6c8c; font-size: 11px; font-weight: 500; }
      .item.queue b { background: linear-gradient(135deg, #8b5cff, #4c8dff); }
      .sep { height: 1px; margin: 4px 6px; background: #1b1c2a; }
      .note { padding: 10px 12px; color: #a3a4c2; font-weight: 500; line-height: 1.4; }
      .note button { color: #9479ff; text-decoration: underline; }
      .new { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #1b1c2a; }
      .new input { flex: 1; min-width: 0; height: 32px; padding: 0 10px; background: #0a0b11; border: 1px solid #2c2e45; color: #ecebf7;
        font: 500 13px Inter, Roboto, Arial, sans-serif; outline: none; }
      .new input:focus { border-color: #7c5cff; }
      .new button { padding: 0 12px; height: 32px; display: grid; place-items: center; background: #7c5cff; color: #fff; }
      .new button[disabled] { opacity: .5; cursor: default; }
      .loading { padding: 12px; color: #6a6c8c; font-weight: 500; }
    </style>
    <div class="wrap">
      <button class="grip" title="Arrastar para cima ou para baixo" aria-label="Mover botão">⋮⋮</button>
      <div class="bar">
        <button class="send" title="">
          <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
            <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cff"/><stop offset=".55" stop-color="#4c8dff"/><stop offset="1" stop-color="#2fe0c4"/></linearGradient></defs>
            <rect width="32" height="32" fill="url(#g)"/><circle cx="9" cy="16" r="3.2" fill="#fff"/>
            <path d="M14 10a7 7 0 0 1 0 12" fill="none" stroke="#fff" stroke-width="2.6"/>
            <path d="M18.5 6a12 12 0 0 1 0 20" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.6"/>
          </svg>
          <span class="label">Tocar no EchoRoom</span>
        </button>
        <button class="more" title="Salvar numa playlist" aria-label="Salvar numa playlist" aria-haspopup="menu" aria-expanded="false">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
        </button>
      </div>
      <button class="close" title="Esconder nesta aba" aria-label="Esconder botão do EchoRoom">×</button>
      <div class="menu" role="menu"></div>
    </div>`
  document.documentElement.appendChild(host)

  const sendBtn = root.querySelector('.send')
  const label = root.querySelector('.label')
  const closeBtn = root.querySelector('.close')
  const grip = root.querySelector('.grip')
  const moreBtn = root.querySelector('.more')
  const menu = root.querySelector('.menu')
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
      sendBtn.title = `Pôr na fila da sua sala: ${t.title}`
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
    closeMenu()
    refresh()
  })

  // ---- menu de playlists ------------------------------------------------------

  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  let menuOpen = false

  function closeMenu() {
    menuOpen = false
    menu.classList.remove('open')
    moreBtn.setAttribute('aria-expanded', 'false')
  }

  function renderMenu(state) {
    const t = currentTarget()
    const head = `<header><span>Salvar em</span><span>${state.user ? esc(state.user) : ''}</span></header>`
    const queue = `<button class="item queue" role="menuitem" data-act="queue"><b>▶</b><span>Fila da sala</span><small>tocar agora</small></button><div class="sep"></div>`
    let body = ''
    if (state.loading && !state.playlists) body = '<div class="loading">Carregando suas playlists…</div>'
    else if (state.login) body = '<div class="note">Para ter playlists, entre com Discord no EchoRoom. <button data-act="login">Abrir o EchoRoom</button></div>'
    else if (state.error && !state.playlists) body = `<div class="note">${esc(state.error)}</div>`
    else if (state.playlists && !state.playlists.length) body = '<div class="note">Você ainda não tem playlists. Crie uma abaixo.</div>'
    else
      body = (state.playlists || [])
        .map((p) => `<button class="item" role="menuitem" data-id="${esc(p.id)}"><b>♪</b><span>${esc(p.name)}</span><small>${p.count}</small></button>`)
        .join('')
    const form = state.login
      ? ''
      : `<form class="new"><input maxlength="60" placeholder="Nova playlist com ${t && t.kind === 'playlist' ? 'esta lista' : 'esta música'}" aria-label="Nome da nova playlist"><button type="submit" disabled>Criar</button></form>`
    menu.innerHTML = head + `<div class="list">${queue}${body}</div>` + form
    const input = menu.querySelector('.new input')
    const create = menu.querySelector('.new button')
    if (input) input.addEventListener('input', () => (create.disabled = !input.value.trim()))
  }

  let menuState = {}
  async function openMenu() {
    menuOpen = true
    moreBtn.setAttribute('aria-expanded', 'true')
    // Abre para baixo se o botão estiver no alto da tela.
    menu.classList.toggle('below', host.getBoundingClientRect().top < 380)
    menu.classList.add('open')
    const cached = await chrome.storage.local.get(['playlists', 'playlistsUser'])
    menuState = { playlists: cached.playlists || null, user: cached.playlistsUser || '', loading: true }
    renderMenu(menuState)
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ECHOROOM_PLAYLISTS' })
      if (!menuOpen) return
      if (res && res.ok) menuState = { playlists: res.playlists, user: res.user }
      else if (res && res.error === 'login') menuState = { login: true }
      else menuState = { ...menuState, loading: false, error: (res && res.error) || 'Não foi possível ler as playlists.' }
    } catch {
      menuState = { ...menuState, loading: false, error: 'Recarregue a página e tente de novo.' }
    }
    if (menuOpen) renderMenu(menuState)
  }

  moreBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))

  async function saveTo(target) {
    const t = currentTarget()
    if (!t) return
    closeMenu()
    busy = true
    clearTimeout(resetTimer)
    setLabel('Salvando…')
    try {
      const res = await chrome.runtime.sendMessage({ type: 'ECHOROOM_SAVE', url: t.url, title: t.title, ...target })
      if (res && res.ok) setLabel(`Salvo em ${res.name} ✓`, 'ok')
      else setLabel(res && res.error === 'login' ? 'Entre com Discord no EchoRoom' : (res && res.error) || 'Não foi possível salvar', 'err')
    } catch {
      setLabel('Recarregue a página e tente de novo', 'err')
    }
    busy = false
    resetTimer = setTimeout(refresh, 3000)
  }

  menu.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act], [data-id]')
    if (!el) return
    if (el.dataset.act === 'queue') {
      closeMenu()
      sendBtn.click()
    } else if (el.dataset.act === 'login') {
      closeMenu()
      chrome.runtime.sendMessage({ type: 'ECHOROOM_OPEN_LOGIN' })
    } else if (el.dataset.id) {
      saveTo({ playlistId: el.dataset.id })
    }
  })
  menu.addEventListener('submit', (e) => {
    e.preventDefault()
    const input = menu.querySelector('.new input')
    const name = input && input.value.trim()
    if (name) saveTo({ newName: name })
  })
  // Clique fora fecha o menu.
  document.addEventListener('pointerdown', (e) => {
    if (menuOpen && !e.composedPath().includes(host)) closeMenu()
  }, true)
  document.addEventListener('keydown', (e) => {
    if (menuOpen && e.key === 'Escape') closeMenu()
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
      closeMenu()
    }
    refresh()
  }
  window.addEventListener('yt-navigate-finish', check)
  window.addEventListener('popstate', check)
  setInterval(check, 1500)
  check()
})()
