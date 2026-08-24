# Central de Mídia — Supabase + Cloudflare R2

Versão de produção pensada para vídeos brutos 4K/60 FPS de vários gigabytes, com interface responsiva para celular.

## Arquitetura

- **Supabase Auth**: login da equipe.
- **Supabase Database + Realtime**: perfis, lista de arquivos e atualização instantânea.
- **Cloudflare R2**: armazena os vídeos originais.
- **Cloudflare Worker**: API privada entre o site e o R2; a chave secreta nunca vai para o navegador.
- **Multipart upload**: vídeo dividido em partes, com retomada se a rede falhar ou a página for reaberta e o mesmo arquivo for selecionado novamente.

## Limites desta versão

O app aceita até **20 GiB por arquivo** por configuração. O R2 suporta objetos multipart muito maiores; esse limite é só uma trava de segurança do projeto e pode ser aumentado.

Cada parte usa normalmente **16 MiB**, com até **2 partes em paralelo**, bom para memória de celular e abaixo do limite de requisição da Cloudflare Free.

## 1. Supabase

1. Abra `supabase-setup.sql`.
2. Execute tudo no **SQL Editor**.
3. Em **Project > Connect**, copie:
   - Project URL
   - Publishable key (`sb_publishable_...`)
4. Em `config.js`, preencha `SUPABASE_URL` e `SUPABASE_KEY`.
5. Rode `CRIAR_4_USUARIOS.ps1` para criar os quatro usuários reais.

> A chave `sb_secret_...` é secreta. Nunca coloque em `config.js`, GitHub Pages ou qualquer JavaScript do site.

## 2. Cloudflare R2 + Worker

### Jeito mais fácil no Windows

Dê dois cliques em `CONFIGURAR_R2_WORKER.ps1` (ou abra pelo PowerShell). Ele instala o Wrangler, abre o login da Cloudflare, cria o bucket, pede as configurações e publica o Worker.

### Jeito manual

No PowerShell/Terminal:

```bash
cd worker
npm install
npx wrangler login
npx wrangler r2 bucket create ad-central-midia-originals
```

Edite `worker/wrangler.toml` e descomente `[vars]`, preenchendo:

```toml
[vars]
SUPABASE_URL = "https://SEU-PROJETO.supabase.co"
SUPABASE_PUBLISHABLE_KEY = "sb_publishable_..."
ALLOWED_ORIGINS = "https://SEU-USUARIO.github.io,http://localhost:5500"
```

Agora salve as duas informações secretas no Worker:

```bash
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put MEDIA_TOKEN_SECRET
```

- Em `SUPABASE_SECRET_KEY`, cole uma **Secret key** `sb_secret_...` do Supabase.
- Em `MEDIA_TOKEN_SECRET`, use uma senha aleatória longa (32+ caracteres). Não é a senha dos usuários.

Deploy:

```bash
npm run deploy
```

O Wrangler mostrará uma URL parecida com:

```text
https://ad-central-midia-api.seu-subdominio.workers.dev
```

Copie essa URL para `WORKER_URL` em `config.js`.

## 3. Publicar o site

Depois dos três valores em `config.js`, suba os arquivos da raiz para GitHub Pages/Cloudflare Pages.

Arquivos da pasta `worker/` ficam no projeto para deploy do backend; eles não precisam ser servidos pelo site estático.

## 4. Usuários iniciais

| Login | Senha | Cargo |
|---|---|---|
| lider | midia2026 | Líder |
| editor | editar2026 | Editor |
| camera1 | camera2026 | Membro |
| camera2 | camera2026 | Membro |

Troque as senhas após o primeiro teste.

## Como o upload funciona

1. O membro escolhe um `.MOV`/`.MP4` no celular.
2. O navegador calcula uma identificação do arquivo.
3. O Worker cria/retoma um multipart upload no R2.
4. O arquivo é enviado em partes de ~16 MiB, sem conversão.
5. Cada parte concluída é registrada no Supabase.
6. Se cair a internet, as partes prontas continuam válidas.
7. Ao selecionar o mesmo arquivo novamente, o app retoma as partes faltantes.
8. Quando termina, o Worker finaliza o objeto no R2 e cria `media_files`.
9. O Realtime faz o arquivo aparecer na tela do editor.

## Download

O bucket R2 fica privado. O site pede ao Worker um link temporário de 10 minutos e o Worker transmite o arquivo original, inclusive com suporte a `Range` para downloads grandes.

## Segurança

- O navegador só contém URL + chave **publishable** do Supabase.
- `SUPABASE_SECRET_KEY` existe apenas como secret do Worker.
- R2 é acessado somente via binding `MEDIA_BUCKET`.
- Download usa token temporário HMAC.
- Exclusão é permitida apenas ao autor do arquivo ou ao perfil `leader`.
