import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccessMode, AdminOverview, AdminRequest, AdminRoom, AdminUser, AdminUserDetail, AuditEntry } from '@echoroom/shared'
import { UserChip } from '../../components/Invites/UserChip'
import { Brand } from '../../components/ui/Brand'
import { DiscordIcon } from '../../components/ui/Icons'
import { Toasts } from '../../components/ui/Toasts'
import { adminApi, adminErrorMessage, AdminApiError } from '../../services/adminApi'
import { authStore, discordEnabled, startDiscordLogin } from '../../services/discordAuth'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { ColumnChart } from './ColumnChart'
import './admin.css'

type Tab = 'overview' | 'users' | 'rooms' | 'access' | 'audit'
const TABS: [Tab, string][] = [
  ['overview', 'Visão geral'],
  ['users', 'Pessoas'],
  ['rooms', 'Salas'],
  ['access', 'Acesso'],
  ['audit', 'Registro'],
]

const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')
const fmtDateTime = (ms: number) =>
  ms ? new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtDay = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—')
const n = (v: number) => v.toLocaleString('pt-BR')

/** Painel do administrador: uso do site, pessoas, salas, acesso e registro. */
export function Admin() {
  const { profile, ready } = useStore(authStore, (s) => s)
  const [state, setState] = useState<'checking' | 'ok' | 'denied' | 'error'>('checking')
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<Tab>(() => (window.location.hash.slice(1) as Tab) || 'overview')

  useEffect(() => {
    if (!ready || !profile) return
    setState('checking')
    adminApi
      .me()
      .then(() => setState('ok'))
      .catch((err) => {
        setMessage(adminErrorMessage(err))
        setState(err instanceof AdminApiError && (err.status === 403 || err.status === 401) ? 'denied' : 'error')
      })
  }, [ready, profile])

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname + (tab === 'overview' ? '' : `#${tab}`))
  }, [tab])

  return (
    <div className="home admin-page">
      <header className="topbar">
        <Brand />
        <span className="adm-badge">Admin</span>
        <UserChip />
      </header>
      <main className="adm-main">
        {!ready ? (
          <p className="hint">Carregando…</p>
        ) : !profile ? (
          <div className="panel gate">
            <h2>Painel do administrador</h2>
            <p className="hint">Entre com Discord para continuar.</p>
            {discordEnabled && (
              <button type="button" className="btn btn-discord" onClick={startDiscordLogin}>
                <DiscordIcon width={20} height={20} /> Entrar com Discord
              </button>
            )}
          </div>
        ) : state === 'checking' ? (
          <p className="hint">Conferindo acesso…</p>
        ) : state !== 'ok' ? (
          <div className="panel gate">
            <h2>{state === 'denied' ? 'Acesso restrito' : 'Backend indisponível'}</h2>
            <p className="hint">{message}</p>
            {state === 'denied' && (
              <>
                <p className="hint">
                  Para virar administrador, coloque o seu ID na variável <code>ADMIN_UIDS</code> do backend (Cloudflare) e
                  entre com Discord de novo:
                </p>
                <code className="adm-uid">{profile.uid}</code>
              </>
            )}
          </div>
        ) : (
          <>
            <nav className="adm-tabs" role="tablist">
              {TABS.map(([t, label]) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {label}
                </button>
              ))}
            </nav>
            {tab === 'overview' && <OverviewTab />}
            {tab === 'users' && <UsersTab />}
            {tab === 'rooms' && <RoomsTab />}
            {tab === 'access' && <AccessTab />}
            {tab === 'audit' && <AuditTab />}
          </>
        )}
      </main>
      <Toasts />
    </div>
  )
}

/** Carrega dados da API com estado de carregando/erro e recarga. */
function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    fn()
      .then(setData)
      .catch((err) => setError(adminErrorMessage(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(load, [load])
  return { data, error, reload: load, setData }
}

async function act(fn: () => Promise<unknown>, ok: string, after?: () => void) {
  try {
    await fn()
    showToast(ok, 'ok', 3000)
    after?.()
  } catch (err) {
    showToast(adminErrorMessage(err), 'error')
  }
}

// ---- visão geral -----------------------------------------------------------------

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="adm-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function OverviewTab() {
  const { data, error, reload } = useLoad<AdminOverview>(adminApi.overview)
  if (error) return <LoadError error={error} reload={reload} />
  if (!data) return <p className="hint">Calculando estatísticas…</p>
  const series = (pick: (d: AdminOverview['days'][number]) => number) => data.days.map((d) => ({ label: d.date, value: pick(d) }))
  const extension = data.days.reduce((a, d) => a + d.extension, 0)
  return (
    <>
      <div className="adm-head">
        <h1>Visão geral</h1>
        <span className="hint">
          Atualizado {fmtDateTime(data.generatedAt)} ·{' '}
          <button type="button" className="link-btn" onClick={reload}>
            atualizar
          </button>
        </span>
      </div>
      <section className="adm-tiles">
        <Tile label="Agora" value={n(data.now.peopleOnline)} sub={`online em ${n(data.now.roomsActive)} salas · ${n(data.now.guestsOnline)} convidados`} />
        <Tile label="Pessoas cadastradas" value={n(data.totals.users)} sub={`${n(data.totals.suspended)} suspensas`} />
        <Tile label="Ativas hoje" value={n(data.active.today)} sub={`${n(data.active.week)} na semana · ${n(data.active.month)} no mês`} />
        <Tile label="Salas" value={n(data.totals.rooms)} sub="criadas e ainda existentes" />
        <Tile
          label="Acesso"
          value={data.access === 'open' ? 'Aberto' : 'Por aprovação'}
          sub={data.totals.pending ? `${n(data.totals.pending)} pedidos esperando` : 'nenhum pedido esperando'}
        />
        <Tile label="Pela extensão" value={n(extension)} sub="envios nos últimos 30 dias" />
      </section>
      <section className="adm-charts">
        <ColumnChart title="Pessoas ativas por dia (Discord)" unit="pessoas" points={series((d) => d.active)} />
        <ColumnChart title="Convidados ativos por dia" unit="convidados" points={series((d) => d.activeGuests)} />
        <ColumnChart title="Novos cadastros por dia" unit="cadastros" points={series((d) => d.newUsers)} />
        <ColumnChart title="Salas criadas por dia" unit="salas" points={series((d) => d.roomsCreated)} />
        <ColumnChart title="Músicas adicionadas por dia" unit="músicas" points={series((d) => d.adds)} />
        <ColumnChart title="Músicas salvas em playlists por dia" unit="músicas" points={series((d) => d.playlistSaves)} />
      </section>
      <p className="hint adm-note">
        Os números vêm de contadores e da atividade diária (quem abriu o site no dia). O conteúdo das salas não é lido.
      </p>
    </>
  )
}

function LoadError({ error, reload }: { error: string; reload: () => void }) {
  return (
    <p className="form-error">
      {error}{' '}
      <button type="button" className="link-btn" onClick={reload}>
        Tentar de novo
      </button>
    </p>
  )
}

// ---- pessoas -------------------------------------------------------------------------

function UsersTab() {
  const { data, error, reload } = useLoad<AdminUser[]>(adminApi.users)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (data ?? []).filter((u) => !t || `${u.name} ${u.username} ${u.uid}`.toLowerCase().includes(t))
  }, [data, q])
  if (error) return <LoadError error={error} reload={reload} />
  return (
    <>
      <div className="adm-head">
        <h1>Pessoas</h1>
        <input className="adm-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, @ ou ID" />
      </div>
      {!data ? (
        <p className="hint">Carregando cadastros…</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th>Cadastro</th>
                <th>Último login</th>
                <th>Último dia ativo</th>
                <th className="num">Logins</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <UserRow key={u.uid} u={u} open={open === u.uid} onToggle={() => setOpen(open === u.uid ? null : u.uid)} reload={reload} />
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="hint">Ninguém encontrado.</p>}
        </div>
      )}
    </>
  )
}

function UserRow({ u, open, onToggle, reload }: { u: AdminUser; open: boolean; onToggle: () => void; reload: () => void }) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [mode, setMode] = useState<'none' | 'suspend' | 'delete'>('none')
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (open && !detail) adminApi.user(u.uid).then(setDetail).catch(() => {})
  }, [open, detail, u.uid])

  return (
    <>
      <tr className={u.suspended ? 'is-suspended' : ''}>
        <td>
          <span className="adm-person">
            {u.avatar ? <img className="avatar" src={u.avatar} alt="" width={28} height={28} /> : <b>{u.name.charAt(0)}</b>}
            <span>
              <strong>{u.name || u.uid}</strong>
              <small>@{u.username}</small>
            </span>
          </span>
        </td>
        <td>{fmtDate(u.firstAt)}</td>
        <td>{fmtDateTime(u.lastLoginAt)}</td>
        <td>{fmtDay(u.lastActiveDay)}</td>
        <td className="num">{n(u.logins)}</td>
        <td>
          {u.admin ? <span className="adm-tag admin">admin</span> : u.suspended ? <span className="adm-tag bad">suspensa</span> : <span className="adm-tag ok">ativa</span>}
        </td>
        <td className="adm-actions">
          <button type="button" className="link-btn" onClick={onToggle} aria-expanded={open}>
            {open ? 'Fechar' : 'Detalhes'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="adm-detail">
          <td colSpan={7}>
            <div className="adm-detail-grid">
              <div>
                <h4>Salas ({detail ? detail.rooms.length : '…'})</h4>
                {detail && detail.rooms.length === 0 && <p className="hint">Nenhuma.</p>}
                <ul>
                  {detail?.rooms.map((r) => (
                    <li key={r.roomId}>
                      {r.name} <span className="mono-code">{r.roomId}</span> {r.role === 'owner' && <span className="adm-tag">dono</span>}
                    </li>
                  ))}
                </ul>
                <p className="hint">
                  {detail ? `${detail.playlists} playlists pessoais` : ''} · ID <code>{u.uid}</code>
                  {u.suspended && ` · suspensa em ${fmtDateTime(u.suspended.at)}${u.suspended.reason ? `: ${u.suspended.reason}` : ''}`}
                </p>
              </div>
              {!u.admin && (
                <div className="adm-detail-actions">
                  {mode === 'suspend' ? (
                    <form
                      className="inline-field"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void act(() => adminApi.suspend(u.uid, reason), `${u.name} suspensa.`, reload)
                      }}
                    >
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" maxLength={200} autoFocus />
                      <button type="submit" className="btn btn-danger">
                        Suspender
                      </button>
                    </form>
                  ) : mode === 'delete' ? (
                    <div className="row">
                      <button type="button" className="btn btn-danger" onClick={() => act(() => adminApi.deleteUser(u.uid), 'Cadastro apagado.', reload)}>
                        Apagar de vez
                      </button>
                      <button type="button" className="link-btn" onClick={() => setMode('none')}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="row">
                      {u.suspended ? (
                        <button type="button" className="btn btn-primary" onClick={() => act(() => adminApi.unsuspend(u.uid), `${u.name} reativada.`, reload)}>
                          Reativar acesso
                        </button>
                      ) : (
                        <button type="button" className="btn btn-secondary" onClick={() => setMode('suspend')}>
                          Suspender acesso
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary" onClick={() => setMode('delete')}>
                        Apagar cadastro
                      </button>
                    </div>
                  )}
                  <p className="hint">
                    Suspender bloqueia login e uso na hora. Apagar remove perfil, lista de salas, playlists e convites; salas de que
                    era dono ficam sem dono.
                  </p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ---- salas ----------------------------------------------------------------------------

function RoomsTab() {
  const { data, error, reload } = useLoad<AdminRoom[]>(adminApi.rooms)
  const users = useLoad<AdminUser[]>(adminApi.users).data
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <LoadError error={error} reload={reload} />
  return (
    <>
      <div className="adm-head">
        <h1>Salas</h1>
        <span className="hint">Só dados gerais — o conteúdo (fila, músicas) não aparece aqui.</span>
      </div>
      {!data ? (
        <p className="hint">Carregando salas…</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Sala</th>
                <th>Dono</th>
                <th>Criada</th>
                <th className="num">Membros</th>
                <th className="num">Online</th>
                <th>Convidados</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <RoomRow key={r.roomId} r={r} users={users ?? []} open={open === r.roomId} onToggle={() => setOpen(open === r.roomId ? null : r.roomId)} reload={reload} />
              ))}
            </tbody>
          </table>
          {data.length === 0 && <p className="hint">Nenhuma sala.</p>}
        </div>
      )}
    </>
  )
}

function RoomRow({ r, users, open, onToggle, reload }: { r: AdminRoom; users: AdminUser[]; open: boolean; onToggle: () => void; reload: () => void }) {
  const [owner, setOwner] = useState('')
  const [confirm, setConfirm] = useState('')
  return (
    <>
      <tr>
        <td>
          <strong>{r.name}</strong> <span className="mono-code">{r.roomId}</span>
        </td>
        <td>{r.ownerName || <span className="hint">sem dono</span>}</td>
        <td>{fmtDate(r.createdAt)}</td>
        <td className="num">{n(r.members)}</td>
        <td className="num">{r.online ? <span className="adm-online">{n(r.online)}</span> : '0'}</td>
        <td>{r.allowGuests ? 'permitidos' : 'só Discord'}</td>
        <td className="adm-actions">
          <button type="button" className="link-btn" onClick={onToggle} aria-expanded={open}>
            {open ? 'Fechar' : 'Gerenciar'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="adm-detail">
          <td colSpan={7}>
            <div className="adm-detail-grid">
              <div>
                <h4>Trocar dono</h4>
                <div className="inline-field">
                  <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Novo dono">
                    <option value="">Escolha uma pessoa…</option>
                    {users
                      .filter((u) => !u.suspended)
                      .map((u) => (
                        <option key={u.uid} value={u.uid}>
                          {u.name} (@{u.username})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!owner}
                    onClick={() => act(() => adminApi.transferRoom(r.roomId, owner), 'Dono trocado.', reload)}
                  >
                    Trocar
                  </button>
                </div>
              </div>
              <div>
                <h4>Encerrar sala</h4>
                <p className="hint">
                  Apaga a sala para todos. Digite <strong className="mono-code">{r.roomId}</strong> para confirmar.
                </p>
                <div className="inline-field">
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} placeholder={r.roomId} />
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={confirm !== r.roomId}
                    onClick={() => act(() => adminApi.closeRoom(r.roomId), 'Sala encerrada.', reload)}
                  >
                    Encerrar
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ---- acesso ---------------------------------------------------------------------------

function AccessTab() {
  const { data, error, reload, setData } = useLoad<{ mode: AccessMode; requests: AdminRequest[] }>(adminApi.access)
  const users = useLoad<AdminUser[]>(adminApi.users)
  if (error) return <LoadError error={error} reload={reload} />
  if (!data) return <p className="hint">Carregando…</p>
  const suspended = (users.data ?? []).filter((u) => u.suspended)
  return (
    <>
      <div className="adm-head">
        <h1>Acesso</h1>
      </div>
      <section className="adm-card">
        <h3>Quem pode entrar com Discord</h3>
        <div className="seg seg-full adm-mode" role="radiogroup">
          {(
            [
              ['open', 'Aberto', 'Qualquer pessoa entra com Discord.'],
              ['approval', 'Por aprovação', 'Quem é novo pede acesso e você aprova aqui. Quem já tem cadastro continua entrando.'],
            ] as [AccessMode, string, string][]
          ).map(([m, label, hint]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={data.mode === m}
              className={data.mode === m ? 'on' : ''}
              title={hint}
              onClick={() => data.mode !== m && act(async () => setData(await adminApi.setAccess(m)), `Acesso: ${label.toLowerCase()}.`)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          {data.mode === 'open'
            ? 'Qualquer pessoa entra com Discord. Para barrar alguém, suspenda na aba Pessoas.'
            : 'Quem é novo pede acesso no login e espera a sua aprovação.'}{' '}
          Convidados sem Discord seguem as regras de cada sala.
        </p>
      </section>
      <section className="adm-card">
        <h3>Pedidos de acesso ({data.requests.length})</h3>
        {data.requests.length === 0 ? (
          <p className="hint">Nenhum pedido esperando.</p>
        ) : (
          <ul className="adm-list">
            {data.requests.map((r) => (
              <li key={r.uid}>
                <span className="adm-person">
                  {r.avatar ? <img className="avatar" src={r.avatar} alt="" width={28} height={28} /> : <b>{r.name.charAt(0)}</b>}
                  <span>
                    <strong>{r.name}</strong>
                    <small>
                      @{r.username} · pediu {fmtDateTime(r.at)}
                    </small>
                  </span>
                </span>
                <span className="row">
                  <button type="button" className="btn btn-primary" onClick={() => act(() => adminApi.decide(r.uid, true), `${r.name} aprovada.`, reload)}>
                    Aprovar
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => act(() => adminApi.decide(r.uid, false), 'Pedido recusado.', reload)}>
                    Recusar
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="adm-card">
        <h3>Suspensas ({suspended.length})</h3>
        {suspended.length === 0 ? (
          <p className="hint">Ninguém suspenso.</p>
        ) : (
          <ul className="adm-list">
            {suspended.map((u) => (
              <li key={u.uid}>
                <span className="adm-person">
                  {u.avatar ? <img className="avatar" src={u.avatar} alt="" width={28} height={28} /> : <b>{u.name.charAt(0)}</b>}
                  <span>
                    <strong>{u.name}</strong>
                    <small>
                      desde {fmtDateTime(u.suspended!.at)}
                      {u.suspended!.reason ? ` · ${u.suspended!.reason}` : ''}
                    </small>
                  </span>
                </span>
                <button type="button" className="btn btn-secondary" onClick={() => act(() => adminApi.unsuspend(u.uid), `${u.name} reativada.`, users.reload)}>
                  Reativar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

// ---- registro ---------------------------------------------------------------------------

function AuditTab() {
  const { data, error, reload } = useLoad<AuditEntry[]>(adminApi.audit)
  if (error) return <LoadError error={error} reload={reload} />
  return (
    <>
      <div className="adm-head">
        <h1>Registro de ações</h1>
        <span className="hint">As 200 ações mais recentes de administradores.</span>
      </div>
      {!data ? (
        <p className="hint">Carregando…</p>
      ) : data.length === 0 ? (
        <p className="hint">Nenhuma ação ainda.</p>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Ação</th>
                <th>Alvo</th>
                <th>Detalhe</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.at)}</td>
                  <td>{a.byName}</td>
                  <td>{a.action}</td>
                  <td>
                    <code>{a.target}</code>
                  </td>
                  <td>{a.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
