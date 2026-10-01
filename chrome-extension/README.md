# Extensão EchoRoom para Chrome

Mostra um botão flutuante **"Tocar no EchoRoom"** nas páginas do YouTube
(vídeos, shorts e playlists). Ao clicar:

1. copia o link da música,
2. pausa o vídeo daquela aba (para não tocar em dobro),
3. manda a música para o EchoRoom:
   - se já existe uma aba do EchoRoom aberta, a música entra na sala dela;
   - senão, abre o site, que entra sozinho na **última sala usada** neste
     navegador (se nome e senha já estiverem salvos) e adiciona a música.

## Instalar

1. Baixe `echoroom-chrome.zip` pelo link na página inicial do EchoRoom e descompacte.
2. Abra `chrome://extensions`.
3. Ligue **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta descompactada.

O botão pode ser arrastado na vertical pela alça `⋮⋮` e escondido na aba pelo `×`.

## Endereço do site

Está em `background.js` (`SITE`) e no `manifest.json` (`host_permissions` e o
segundo `matches`). Se o site mudar de endereço, altere os três.
