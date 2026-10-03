# EchoRoom

Salas para ouvir YouTube juntos, sincronizado. Cada pessoa toca o vídeo no
player oficial do YouTube no próprio navegador; o **Firebase Realtime
Database** guarda a sala (fila, play/pause, posição) e avisa todos os
participantes. O site é estático e fica no **GitHub Pages**.

- **Front-end:** React + TypeScript + Vite, player via `react-youtube`
- **Tempo real:** Firebase Realtime Database + login anônimo
- **Sincronização:** relógio do servidor (Firebase) + clock offset + comandos
  agendados (`executeAt`) + timeline lógica + detecção e correção de drift

## Publicação

O workflow `.github/workflows/deploy.yml` testa, compila e publica no GitHub
Pages a cada push na `main`. Ele precisa de:

1. **Settings → Pages → Source:** `GitHub Actions`
2. **Settings → Secrets and variables → Actions → Variables:**
   `FIREBASE_CONFIG` com o objeto de configuração do app web do Firebase
   (pode colar exatamente como o console mostra).
3. No Firebase: Realtime Database criado, **login anônimo ativado** e as
   regras de `database.rules.json` publicadas.

Endereço: `https://<usuário>.github.io/EchoRoom/`

## Recursos

- Links de vídeo, shorts e **playlists** (`/playlist?list=…`). Um vídeo aberto
  dentro de uma playlist entra sozinho, com a opção de adicionar a playlist
  inteira. As playlists são lidas pelo próprio player do YouTube (sem chave de
  API); entram até o limite da fila (200).
- Vídeos indisponíveis (removidos, privados ou sem incorporação) são pulados
  automaticamente.
- **Sugestões** de cada sala: músicas e playlists que já tocaram ficam salvas
  (`/rooms/{chave}/library`), ordenadas por mais tocadas ou recentes, com busca
  e adição em um clique.
- **Login com Discord** (escopo `identify`: só nome e avatar), validado pelo
  serviço de login em `apps/api/` (Cloudflare Workers, grátis). Guia completo:
  [`apps/api/README.md`](apps/api/README.md). Variáveis no GitHub:
  `DISCORD_CLIENT_ID` e `AUTH_URL`.
- **Dono da sala:** criar sala exige Discord e pede nome + senha. Só o dono
  altera as configurações, remove/bloqueia pessoas e apaga sugestões.
- **Configurações da sala** (engrenagem no topo): quem controla a reprodução,
  votar para pular (com porcentagem), vídeo desligado para todos, quem adiciona
  músicas, limite por pessoa, permitir convidados, bloqueados, apagar sala.
- **Perfil** (`/perfil`): salas de que a pessoa faz parte (dono ou membro) e
  convites pendentes.
- **Convites:** de dentro da sala, busque quem já tem perfil pelo usuário do
  Discord. A pessoa recebe uma notificação (Aceitar/Recusar) e entra sem senha.
  O convite expira em 1 hora.
- **Convidados** (sem Discord) entram com link + senha, se o dono permitir.
- **Páginas:** `/` apresentação, `/comecar` criar ou entrar numa sala,
  `/room/CODIGO` a sala.
- **Visual "Frequência":** estrutura no estilo do Discord (fila à esquerda,
  membros à direita, painel do usuário) com identidade própria (gradiente
  violeta → azul → ciano). O símbolo é provisório: fica em `BrandMark`
  (`apps/web/src/components/ui/Icons.tsx`) e em `apps/web/public/favicon.svg`.
- Temas: desativados por enquanto; o mecanismo está em `apps/web/src/theme/`.
- Quem entra numa sala com música tocando recebe um aviso e começa do ponto atual.
- Se o navegador bloquear o som (autoplay), aparece "Clique para ouvir junto".
- **Extensão para Chrome** (`apps/extension/`): botão flutuante no YouTube que
  manda a música para a sua última sala. O site publica o zip em
  `/EchoRoom/echoroom-chrome.zip`. Instruções em `apps/extension/README.md`.

## Rodando localmente

```powershell
cd apps/web
copy .env.example .env.local   # cole a configuração do Firebase em VITE_FIREBASE_CONFIG
npm install
npm run dev
```

Testes: `npm test` (lógica da sala, ClockSync, Timeline, DriftCorrection,
SyncEngine). Modo debug da sincronização: adicione `?debug` à URL da sala.

## Como a sala funciona sem servidor próprio

| Antes (FastAPI)                 | Agora (Firebase)                                                  |
|---------------------------------|-------------------------------------------------------------------|
| Servidor serializa os comandos  | Cada comando é uma **transação** em `/rooms/{chave}/state`        |
| `stateVersion` do servidor      | Incrementado dentro da transação                                  |
| Relógio do servidor + PING/PONG | `.info/serverTimeOffset` + pings gravando `serverTimestamp()`     |
| Senha com hash no servidor      | Chave da sala = PBKDF2(senha, código); dados em `/rooms/{chave}`  |
| Participantes por WebSocket     | Presença com `onDisconnect()`                                     |

- **Senha:** só quem sabe código + senha calcula o caminho da sala; as regras
  proíbem listar `/rooms`. Convites aceitos guardam a chave no perfil.
- **Permissões no banco:** as regras conferem dono (`meta/ownerUid`), bloqueio,
  sala só para Discord, perfil igual ao login, convite só de membro e por até 1 h.
  Quem controla a reprodução / adiciona / remove é conferido dentro da transação
  da sala (pelo app). O código fica público em `/roomIndex` apenas para
  diferenciar "sala não existe" de "senha incorreta".
- **Concorrência:** dois cliques simultâneos são resolvidos pela transação; o
  segundo é reaplicado sobre o resultado do primeiro (ex.: dois "Próxima"
  pulam só uma música; vários "fim da música" avançam uma vez).
- **Atraso dos comandos** (`commandLeadTimeMs`, padrão 600 ms) cobre a ida ao
  Firebase e a volta para os outros. Ajuste em `apps/web/src/sync/SyncConfig.ts`.
- **Títulos** vêm do noembed.com; se falhar, o primeiro navegador que carregar
  o vídeo envia o título real.

## Estrutura

Monorepo com npm workspaces:

```text
apps/web/            site (React + TypeScript + Vite) — publicado no GitHub Pages
  src/
    config/          configuração do Firebase
    rooms/           regras da sala (comandos, permissões, aleatório/repetir) — testadas
    sync/            relógio, timeline, correção de atraso, motor de sincronização — testados
    services/
      firebase/      salas, perfil/convites, playlists, sugestões, login
      youtube/       player, metadados, playlists e "parecidas" do YouTube
      roomSession.ts liga Firebase ⇄ stores ⇄ sincronização ⇄ player
      extensionBridge.ts, externalAdd.ts  conversa com a extensão do Chrome
    components/      peças da interface, uma pasta por área (Player, Queue, Playlists…)
    pages/           Landing, Home (/comecar), Room, Profile
    stores/          estado (sala, player, avisos)
    styles/          CSS em partes, importadas em ordem por styles/index.css
  tests/             testes (vitest)
apps/api/            backend (Cloudflare Worker): login com Discord, administração
apps/extension/      extensão do Chrome (botão no YouTube)
packages/shared/     tipos e constantes comuns a site e backend
database.rules.json  regras do Realtime Database (copiar no console do Firebase)
```

A versão anterior com backend FastAPI está no histórico do Git (commit `d2b75c4`).
