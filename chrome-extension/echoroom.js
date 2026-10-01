// Roda nas páginas do EchoRoom: repassa à página as músicas enviadas pela extensão.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ECHOROOM_ADD') return false
  window.postMessage({ source: 'echoroom-extension', type: 'ADD', url: msg.url, title: msg.title }, window.location.origin)
  sendResponse({ ok: true })
  return false
})
