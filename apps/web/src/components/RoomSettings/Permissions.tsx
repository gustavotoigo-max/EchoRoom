import { RoomSettings } from '../../types/room'

/** Resumo das permissões atuais (muda junto com as configurações). */
export function Permissions({ settings }: { settings: RoomSettings }) {
  const everyone = settings.allowGuests ? 'Todos' : 'Todos (só com Discord)'
  const rows: [string, string][] = [
    ['Tocar, pausar, mudar o tempo e a ordem da fila', settings.controls === 'owner' ? 'Só o dono' : everyone],
    [
      'Pular música',
      settings.voteSkip
        ? `Dono pula direto; os outros votam (${settings.voteSkipPercent === 100 ? 'todos' : `${settings.voteSkipPercent}%`}, mínimo 2 votos)`
        : settings.controls === 'owner'
          ? 'Só o dono'
          : everyone,
    ],
    [
      'Adicionar músicas',
      settings.adding === 'owner' ? 'Só o dono' : settings.maxPerUser ? `${everyone}, até ${settings.maxPerUser} por pessoa na fila` : everyone,
    ],
    [
      'Aleatório, ciclar e repetir',
      settings.modes === 'off' ? 'Desligado pelo dono' : settings.modes === 'owner' ? 'Só o dono' : everyone,
    ],
    ['Tirar música da fila', 'Dono: qualquer uma · os outros: só as que adicionaram'],
    ['Convidar', 'Link + senha: qualquer um · pelo site: quem entrou com Discord'],
    ['Entrar na sala', settings.allowGuests ? 'Quem tem o link e a senha (com ou sem Discord)' : 'Só quem entra com Discord'],
    ['Configurações, remover/bloquear pessoas, apagar sugestões e a sala', 'Só o dono'],
    ['Criar playlist da sala e pôr música nela', everyone],
    ['Editar ou apagar uma playlist', 'Quem criou · o dono pode apagar qualquer uma'],
    ['Volume, tamanho do vídeo e tela cheia', 'Cada um no seu'],
  ]
  return (
    <dl className="perm-table">
      {rows.map(([what, who]) => (
        <div key={what}>
          <dt>{what}</dt>
          <dd>{who}</dd>
        </div>
      ))}
    </dl>
  )
}
