/* CENTRAL DE MÍDIA — configuração pública do site */
window.MEDIA_CONFIG = {
  // O navegador fala apenas com o Worker. As chaves privadas ficam na Cloudflare.
  WORKER_URL: "https://ad-central-midia-api.adpdc.workers.dev",

  CHURCH_NAME: "Assembleia de Deus",
  CHURCH_MINISTRY: "Ministério Praia dos Cações",
  APP_NAME: "Central de Mídia",

  MAX_UPLOAD_BYTES: 20 * 1024 * 1024 * 1024,
  BASE_PART_SIZE: 16 * 1024 * 1024,
  MAX_PARALLEL_PARTS: 2
};
