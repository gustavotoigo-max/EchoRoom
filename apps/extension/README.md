# Extensão EchoRoom para Chrome

Mostra um botão flutuante **"Tocar no EchoRoom"** nas páginas do YouTube
(vídeos, shorts e playlists). Ao clicar:

1. copia o link da música,
2. pausa o vídeo daquela aba e segura a pausa por alguns segundos (para não
   tocar em dobro se o YouTube tentar continuar sozinho),
3. **sempre abre o EchoRoom na frente** e manda a música:
   - se já existe uma aba do EchoRoom, muda para ela e a música entra na sala
     (se a aba não responder, ela é recarregada já com a música);
   - senão, abre o site numa aba nova ao lado do YouTube, que entra sozinho na
     **última sala usada** neste navegador (se nome e senha já estiverem
     salvos) e adiciona a música.

## Atualizar

Baixe o zip de novo no site, substitua os arquivos da pasta e clique no botão
de recarregar (↻) da extensão em `chrome://extensions`. Depois recarregue as
abas do YouTube que estavam abertas.

## Instalar

1. Baixe `echoroom-chrome.zip` pelo link na página inicial do EchoRoom e descompacte.
2. Abra `chrome://extensions`.
3. Ligue **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta descompactada.

O botão pode ser arrastado na vertical pela alça `⋮⋮` e escondido na aba pelo `×`.

## Endereço do site

Está em `background.js` (`SITE`) e no `manifest.json` (`host_permissions` e o
segundo `matches`). Se o site mudar de endereço, altere os três.

## Playlists (versão 1.2)

A setinha ao lado do botão abre as suas playlists pessoais do EchoRoom. Escolha uma
para salvar a música (ou a playlist do YouTube inteira), ou crie uma nova ali mesmo.
É preciso ter entrado com Discord no EchoRoom. Se nenhuma aba do EchoRoom estiver
aberta, a extensão abre uma em segundo plano e fecha depois.
