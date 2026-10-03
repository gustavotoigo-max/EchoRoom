import { useEffect, useState } from 'react'
import { navigate, PROFILE_PATH, START_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { isDiscordUid } from '../../services/firebase/app'
import { claimRoom, deleteRoom, MAX_ROOM_NAME, renameRoom, unbanParticipant, updateSettings } from '../../services/firebase/roomsApi'
import { forgetMyRoom } from '../../services/firebase/social'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { RoomSettings } from '../../types/room'
import { CrownIcon } from '../ui/Icons'
import { openPanel } from './ui'
import { Choice, Section, Toggle } from '../ui/FormControls'
import { Permissions } from './Permissions'

export function SettingsBody() {
  const session = useRoomSession()
  const roomKey = session.backend.roomKey
  const meta = useStore(roomStore, (s) => s.meta)
  const settings = useStore(roomStore, (s) => s.settings)
  const banned = useStore(roomStore, (s) => s.banned)
  const isOwner = useStore(roomStore, selectIsOwner)
  const me = useStore(roomStore, (s) => s.participantId)
  const profile = useStore(authStore, (s) => s.profile)
  const [name, setName] = useState(meta?.name ?? '')
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  useEffect(() => setName(meta?.name ?? ''), [meta?.name])

  const save = async (patch: Partial<RoomSettings>) => {
    try {
      await updateSettings(roomKey, patch)
    } catch {
      showToast('Não foi possível salvar. Só o dono altera as configurações.', 'error')
    }
  }

  const locked = !isOwner

  return (
    <>
      {!meta?.ownerUid ? (
        <div className="drawer-note">
          <strong>Esta sala ainda não tem dono.</strong>
          <span>Ela foi criada antes de existirem donos. Quem assumir passa a administrar a sala.</span>
          {isDiscordUid(me) && profile ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => claimRoom(roomKey, profile.name).catch(() => showToast('Não foi possível assumir a sala.', 'error'))}
            >
              <CrownIcon width={14} height={14} /> Assumir a sala
            </button>
          ) : (
            <span>Entre com Discord para assumir.</span>
          )}
        </div>
      ) : (
        locked && (
          <div className="drawer-note">
            <span>
              Só o dono, <strong>{meta.ownerName || 'quem criou a sala'}</strong>, altera estas configurações. Aqui você
              vê as regras da sala.
            </span>
          </div>
        )
      )}

      <Section title="Quem pode o quê">
        <Permissions settings={settings} />
      </Section>

      <Section title="Geral">
        <label className="field">
          <span>Nome da sala</span>
          <div className="inline-field">
            <input value={name} maxLength={MAX_ROOM_NAME} disabled={locked} onChange={(e) => setName(e.target.value)} />
            {!locked && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!name.trim() || name.trim() === meta?.name}
                onClick={() =>
                  renameRoom(roomKey, name)
                    .then(() => showToast('Nome da sala atualizado.', 'ok', 2500))
                    .catch((e: Error) => showToast(e.message || 'Não foi possível renomear.', 'error'))
                }
              >
                Salvar
              </button>
            )}
          </div>
        </label>
      </Section>

      <Section title="Reprodução">
        <Choice
          label="Quem controla play, pausa e a ordem da fila"
          value={settings.controls}
          options={[
            ['all', 'Todos'],
            ['owner', 'Só o dono'],
          ]}
          disabled={locked}
          onChange={(v) => save({ controls: v as RoomSettings['controls'] })}
        />
        <Toggle
          label="Votar para pular"
          hint="“Próxima” vira um voto. A música pula quando parte da sala votar; o dono pula direto."
          checked={settings.voteSkip}
          disabled={locked}
          onChange={(v) => save({ voteSkip: v })}
        />
        {settings.voteSkip && (
          <Choice
            label="Votos necessários (das pessoas conectadas)"
            value={String(settings.voteSkipPercent)}
            options={[
              ['25', '25%'],
              ['50', 'Metade'],
              ['66', '2/3'],
              ['100', 'Todos'],
            ]}
            disabled={locked}
            onChange={(v) => save({ voteSkipPercent: Number(v) })}
          />
        )}
        <Choice
          label="Aleatório, ciclar e repetir"
          value={settings.modes}
          options={[
            ['all', 'Todos'],
            ['owner', 'Só o dono'],
            ['off', 'Desligado'],
          ]}
          disabled={locked}
          onChange={(v) => {
            void save({ modes: v as RoomSettings['modes'] })
            // Desligado: volta a sala ao normal.
            if (v === 'off') void session.setModes({ shuffle: false, repeat: 'off' }).catch(() => {})
          }}
        />
        <Toggle
          label="Desativar vídeo para todos"
          hint="Todo mundo ouve só o som, com o player no tamanho mínimo: menos processamento e menos dados."
          checked={settings.videoOff}
          disabled={locked}
          onChange={(v) => save({ videoOff: v })}
        />
      </Section>

      <Section title="Fila">
        <Choice
          label="Quem adiciona músicas"
          value={settings.adding}
          options={[
            ['all', 'Todos'],
            ['owner', 'Só o dono'],
          ]}
          disabled={locked}
          onChange={(v) => save({ adding: v as RoomSettings['adding'] })}
        />
        <Choice
          label="Músicas de cada pessoa na fila"
          value={String(settings.maxPerUser)}
          options={[
            ['0', 'Sem limite'],
            ['1', '1'],
            ['3', '3'],
            ['5', '5'],
            ['10', '10'],
          ]}
          disabled={locked}
          onChange={(v) => save({ maxPerUser: Number(v) })}
        />
      </Section>

      <Section title="Acesso">
        <Toggle
          label="Permitir convidados"
          hint="Quem não entra com Discord pode participar usando o link e a senha."
          checked={settings.allowGuests}
          disabled={locked}
          onChange={(v) => save({ allowGuests: v })}
        />
        <div className="field">
          <span>Bloqueados</span>
          {Object.keys(banned).length === 0 ? (
            <p className="hint">Ninguém bloqueado. Para remover ou bloquear alguém, use o menu da pessoa na lista de participantes.</p>
          ) : (
            <ul className="banned-list">
              {Object.entries(banned).map(([uid, n]) => (
                <li key={uid}>
                  <span>{n}</span>
                  {!locked && (
                    <button type="button" className="link-btn" onClick={() => unbanParticipant(roomKey, uid).catch(() => {})}>
                      Desbloquear
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {isOwner && (
        <Section title="Apagar sala" danger>
          <p className="hint">
            Apaga a sala, a fila e as sugestões para todos. Não dá para desfazer. Digite o código{' '}
            <strong className="mono-code">{session.roomId}</strong> para confirmar.
          </p>
          <div className="inline-field">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} placeholder={session.roomId} />
            <button
              type="button"
              className="btn btn-danger"
              disabled={confirm !== session.roomId || deleting}
              onClick={async () => {
                setDeleting(true)
                try {
                  await deleteRoom(session.roomId, roomKey)
                  await forgetMyRoom(session.roomId).catch(() => {})
                  openPanel(null)
                  showToast('Sala apagada.', 'info', 3000)
                  navigate(profile ? PROFILE_PATH : START_PATH)
                } catch {
                  setDeleting(false)
                  showToast('Não foi possível apagar a sala.', 'error')
                }
              }}
            >
              {deleting ? 'Apagando…' : 'Apagar sala'}
            </button>
          </div>
        </Section>
      )}
    </>
  )
}
