# Serviço de login do EchoRoom (Cloudflare Workers)

O site é estático (GitHub Pages), então quem confirma o login do Discord é este
pequeno serviço gratuito. Ele recebe o `code` que o Discord manda de volta,
confere com o Discord usando o **Client Secret** (que só existe aqui) e devolve
um token do Firebase. A partir daí o banco sabe com certeza quem é cada pessoa:
é isso que protege o dono da sala, os perfis e os convites.

Pede ao Discord só o escopo `identify` (id, nome, usuário e avatar). Não guarda nada.

## Configuração (uma vez, ~15 minutos)

Você vai juntar três segredos e colar no Cloudflare. **Nenhum deles vai para o
GitHub nem para o chat.**

### 1. Discord: Client Secret

1. https://discord.com/developers/applications → seu app → **OAuth2**.
2. Em **Client Secret**, clique em **Reset Secret** e copie o valor (ele aparece uma vez só).
3. Confira em **Redirects** que está exatamente `https://gustavotoigo-max.github.io/EchoRoom/`.

### 2. Firebase: conta de serviço

1. Console do Firebase → ⚙ **Configurações do projeto** → aba **Contas de serviço**.
2. **Gerar nova chave privada** → **Gerar chave**. Baixa um arquivo `.json`.
3. Guarde esse arquivo com cuidado: ele dá acesso total ao projeto.

### 3. Cloudflare: criar o serviço

1. Crie uma conta grátis em https://dash.cloudflare.com (não pede cartão).
2. Menu **Workers & Pages** (às vezes em **Compute**) → **Create** → **Create Worker**
   (modelo "Hello World").
3. Nome: `echoroom-auth` → **Deploy**.
4. **Edit code**: apague tudo, cole o conteúdo de [`worker.js`](worker.js)
   (no GitHub, abra o arquivo → botão **Raw** → copie tudo) → **Deploy**.
5. Volte ao worker → **Settings** → **Variables and Secrets** → **Add**, uma de cada vez:

   | Nome | Tipo | Valor |
   |---|---|---|
   | `DISCORD_CLIENT_ID` | Text | o Client ID do app do Discord |
   | `ALLOWED_ORIGIN` | Text | `https://gustavotoigo-max.github.io` (sem barra no fim) |
   | `DISCORD_CLIENT_SECRET` | **Secret** | o Client Secret do passo 1 |
   | `FIREBASE_SERVICE_ACCOUNT` | **Secret** | o conteúdo inteiro do `.json` do passo 2 (abra no Bloco de Notas, Ctrl+A, Ctrl+C) |

   Clique em **Deploy** / **Save** no fim.
6. Abra o endereço do worker (algo como `https://echoroom-auth.SEU-NOME.workers.dev`).
   Deve aparecer um texto com `"configured"` e **todos os itens `true`**.

### 4. GitHub: avisar o site

Repositório → **Settings** → **Secrets and variables** → **Actions** → aba
**Variables** → **New repository variable**:

- **Name:** `AUTH_URL`
- **Value:** o endereço do worker, ex.: `https://echoroom-auth.SEU-NOME.workers.dev` (sem barra no fim)

### 5. Firebase: regras novas

Depois que o site novo for publicado: Realtime Database → **Regras** → apague
tudo, cole o conteúdo de [`database.rules.json`](../database.rules.json) → **Publicar**.

## Se algo der errado

- Mensagem "O serviço de login ainda não foi configurado": falta alguma variável (veja o passo 3.6).
- "não reconhece este site": `ALLOWED_ORIGIN` diferente de `https://gustavotoigo-max.github.io`.
- "O Discord recusou o login": Client Secret errado ou o endereço de retorno do passo 1.3.
- "conta de serviço errada": o JSON colado em `FIREBASE_SERVICE_ACCOUNT` é de outro projeto ou está incompleto.
