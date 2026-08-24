# Patch Web Push — Central de Mídia

Adiciona Web Push ao PWA da equipe de mídia.

## Incluído

- botão de sino no cabeçalho;
- inscrição Push por aparelho e por usuário;
- subscriptions armazenadas no Supabase `MIDIA`;
- VAPID no Cloudflare Worker;
- push automático quando um upload termina;
- texto diferente para foto e vídeo;
- toque na notificação abre a área de arquivos;
- badge do PWA quando suportado;
- endpoints mortos (404/410) são desativados automaticamente;
- o remetente do arquivo não recebe seu próprio aviso.

## Instalação

Substitua `index.html`, `styles.css`, `icons.js`, `app.js`, `sw.js` e a pasta `worker/`.

Depois execute no Windows PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\CONFIGURAR_PUSH_E_DEPLOY.ps1
```

O script preserva as chaves VAPID se os dois secrets já existirem no Worker, evitando invalidar inscrições existentes.

## iPhone

No iOS, Web Push funciona para o web app salvo na Tela de Início. A permissão é solicitada somente depois do toque no botão de notificações.
