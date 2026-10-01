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
 * Envia a música para o EchoRoom:
 * 1. Se já existe uma aba do EchoRoom (de preferência numa sala), entrega a
 *    música nela — sem abrir outra aba e sem som duplicado.
 * 2. Senão, abre o site com ?add=…; o site entra na última sala usada.
 */
async function sendToEchoRoom({ url, title }) {
  const tabs = await chrome.tabs.query({ url: SITE + '*' })
  const tab = tabs.find((t) => /\/room\//.test(t.url || '')) || tabs[0]
  if (tab) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'ECHOROOM_ADD', url, title })
      if (res && res.ok) {
        await focusTab(tab)
        return { ok: true, mode: 'tab' }
      }
    } catch {
      // Aba aberta antes da extensão ser instalada: não tem o script. Recarrega com ?add=.
    }
    await chrome.tabs.update(tab.id, { url: siteUrlWithAdd(url, title), active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    return { ok: true, mode: 'reload' }
  }
  await chrome.tabs.create({ url: siteUrlWithAdd(url, title) })
  return { ok: true, mode: 'new' }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'ECHOROOM_SEND' && typeof msg.url === 'string') {
    sendToEchoRoom(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }))
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
