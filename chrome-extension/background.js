// EchoRoom — service worker da extensão.
// Endereço do site. Se mudar, ajuste também "host_permissions" e o segundo
// "matches" no manifest.json.
const SITE = 'https://gustavotoigo-max.github.io/EchoRoom/'

function siteUrlWithAdd(url, title) {
  const u = new URL(SITE)
  u.searchParams.set('add', url)
  if (title) u.searchParams.set('title', title)
  return u.toString()
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true })
  await chrome.windows.update(tab.windowId, { focused: true })
}

/**
 * Envia a música para o EchoRoom e SEMPRE deixa o site visível:
 * 1. Se já existe uma aba do EchoRoom (de preferência numa sala), entrega a
 *    música nela e muda para ela. Se a aba não responder (aberta antes da
 *    extensão, suspensa pelo Chrome, etc.), recarrega a aba com ?add=.
 * 2. Senão, abre o site numa aba nova ao lado da aba do YouTube; ele entra
 *    na última sala usada e adiciona a música.
 */
async function sendToEchoRoom({ url, title }, sender) {
  const tabs = await chrome.tabs.query({ url: SITE + '*' })
  const tab = tabs.find((t) => /\/room\//.test(t.url || '') && !t.discarded) || tabs.find((t) => /\/room\//.test(t.url || '')) || tabs[0]

  if (tab) {
    let delivered = false
    if (!tab.discarded && tab.status !== 'unloaded') {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'ECHOROOM_ADD', url, title })
        delivered = !!(res && res.ok)
      } catch {
        delivered = false
      }
    }
    if (!delivered) await chrome.tabs.update(tab.id, { url: siteUrlWithAdd(url, title) })
    await focusTab(tab)
    return { ok: true, mode: delivered ? 'tab' : 'reload' }
  }

  const opener = sender && sender.tab
  const created = await chrome.tabs.create({
    url: siteUrlWithAdd(url, title),
    active: true,
    ...(opener ? { windowId: opener.windowId, index: opener.index + 1 } : {}),
  })
  await chrome.windows.update(created.windowId, { focused: true })
  return { ok: true, mode: 'new' }
}

// ---- playlists (precisam do login do site) -----------------------------------

/** Abas que a extensão abriu só para atender um pedido (fechadas depois). */
const helperTabs = new Set()

function waitComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve(false)
    }, timeoutMs)
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(listener)
        resolve(true)
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

/** Uma aba do EchoRoom que responda; se não houver, abre uma em segundo plano. */
async function echoRoomTab(opener) {
  const tabs = await chrome.tabs.query({ url: SITE + '*' })
  for (const t of tabs) {
    if (t.discarded || t.status === 'unloaded') continue
    try {
      const res = await chrome.tabs.sendMessage(t.id, { type: 'ECHOROOM_PING' })
      if (res && res.ok) return t
    } catch {
      /* aba antiga, sem a extensão: tenta outra */
    }
  }
  const created = await chrome.tabs.create({
    url: SITE + 'perfil',
    active: false,
    ...(opener ? { windowId: opener.windowId, index: opener.index + 1 } : {}),
  })
  helperTabs.add(created.id)
  await waitComplete(created.id)
  for (let i = 0; i < 20; i++) {
    try {
      const res = await chrome.tabs.sendMessage(created.id, { type: 'ECHOROOM_PING' })
      if (res && res.ok) return created
    } catch {
      /* script ainda não carregou */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return created
}

function closeHelperLater(tabId, ms = 60000) {
  if (!helperTabs.has(tabId)) return
  setTimeout(() => {
    helperTabs.delete(tabId)
    chrome.tabs.remove(tabId).catch(() => {})
  }, ms)
}

async function askEchoRoom(payload, sender, { closeAfterMs } = {}) {
  const tab = await echoRoomTab(sender && sender.tab)
  let res
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'ECHOROOM_REQUEST', payload })
  } catch {
    res = { ok: false, error: 'O EchoRoom não respondeu. Tente de novo.' }
  }
  if (closeAfterMs != null) closeHelperLater(tab.id, closeAfterMs)
  return res || { ok: false, error: 'Sem resposta do EchoRoom.' }
}

async function listPlaylists(sender) {
  const res = await askEchoRoom({ type: 'LIST_PLAYLISTS' }, sender, { closeAfterMs: 60000 })
  if (res.ok) await chrome.storage.local.set({ playlists: res.playlists, playlistsUser: res.user, playlistsAt: Date.now() })
  else if (res.error === 'login') await chrome.storage.local.remove(['playlists', 'playlistsUser'])
  return res
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ECHOROOM_SEND' && typeof msg.url === 'string') {
    sendToEchoRoom(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }))
    return true // resposta assíncrona
  }
  if (msg && msg.type === 'ECHOROOM_PLAYLISTS') {
    listPlaylists(sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }
  if (msg && msg.type === 'ECHOROOM_SAVE' && typeof msg.url === 'string') {
    const payload = msg.newName
      ? { type: 'NEW_PLAYLIST', name: msg.newName, url: msg.url, title: msg.title }
      : { type: 'ADD_TO_PLAYLIST', playlistId: msg.playlistId, url: msg.url, title: msg.title }
    askEchoRoom(payload, sender, { closeAfterMs: 1500 })
      .then(async (res) => {
        if (res.ok) await listPlaylists(sender).catch(() => {})
        sendResponse(res)
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true
  }
  if (msg && msg.type === 'ECHOROOM_OPEN_LOGIN') {
    chrome.tabs.create({ url: SITE + 'perfil', active: true }).then(() => sendResponse({ ok: true }))
    return true
  }
  return false
})

// Clique no ícone da extensão: abre (ou mostra) o EchoRoom.
chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ url: SITE + '*' })
  if (tab) await focusTab(tab)
  else await chrome.tabs.create({ url: SITE })
})
