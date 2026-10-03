# Backend do EchoRoom (Cloudflare Workers)

O site é estático (GitHub Pages). Tudo que precisa de segredo ou de autoridade
fica aqui, num Worker gratuito do Cloudflare:

| Rota | O que faz |
|---|---|
| `GET /` | Diagnóstico: mostra o que falta configurar (sem revelar segredos) |
| `POST /discord` | Login: troca o `code` do Discord por um token do Firebase; confere suspensão e modo de acesso; registra o cadastro |
| `/admin/...` | Administração (só para quem está em `ADMIN_UIDS`): visão geral, pessoas, salas, acesso, registro |
| rotina diária | Totais do dia e limpeza de atividade antiga |

O backend usa a conta de serviço do Firebase para ler e escrever no banco como
administrador. O site nunca recebe o Client Secret, a conta de serviço nem o
token do Discord. A API de administração não devolve o conteúdo das salas.

```text
src/
  index.ts        rotas e rotina diária
  routes/login.ts login com Discord
  routes/admin.ts administração
  discord.ts      OAuth do Discord
  google.ts       tokens do Firebase/Google (assinar, verificar)
  crypto.ts       JWT RS256 com WebCrypto
  db.ts           Realtime Database via REST
  stats.ts        estatísticas de uso
  env.ts, http.ts configuração e respostas
tests/            testes com Discord, Google e banco simulados
```

## Variáveis (Cloudflare → Workers → echoroom-auth → Settings → Variables and Secrets)

| Nome | Tipo | Valor |
|---|---|---|
| `DISCORD_CLIENT_ID` | Text | Client ID do app do Discord |
| `ALLOWED_ORIGIN` | Text | `https://gustavotoigo-max.github.io` |
| `ADMIN_UIDS` | Text | seu ID no EchoRoom (aparece na página `/admin`), ex.: `discord_123…` — vários separados por vírgula |
| `DISCORD_CLIENT_SECRET` | **Secret** | Client Secret do Discord |
| `FIREBASE_SERVICE_ACCOUNT` | **Secret** | conteúdo inteiro do JSON da conta de serviço |

## Publicação automática (GitHub Actions)

O workflow `.github/workflows/api.yml` testa e publica o backend sempre que
algo em `apps/api` muda. Para ele publicar, crie uma vez:

1. **Token do Cloudflare:** painel do Cloudflare → ícone de perfil → **My Profile** →
   **API Tokens** → **Create Token** → modelo **Edit Cloudflare Workers** →
   **Continue to summary** → **Create Token**. Copie o token (aparece uma vez só).
2. **ID da conta:** no painel, em **Workers & Pages**, à direita, **Account ID** → copiar.
3. **GitHub:** repositório → **Settings** → **Secrets and variables** → **Actions** →
   aba **Secrets** → **New repository secret**, duas vezes:
   - `CLOUDFLARE_API_TOKEN` = o token do passo 1
   - `CLOUDFLARE_ACCOUNT_ID` = o ID do passo 2
4. **Actions** → **Deploy backend (Cloudflare)** → **Run workflow**.

O deploy mantém as variáveis e segredos do painel (`keep_vars = true`) e usa o
mesmo worker (`echoroom-auth`), então o endereço não muda.

## Rodando localmente

```bash
npm install
npm test -w apps/api      # testes
npm run dev -w apps/api   # wrangler dev (precisa das variáveis num .dev.vars)
```
