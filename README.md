# EchoRoom

Salas para ouvir YouTube juntos, sincronizado. Cada pessoa toca o vídeo no
player oficial do YouTube no próprio navegador; o servidor só coordena sala,
fila, estado e tempo.

- **Front-end:** React + TypeScript + Vite, player via `react-youtube`
- **Backend:** Python + FastAPI, WebSocket, SQLite
- **Sincronização:** relógio do servidor + clock offset + comandos agendados
  (`executeAt`) + timeline lógica + detecção e correção de drift

## Rodando (Windows / PowerShell)

Pré-requisitos: Python 3.11+ e Node 18+.

**Terminal 1 — backend**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 — front-end**

```powershell
cd frontend
npm install
npm run dev
```

Abra http://localhost:5173. O Vite encaminha `/api` e `/ws` para o backend.

Para testar com outros PCs na mesma rede, abra `http://SEU_IP:5173`
(o Vite já escuta em todas as interfaces).

### Produção (um processo só)

```powershell
cd frontend; npm run build; cd ..\backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

O FastAPI serve `frontend/dist` automaticamente se a pasta existir.

### Hospedagem (Vercel + Render)

O front-end é estático e vai para a **Vercel** (pasta `frontend`, com
`vercel.json` já configurado para as rotas `/room/...`). O backend precisa de
um processo contínuo com WebSocket e estado em memória, então vai para o
**Render** usando o `render.yaml` da raiz.

| Onde   | Variável              | Valor                                   |
|--------|-----------------------|-----------------------------------------|
| Vercel | `VITE_BACKEND_URL`    | `https://echoroom-api.onrender.com`     |
| Render | `ECHOROOM_CORS`       | `https://seu-projeto.vercel.app`        |
| Render | `ECHOROOM_CORS_REGEX` | `https://seu-projeto.*\.vercel\.app` (opcional, previews) |

No plano gratuito do Render o serviço dorme após 15 min sem uso (o primeiro
acesso demora para acordar) e o disco não é persistente: salas somem a cada
novo deploy ou reinício.

## Testes

```powershell
cd backend;  python -m pytest        # timeline, estado da sala, senha, despacho WS
cd frontend; npm test                # ClockSync, Timeline, DriftCorrection, SyncEngine
```

Modo debug da sincronização: adicione `?debug` à URL da sala (ou
`localStorage.setItem('echoroom.debug','1')`). O console passa a mostrar
RTT, clockOffset, expectedPosition, actualPosition, drift e correctionType,
e a sessão fica em `window.__echoroom`.

## Fluxo

1. Página inicial: nome + **senha da sala** → *Criar sala*.
2. A sala é criada e o **link é exibido** (com *Copiar link*) antes de entrar.
3. Quem abre o link digita nome e senha → *Entrar e começar a ouvir*
   (esse clique também libera o autoplay do navegador).
4. Depois de acertar a senha, o navegador guarda um token da sala; voltar
   ao link ou reconectar não pede a senha de novo.

A senha é guardada como hash scrypt com salt. O token é um HMAC ligado à
sala (o segredo fica na tabela `meta` do SQLite).

## Estrutura

```text
backend/app/
  main.py                 FastAPI, rota WebSocket, front compilado
  config.py               todos os parâmetros do servidor
  api/rooms.py            POST /api/rooms, GET /api/rooms/{id}, POST /api/rooms/{id}/join
  websocket/manager.py    conexões por sala, broadcast
  websocket/events.py     eventos e despacho de comandos
  rooms/manager.py        autoridade da sala, lock por sala, persistência
  rooms/state.py          transições puras (play, pause, seek, fila, fim de faixa)
  rooms/models.py         Room, QueueItem, Participant
  rooms/security.py       hash de senha e token
  sync/clock.py           relógio do servidor
  sync/timeline.py        timeline lógica (expected_position, play, pause, seek)
  database/               esquema e repositório (interface pronta para PostgreSQL)
  youtube/metadata.py     extração de videoId e título via oEmbed

frontend/src/
  sync/                   SyncConfig, ClockSync, Timeline, DriftCorrection, SyncEngine
  services/websocket/     WebSocketService (reconexão, request/ACK)
  services/youtube/       PlayerAdapter (interface) e adaptador da IFrame API
  services/roomSession.ts liga WebSocket ⇄ stores ⇄ SyncEngine ⇄ player
  stores/                 roomStore, playerStore (sem dependências)
  components/             Player, Controls, Queue, Participants, AddTrack, RoomHeader
  pages/                  Home, Room
  utils/youtubeUrlParser.ts
```

## Calibrando a sincronização

- Cliente: `frontend/src/sync/SyncConfig.ts` (faixas de drift, histerese,
  intervalos de verificação e de clock sync, rates de correção suave).
- Servidor: `backend/app/config.py` (`command_lead_time` = atraso dos
  comandos agendados, `track_change_lead_time` = atraso ao trocar de música).
  Também podem ser definidos por variáveis de ambiente
  (`ECHOROOM_COMMAND_LEAD`, `ECHOROOM_TRACK_LEAD`).

A correção suave só usa velocidades que o vídeo oferece em
`getAvailablePlaybackRates()`. Como o YouTube normalmente só oferece
0,25 / 0,5 / 0,75 / 1 / 1,25…, na prática drifts entre 400 ms e 1 s são
corrigidos com seek depois de algumas medições confirmarem o desvio.

## Decisões que vale saber

- As rotas HTTP ficam sob `/api` para não colidir com `/room/{id}` do front.
- Eventos extras além da lista da especificação: `TRACK_MOVE` (reordenar),
  `TRACK_META` (o primeiro cliente que carrega o vídeo informa duração e,
  se o oEmbed falhou, o título), `ACK` e `ERROR` (feedback de cada comando).
- Todo evento que muda a sala carrega o estado público completo em
  `payload.room`; o cliente aplica só versões maiores que a última.
- O botão ◀ volta ao início da música (não há histórico de faixas no MVP).
- A fila fica na coluna lateral, ao lado dos participantes, para que player,
  controles, campo de adicionar e fila caibam numa tela sem rolagem.
- Um bloqueio transparente sobre o iframe impede pausar pelo clique no
  vídeo — os controles da sala são a única fonte de comandos.
- Buffering de um participante não pausa a sala; ao voltar, ele faz seek
  para a posição esperada.
