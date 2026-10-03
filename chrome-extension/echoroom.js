// Roda nas páginas do EchoRoom: ponte entre a extensão e a página.
// - ECHOROOM_ADD: música para a fila da sala aberta.
// - ECHOROOM_REQUEST: pedidos que precisam do login do site (playlists).

/** A página marca <html data-echoroom> quando o app carregou. */
function pageReady(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (document.documentElement && document.documentElement.dataset.echoroom) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 100)
    }
    tick()
  })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false
  if (msg.type === 'ECHOROOM_PING') {
    pageReady(10000).then((ok) => sendResponse({ ok }))
    return true
  }
  if (msg.type === 'ECHOROOM_ADD') {
    window.postMessage({ source: 'echoroom-extension', type: 'ADD', url: msg.url, title: msg.title }, window.location.origin)
    sendResponse({ ok: true })
    return false
  }
  if (msg.type === 'ECHOROOM_REQUEST') {
    const requestId = Math.random().toString(36).slice(2)
    let done = false
    const finish = (data) => {
      if (done) return
      done = true
      window.removeEventListener('message', onReply)
      clearTimeout(timer)
      sendResponse(data)
    }
    const onReply = (ev) => {
      if (ev.source !== window || !ev.data || ev.data.source !== 'echoroom-page' || ev.data.requestId !== requestId) return
      finish(ev.data)
    }
    const timer = setTimeout(() => finish({ ok: false, error: 'O EchoRoom não respondeu a tempo.' }), 30000)
    window.addEventListener('message', onReply)
    pageReady().then((ok) => {
      if (!ok) return finish({ ok: false, error: 'O EchoRoom não carregou.' })
      window.postMessage({ source: 'echoroom-extension', requestId, ...msg.payload }, window.location.origin)
    })
    return true
  }
  return false
})
