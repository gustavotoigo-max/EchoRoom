# EchoRoom para Android (React Native + Expo)

App do celular com as mesmas salas do site: a música toca sincronizada com quem
está no site ou em outro celular.

## Como o código é reaproveitado

O app importa direto de `apps/web/src` (com `@web/...`) as regras da sala, a
sincronização (SyncEngine, relógio, correção de atraso), o acesso ao Firebase
e as stores. O que depende do navegador é trocado no empacotamento
(`metro.config.js`) pelas versões em `src/platform`:

| Do site | No app |
|---|---|
| `utils/storage` (localStorage) | `storage.ts` (AsyncStorage) |
| `config/firebase`, `services/firebase/app` | `firebaseConfig.ts`, `firebaseApp.ts` (sessão salva no aparelho) |
| `services/firebase/roomCrypto` (WebCrypto) | `roomCrypto.ts` (PBKDF2 em JavaScript) |
| `services/discordAuth` | `discordAuth.ts` (abre o Discord e volta por `echoroom://auth`) |
| `services/youtube/playlist` (player escondido) | `ytPlaylist.ts` (lê a página pública da playlist) |
| player do YouTube (react-youtube) | `webViewPlayer.ts` + `components/room/PlayerView.tsx`: WebView com `player.html` do site |

O player roda em `https://…github.io/EchoRoom/player.html` (arquivo
`apps/web/public/player.html`): um endereço real, que o YouTube aceita para
vídeos incorporados.

## Login com Discord no app

1. O app abre a autorização padrão do Discord (só nome e avatar).
2. O Discord volta para `https://<serviço de login>/discord/app`, que devolve o
   código ao app (`echoroom://auth`).
3. O app troca o código pelo token do Firebase no serviço de login.

Precisa estar cadastrado no Discord (Developer Portal → OAuth2 → Redirects):
`https://echoroom-auth.gustavo-toigo.workers.dev/discord/app`

## Gerar o APK

O GitHub Actions (`.github/workflows/mobile.yml`) gera o APK a cada mudança
no app e publica em **Releases → EchoRoom para Android** (`EchoRoom.apk`).
Também dá para rodar na mão: **Actions → Gerar app Android → Run workflow**.

Rodando localmente (precisa do Android Studio):

```bash
cd apps/mobile
npm install
npx expo run:android
```

As variáveis vêm de `EXPO_PUBLIC_FIREBASE_CONFIG`, `EXPO_PUBLIC_DISCORD_CLIENT_ID`,
`EXPO_PUBLIC_AUTH_URL` e `EXPO_PUBLIC_SITE_URL` (no CI, das variáveis do repositório).
