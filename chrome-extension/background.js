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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ECHOROOM_SEND' && typeof msg.url === 'string') {
    sendToEchoRoom(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }))
    return true // resposta assíncrona
  }
  return false
})

// Clique no ícone da extensão: abre (ou mostra) o EchoRoom.
chrome.action.onClicked.addListener(async () => {
  const [tab] = await chrome.tabs.query({ url: SITE + '*' })
  if (tab) await focusTab(tab)
  else await chrome.tabs.create({ url: SITE })
})
