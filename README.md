# Central de Mídia — R2 + login por usuário

Versão sem e-mail e sem Supabase Auth.

## Login inicial
- `lider` / `midia2026` — Líder
- `editor` / `editar2026` — Editor
- `camera1` / `camera2026` — Membro
- `camera2` / `camera2026` — Membro

As senhas são armazenadas no Supabase apenas como hash bcrypt. O navegador recebe um token aleatório de sessão; o banco e o bucket R2 ficam atrás do Cloudflare Worker.

## Backend
- Supabase `MIDIA`: contas, sessões e metadados.
- Cloudflare R2: vídeos originais.
- Cloudflare Worker: autenticação, upload multipart, download e exclusão.

## Depois de alterar o Worker
Na pasta `worker`:
```powershell
Set-ExecutionPolicy -Scope Process Bypass
npx wrangler deploy
```

O `config.js` já aponta para `https://ad-central-midia-api.adpdc.workers.dev`.

## Correção 24/08/2026
Esta revisão corrige a configuração do Worker para definir explicitamente `SUPABASE_URL` no `wrangler.toml`.
O endpoint `/health` agora informa, sem revelar segredos, se R2, URL do Supabase e os dois secrets necessários estão carregados.
Para publicar, execute `DEPLOY_AGORA.ps1` na raiz desta pasta.
