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

## Rodando localmente

```powershell
cd frontend
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
  proíbem listar `/rooms`. O código fica público em `/roomIndex` apenas para
  diferenciar "sala não existe" de "senha incorreta".
- **Concorrência:** dois cliques simultâneos são resolvidos pela transação; o
  segundo é reaplicado sobre o resultado do primeiro (ex.: dois "Próxima"
  pulam só uma música; vários "fim da música" avançam uma vez).
- **Atraso dos comandos** (`commandLeadTimeMs`, padrão 600 ms) cobre a ida ao
  Firebase e a volta para os outros. Ajuste em `frontend/src/sync/SyncConfig.ts`.
- **Títulos** vêm do noembed.com; se falhar, o primeiro navegador que carregar
  o vídeo envia o título real.

## Estrutura

```text
database.rules.json            regras do Realtime Database (copiar no console)
.github/workflows/deploy.yml   build + deploy no GitHub Pages
frontend/src/
  config/firebase.ts           lê a configuração do Firebase
  rooms/roomLogic.ts           regras da sala (play, pause, seek, fila, fim de faixa)
  services/firebase/           app/auth, salas com senha, backend da sala (transações, presença, relógio)
  services/roomSession.ts      liga Firebase ⇄ stores ⇄ SyncEngine ⇄ player
  services/youtube/            PlayerAdapter, adaptador da IFrame API, metadados
  sync/                        SyncConfig, ClockSync, Timeline, DriftCorrection, SyncEngine
  stores/  components/  pages/  utils/
```

A versão anterior com backend FastAPI está no histórico do Git (commit `d2b75c4`).
