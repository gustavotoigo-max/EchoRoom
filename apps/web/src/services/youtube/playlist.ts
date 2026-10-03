/**
 * Lê os vídeos de uma playlist do YouTube sem chave de API.
 *
 * Cria um player do YouTube temporário e fora da tela, carrega a playlist
 * (sem tocar) e lê getPlaylist(). O player é destruído logo em seguida.
 * Funciona para playlists públicas e não listadas; privadas falham.
 */

const LOAD_TIMEOUT_MS = 15_000

interface YTGlobal {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YT.Player & {
    getPlaylist(): string[] | null
    cuePlaylist(opts: { list: string; listType: string; index?: number }): void
  }
}

function waitForYouTubeApi(): Promise<YTGlobal> {
  const w = window as unknown as { YT?: YTGlobal & { loaded?: number }; onYouTubeIframeAPIReady?: () => void }
  if (w.YT?.Player) return Promise.resolve(w.YT)
  return new Promise((resolve, reject) => {
    // O react-youtube já injeta o script da IFrame API; se não, injeta aqui.
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
    const started = Date.now()
    const poll = setInterval(() => {
      if (w.YT?.Player) {
        clearInterval(poll)
        resolve(w.YT)
      } else if (Date.now() - started > LOAD_TIMEOUT_MS) {
        clearInterval(poll)
        reject(new Error('Não foi possível carregar o player do YouTube.'))
      }
    }, 100)
  })
}

export async function loadPlaylistVideoIds(playlistId: string): Promise<string[]> {
  const YTApi = await waitForYouTubeApi()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:120px;opacity:0;pointer-events:none'
  const target = document.createElement('div')
  host.appendChild(target)
  document.body.appendChild(host)

  return new Promise<string[]>((resolve, reject) => {
    let player: InstanceType<YTGlobal['Player']> | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    const cleanup = () => {
      if (poll) clearInterval(poll)
      clearTimeout(timeout)
      try {
        player?.destroy()
      } catch {
        /* já destruído */
      }
      host.remove()
    }
    const finish = (ids: string[] | null, err?: string) => {
      cleanup()
      if (ids && ids.length) resolve(ids)
      else reject(new Error(err ?? 'A playlist está vazia, é privada ou não existe.'))
    }
    const timeout = setTimeout(() => finish(null), LOAD_TIMEOUT_MS)

    player = new YTApi.Player(target, {
      width: 200,
      height: 120,
      playerVars: { listType: 'playlist', list: playlistId, autoplay: 0, controls: 0, mute: 1 },
      events: {
        onReady: () => {
          // Algumas versões só preenchem a lista depois de "cuePlaylist".
          try {
            player!.cuePlaylist({ list: playlistId, listType: 'playlist' })
          } catch {
            /* ignora */
          }
          let last = -1
          let stableTicks = 0
          poll = setInterval(() => {
            const ids = player?.getPlaylist?.() ?? null
            if (ids && ids.length) {
              // espera a lista parar de crescer
              stableTicks = ids.length === last ? stableTicks + 1 : 0
              last = ids.length
              if (stableTicks >= 3) finish(ids.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)))
            }
          }, 250)
        },
        onError: () => finish(null),
      },
    })
  })
}
