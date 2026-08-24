/* ============================================================
   CENTRAL DE MÍDIA — PRODUÇÃO (SUPABASE + CLOUDFLARE R2)
   ------------------------------------------------------------
   Estes 3 valores são públicos e podem ficar no site.
   NUNCA coloque a SUPABASE_SECRET_KEY aqui.
============================================================ */

window.MEDIA_CONFIG = {
  // Supabase > Connect
  SUPABASE_URL: "",
  SUPABASE_KEY: "", // sb_publishable_... (ou anon legado)

  // URL publicada do Cloudflare Worker.
  // Ex.: https://ad-central-midia-api.seu-subdominio.workers.dev
  WORKER_URL: "",

  // Login curto: "lider" vira lider@midia.adpc.app
  AUTH_EMAIL_DOMAIN: "midia.adpc.app",

  CHURCH_NAME: "Assembleia de Deus",
  CHURCH_MINISTRY: "Ministério Praia dos Cações",
  APP_NAME: "Central de Mídia",

  // Limite lógico do app. R2 multipart suporta muito mais que isso.
  // 20 GiB deixa folga de sobra para vídeos 4K 60 FPS do culto.
  MAX_UPLOAD_BYTES: 20 * 1024 * 1024 * 1024,

  // Partes pequenas o suficiente para celular e abaixo do limite
  // de 100 MB por requisição do plano Free da Cloudflare.
  BASE_PART_SIZE: 16 * 1024 * 1024,
  MAX_PARALLEL_PARTS: 2
};
