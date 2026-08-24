import { buildPushPayload } from "@block65/webcrypto-web-push";

const MiB = 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024 * 1024; // 20 GiB do app
const MIN_PART_SIZE = 5 * MiB;
const MAX_PARTS = 10000;
const DOWNLOAD_TOKEN_TTL_SECONDS = 10 * 60;
const PREVIEW_TOKEN_TTL_SECONDS = 60 * 60;
const UPLOAD_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/" || path === "/health") {
        const checks = {
          r2: Boolean(env.MEDIA_BUCKET),
          supabaseUrl: Boolean(env.SUPABASE_URL),
          supabaseSecret: Boolean(env.SUPABASE_SECRET_KEY),
          tokenSecret: Boolean(env.MEDIA_TOKEN_SECRET),
          vapidPublic: Boolean(env.VAPID_PUBLIC_KEY),
          vapidPrivate: Boolean(env.VAPID_PRIVATE_KEY)
        };
        const ready = Object.values(checks).every(Boolean);
        return json({
          ok: ready,
          ready,
          service: "AD Central de Mídia R2",
          checks,
          time: new Date().toISOString()
        }, ready ? 200 : 503, cors);
      }

      if (path === "/api/auth/login" && request.method === "POST") {
        return await handleLogin(request, env, cors);
      }

      if (path.startsWith("/api/download/") && request.method === "GET") {
        return await handleDownload(request, env, path, cors);
      }

      if (path.startsWith("/api/preview/") && request.method === "GET") {
        return await handlePreview(request, env, path, cors);
      }

      // Partes grandes usam um token temporário específico do upload.
      // Assim não precisamos consultar o Supabase Auth a cada chunk de 16 MiB.
      let match = path.match(/^\/api\/uploads\/([0-9a-f-]+)\/parts\/(\d+)$/i);
      if (match && request.method === "PUT") {
        const uploadAuth = await requireUploadToken(request, env, match[1]);
        return await handleUploadPart(request, env, uploadAuth.userId, match[1], Number(match[2]), cors);
      }

      match = path.match(/^\/api\/uploads\/([0-9a-f-]+)\/thumbnail$/i);
      if (match && request.method === "PUT") {
        const uploadAuth = await requireUploadToken(request, env, match[1]);
        return await handleUploadThumbnail(request, env, uploadAuth.userId, match[1], cors);
      }

      match = path.match(/^\/api\/uploads\/([0-9a-f-]+)\/complete$/i);
      if (match && request.method === "POST") {
        const uploadAuth = await requireUploadToken(request, env, match[1]);
        return await handleCompleteUpload(env, uploadAuth.userId, match[1], cors, ctx);
      }

      match = path.match(/^\/api\/uploads\/([0-9a-f-]+)\/abort$/i);
      if (match && request.method === "POST") {
        const uploadAuth = await requireUploadToken(request, env, match[1]);
        return await handleAbortUpload(env, uploadAuth.userId, match[1], cors);
      }

      const user = await requireUser(request, env);
      const profile = user;

      if (path === "/api/auth/me" && request.method === "GET") {
        return json({ user: publicUser(user) }, 200, cors);
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        return await handleLogout(request, env, cors);
      }

      if (path === "/api/push/public-key" && request.method === "GET") {
        if (!env.VAPID_PUBLIC_KEY) throw httpError(503, "Web Push ainda não foi configurado no Worker.");
        return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, cors);
      }

      if (path === "/api/push/subscribe" && request.method === "POST") {
        return await handlePushSubscribe(request, env, user, cors);
      }

      if (path === "/api/push/subscribe" && request.method === "DELETE") {
        return await handlePushUnsubscribe(request, env, user, cors);
      }

      if (path === "/api/files" && request.method === "GET") {
        const rows = await db(env, "media_files", {
          query: "select=id,uploader_id,uploader_name,original_name,title,category,media_kind,thumbnail_path,storage_path,mime_type,size_bytes,service_date,created_at&order=created_at.desc&limit=500"
        });
        const files = await Promise.all((rows || []).map(async (row) => ({
          ...row,
          thumbnail_url: row.thumbnail_path ? await buildPreviewUrl(request, env, row.id) : null
        })));
        return json({ files }, 200, cors);
      }

      if (path === "/api/uploads/init" && request.method === "POST") {
        return await handleInitUpload(request, env, user, profile, cors);
      }

      if (path === "/api/uploads/resume" && request.method === "GET") {
        return await handleResumeUpload(url, env, user, cors);
      }

      match = path.match(/^\/api\/files\/([0-9a-f-]+)\/download-token$/i);
      if (match && request.method === "POST") {
        return await handleDownloadToken(request, env, user, match[1], cors);
      }

      match = path.match(/^\/api\/files\/([0-9a-f-]+)$/i);
      if (match && request.method === "DELETE") {
        return await handleDeleteFile(env, user, profile, match[1], cors);
      }

      return json({ error: "Rota não encontrada." }, 404, cors);
    } catch (error) {
      const status = Number(error?.status || 500);
      const message = status >= 500 ? "Erro interno da API." : (error?.message || "Erro na requisição.");
      if (status >= 500) console.error(error);
      return json({ error: message }, status, cors);
    }
  }
};

async function handleInitUpload(request, env, user, profile, cors) {
  const body = await request.json().catch(() => ({}));
  const originalName = cleanOriginalName(body.name);
  const size = Number(body.size || 0);
  const mime = String(body.type || "application/octet-stream").slice(0, 150);
  const serviceDate = validateDate(body.serviceDate);
  const fingerprint = String(body.fingerprint || "").slice(0, 200);
  const mediaKind = validateMediaKind(body.mediaKind, mime, originalName);
  const title = cleanTitle(body.title || originalName);
  const category = validateCategory(body.category);
  let partSize = Number(body.partSize || 16 * MiB);

  if (!originalName) throw httpError(400, "Nome do arquivo inválido.");
  if (!size || size < 1) throw httpError(400, "Arquivo vazio ou tamanho inválido.");
  if (size > MAX_FILE_BYTES) throw httpError(413, "O app está configurado para arquivos de até 20 GiB.");
  if (!fingerprint) throw httpError(400, "Fingerprint do arquivo ausente.");

  partSize = normalizePartSize(size, partSize);

  const existing = await findResumableUpload(env, user.id, fingerprint);
  if (existing && Number(existing.size_bytes) === size && existing.original_name === originalName) {
    await db(env, "media_uploads", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(existing.id)}`,
      body: { title, category, media_kind: mediaKind, updated_at: new Date().toISOString() },
      prefer: "return=minimal"
    });
    existing.title = title;
    existing.category = category;
    existing.media_kind = mediaKind;
    const parts = await getUploadParts(env, existing.id);
    return json({ resumed: true, upload: await publicUpload(existing, parts, env) }, 200, cors);
  }

  const safe = safeFileName(originalName);
  const objectKey = `${serviceDate}/${user.id}/${mediaKind === "photo" ? "photos" : "videos"}/${crypto.randomUUID()}-${safe}`;
  const multipart = await env.MEDIA_BUCKET.createMultipartUpload(objectKey, {
    httpMetadata: {
      contentType: mime || "application/octet-stream",
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      cacheControl: "private, max-age=0, no-store"
    },
    customMetadata: {
      originalName: originalName.slice(0, 512),
      title: title.slice(0, 100),
      category,
      mediaKind,
      uploaderId: user.id,
      serviceDate
    }
  });

  const rows = await db(env, "media_uploads", {
    method: "POST",
    query: "select=id,uploader_id,uploader_name,fingerprint,original_name,title,category,media_kind,thumbnail_path,object_key,r2_upload_id,mime_type,size_bytes,part_size,service_date,status,created_at",
    body: {
      uploader_id: user.id,
      uploader_name: profile?.name || "Membro",
      fingerprint,
      original_name: originalName,
      title,
      category,
      media_kind: mediaKind,
      object_key: objectKey,
      r2_upload_id: multipart.uploadId,
      mime_type: mime,
      size_bytes: size,
      part_size: partSize,
      service_date: serviceDate,
      status: "uploading"
    },
    prefer: "return=representation"
  });

  const row = Array.isArray(rows) ? rows[0] : rows;
  return json({ resumed: false, upload: await publicUpload(row, [], env) }, 201, cors);
}

async function handleResumeUpload(url, env, user, cors) {
  const fingerprint = String(url.searchParams.get("fingerprint") || "").slice(0, 200);
  if (!fingerprint) throw httpError(400, "Fingerprint ausente.");
  const upload = await findResumableUpload(env, user.id, fingerprint);
  if (!upload) return json({ upload: null }, 200, cors);
  const parts = await getUploadParts(env, upload.id);
  return json({ upload: await publicUpload(upload, parts, env) }, 200, cors);
}

async function handleUploadPart(request, env, userId, uploadId, partNumber, cors) {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
    throw httpError(400, "Número de parte inválido.");
  }
  const upload = await getUploadForUser(env, uploadId, userId);
  if (upload.status !== "uploading") throw httpError(409, "Este upload não está mais ativo.");

  const expectedParts = Math.ceil(Number(upload.size_bytes) / Number(upload.part_size));
  if (partNumber > expectedParts) throw httpError(400, "Parte fora do arquivo.");

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  const isLast = partNumber === expectedParts;
  const expectedSize = isLast
    ? Number(upload.size_bytes) - Number(upload.part_size) * (expectedParts - 1)
    : Number(upload.part_size);

  if (contentLength && contentLength !== expectedSize) {
    throw httpError(400, `Parte ${partNumber} com tamanho incorreto.`);
  }
  if (!isLast && expectedSize < MIN_PART_SIZE) throw httpError(400, "Parte abaixo de 5 MiB.");

  const multipart = env.MEDIA_BUCKET.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
  let uploaded;
  try {
    uploaded = await multipart.uploadPart(partNumber, request.body);
  } catch (error) {
    console.error("R2 uploadPart", error);
    throw httpError(502, "O R2 recusou uma parte do arquivo. O app pode tentar novamente.");
  }

  await db(env, "media_upload_parts", {
    method: "POST",
    query: "on_conflict=upload_id,part_number",
    body: {
      upload_id: upload.id,
      part_number: uploaded.partNumber,
      etag: uploaded.etag,
      size_bytes: expectedSize,
      uploaded_at: new Date().toISOString()
    },
    prefer: "resolution=merge-duplicates,return=minimal"
  });

  await db(env, "media_uploads", {
    method: "PATCH",
    query: `id=eq.${encodeURIComponent(upload.id)}`,
    body: { updated_at: new Date().toISOString() },
    prefer: "return=minimal"
  });

  return json({ ok: true, partNumber: uploaded.partNumber, etag: uploaded.etag, size: expectedSize }, 200, cors);
}

async function handleUploadThumbnail(request, env, userId, uploadId, cors) {
  const upload = await getUploadForUser(env, uploadId, userId);
  if (upload.status !== "uploading") throw httpError(409, "Este upload não está mais ativo.");

  const contentType = String(request.headers.get("Content-Type") || "image/jpeg").toLowerCase();
  if (!contentType.startsWith("image/")) throw httpError(415, "A miniatura precisa ser uma imagem.");

  const body = await request.arrayBuffer();
  if (!body.byteLength) throw httpError(400, "Miniatura vazia.");
  if (body.byteLength > 2 * MiB) throw httpError(413, "Miniatura acima de 2 MiB.");

  const thumbnailKey = `${upload.service_date}/${upload.uploader_id}/thumbnails/${upload.id}.jpg`;
  await env.MEDIA_BUCKET.put(thumbnailKey, body, {
    httpMetadata: {
      contentType: "image/jpeg",
      cacheControl: "private, max-age=3600"
    },
    customMetadata: {
      uploadId: upload.id,
      mediaKind: upload.media_kind || "video"
    }
  });

  await db(env, "media_uploads", {
    method: "PATCH",
    query: `id=eq.${encodeURIComponent(upload.id)}`,
    body: { thumbnail_path: thumbnailKey, updated_at: new Date().toISOString() },
    prefer: "return=minimal"
  });

  return json({ ok: true, thumbnailPath: thumbnailKey }, 200, cors);
}

async function handleCompleteUpload(env, userId, uploadId, cors, ctx) {
  const upload = await getUploadForUser(env, uploadId, userId);
  if (upload.status === "completed") {
    const existing = await db(env, "media_files", {
      query: `storage_path=eq.${encodeURIComponent(upload.object_key)}&select=*`
    });
    return json({ ok: true, file: existing?.[0] || null, alreadyCompleted: true }, 200, cors);
  }
  if (upload.status !== "uploading") throw httpError(409, "Upload não está ativo.");

  const parts = await getUploadParts(env, upload.id);
  const expectedParts = Math.ceil(Number(upload.size_bytes) / Number(upload.part_size));
  if (parts.length !== expectedParts) {
    throw httpError(409, `Ainda faltam partes do arquivo (${parts.length}/${expectedParts}).`);
  }

  for (let i = 0; i < expectedParts; i++) {
    if (Number(parts[i]?.part_number) !== i + 1) throw httpError(409, `A parte ${i + 1} ainda não foi registrada.`);
  }

  let object = await env.MEDIA_BUCKET.head(upload.object_key);
  if (!object) {
    const multipart = env.MEDIA_BUCKET.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
    try {
      object = await multipart.complete(parts.map(p => ({ partNumber: Number(p.part_number), etag: p.etag })));
    } catch (error) {
      object = await env.MEDIA_BUCKET.head(upload.object_key);
      if (!object) {
        console.error("R2 complete", error);
        throw httpError(502, "Não foi possível finalizar o arquivo no R2. Tente novamente.");
      }
    }
  }

  const fileRows = await db(env, "media_files", {
    method: "POST",
    query: "on_conflict=storage_path&select=id,uploader_id,uploader_name,original_name,title,category,media_kind,thumbnail_path,storage_path,mime_type,size_bytes,service_date,created_at",
    body: {
      uploader_id: upload.uploader_id,
      uploader_name: upload.uploader_name,
      original_name: upload.original_name,
      title: upload.title || cleanTitle(upload.original_name),
      category: upload.category || "outro",
      media_kind: upload.media_kind || "video",
      thumbnail_path: upload.thumbnail_path || null,
      storage_path: upload.object_key,
      mime_type: upload.mime_type,
      size_bytes: Number(object?.size || upload.size_bytes),
      service_date: upload.service_date
    },
    prefer: "resolution=merge-duplicates,return=representation"
  });

  await db(env, "media_uploads", {
    method: "PATCH",
    query: `id=eq.${encodeURIComponent(upload.id)}`,
    body: { status: "completed", updated_at: new Date().toISOString() },
    prefer: "return=minimal"
  });

  await db(env, "media_upload_parts", {
    method: "DELETE",
    query: `upload_id=eq.${encodeURIComponent(upload.id)}`,
    prefer: "return=minimal"
  });

  const completedFile = Array.isArray(fileRows) ? fileRows[0] : fileRows;
  if (completedFile && ctx?.waitUntil) {
    ctx.waitUntil(sendNewMediaPush(env, completedFile, upload.uploader_id).catch((error) => {
      console.error("Web Push", error);
    }));
  }

  return json({ ok: true, file: completedFile }, 200, cors);
}

async function handleAbortUpload(env, userId, uploadId, cors) {
  const upload = await getUploadForUser(env, uploadId, userId);
  if (upload.status === "uploading") {
    try {
      const multipart = env.MEDIA_BUCKET.resumeMultipartUpload(upload.object_key, upload.r2_upload_id);
      await multipart.abort();
    } catch (error) {
      console.warn("R2 abort ignored", error);
    }
    if (upload.thumbnail_path) {
      try { await env.MEDIA_BUCKET.delete(upload.thumbnail_path); } catch {}
    }
    await db(env, "media_uploads", {
      method: "PATCH",
      query: `id=eq.${encodeURIComponent(upload.id)}`,
      body: { status: "aborted", updated_at: new Date().toISOString() },
      prefer: "return=minimal"
    });
  }
  return json({ ok: true }, 200, cors);
}

async function handlePushSubscribe(request, env, user, cors) {
  const body = await request.json().catch(() => ({}));
  const endpoint = String(body?.endpoint || "").trim();
  const p256dh = String(body?.keys?.p256dh || "").trim();
  const auth = String(body?.keys?.auth || "").trim();

  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw httpError(400, "Inscrição de notificação inválida.");
  }
  if (endpoint.length > 3000 || p256dh.length > 512 || auth.length > 512) {
    throw httpError(400, "Inscrição de notificação inválida.");
  }

  await db(env, "media_push_subscriptions", {
    method: "POST",
    query: "on_conflict=endpoint",
    body: {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: String(request.headers.get("User-Agent") || "").slice(0, 500),
      active: true,
      updated_at: new Date().toISOString()
    },
    prefer: "resolution=merge-duplicates,return=minimal"
  });

  return json({ ok: true }, 200, cors);
}

async function handlePushUnsubscribe(request, env, user, cors) {
  const body = await request.json().catch(() => ({}));
  const endpoint = String(body?.endpoint || "").trim();
  if (!endpoint) throw httpError(400, "Endpoint ausente.");

  await db(env, "media_push_subscriptions", {
    method: "DELETE",
    query: `user_id=eq.${encodeURIComponent(user.id)}&endpoint=eq.${encodeURIComponent(endpoint)}`,
    prefer: "return=minimal"
  });
  return json({ ok: true }, 200, cors);
}

async function sendNewMediaPush(env, file, uploaderId) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;

  const subscriptions = await db(env, "media_push_subscriptions", {
    query: `active=eq.true&user_id=neq.${encodeURIComponent(uploaderId)}&select=id,user_id,endpoint,p256dh,auth&limit=100`
  });
  if (!subscriptions?.length) return;

  const kind = file.media_kind === "photo" ? "foto" : "vídeo";
  const title = file.media_kind === "photo" ? "Nova foto recebida" : "Novo vídeo recebido";
  const displayTitle = cleanTitle(file.title || file.original_name || "Novo arquivo");
  const body = `${displayTitle} • ${file.uploader_name || "Equipe de Mídia"}`;
  const data = JSON.stringify({
    title,
    body,
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    tag: `media-${file.id}`,
    url: `./#filesSection`,
    fileId: file.id,
    kind,
    category: file.category || "outro"
  });

  const vapid = {
    subject: env.VAPID_SUBJECT || "https://ad-central-midia-api.adpdc.workers.dev",
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY
  };

  await Promise.allSettled(subscriptions.map(async (sub) => {
    try {
      const payload = await buildPushPayload({ data, options: { ttl: 300 } }, {
        endpoint: sub.endpoint,
        expirationTime: null,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, vapid);
      const response = await fetch(sub.endpoint, payload);
      if (response.status === 404 || response.status === 410) {
        await db(env, "media_push_subscriptions", {
          method: "PATCH",
          query: `id=eq.${encodeURIComponent(sub.id)}`,
          body: { active: false, updated_at: new Date().toISOString() },
          prefer: "return=minimal"
        });
      } else if (!response.ok) {
        console.warn("Push endpoint", response.status, await response.text().catch(() => ""));
      }
    } catch (error) {
      console.warn("Push send failed", sub.id, error);
    }
  }));
}

async function handleDownloadToken(request, env, user, fileId, cors) {
  const file = await getFileById(env, fileId);
  if (!file) throw httpError(404, "Arquivo não encontrado.");
  const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS;
  const payload = `${file.id}.${user.id}.${exp}`;
  const signature = await hmacSign(env.MEDIA_TOKEN_SECRET, payload);
  const token = `${base64url(payload)}.${signature}`;
  const base = new URL(request.url);
  const downloadUrl = `${base.origin}/api/download/${encodeURIComponent(file.id)}?token=${encodeURIComponent(token)}`;
  return json({ url: downloadUrl, expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS }, 200, cors);
}

async function handleDownload(request, env, path, cors) {
  const fileId = path.split("/").pop();
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const verified = await verifyDownloadToken(env.MEDIA_TOKEN_SECRET, token, fileId);
  if (!verified) throw httpError(401, "Link de download inválido ou expirado.");

  const file = await getFileById(env, fileId);
  if (!file) throw httpError(404, "Arquivo não encontrado.");

  const object = await env.MEDIA_BUCKET.get(file.storage_path, { range: request.headers });
  if (!object) throw httpError(404, "Arquivo não encontrado no R2.");

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", file.mime_type || object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("Content-Disposition", contentDispositionAttachment(downloadDisplayName(file)));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("ETag", object.httpEtag);

  let status = 200;
  if (object.range) {
    status = 206;
    const offset = Number(object.range.offset || 0);
    const length = Number(object.range.length || 0);
    headers.set("Content-Range", `bytes ${offset}-${offset + Math.max(0, length - 1)}/${object.size}`);
    headers.set("Content-Length", String(length));
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, { status, headers });
}

async function handlePreview(request, env, path, cors) {
  const fileId = path.split("/").pop();
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const verified = await verifyPreviewToken(env.MEDIA_TOKEN_SECRET, token, fileId);
  if (!verified) throw httpError(401, "Prévia expirada.");

  const file = await getFileById(env, fileId);
  if (!file?.thumbnail_path) throw httpError(404, "Miniatura não encontrada.");
  const object = await env.MEDIA_BUCKET.get(file.thumbnail_path);
  if (!object) throw httpError(404, "Miniatura não encontrada no R2.");

  const headers = new Headers(cors);
  headers.set("Content-Type", object.httpMetadata?.contentType || "image/jpeg");
  headers.set("Content-Disposition", "inline");
  headers.set("Cache-Control", "private, max-age=1800");
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}

async function handleDeleteFile(env, user, profile, fileId, cors) {
  const file = await getFileById(env, fileId);
  if (!file) throw httpError(404, "Arquivo não encontrado.");
  const allowed = file.uploader_id === user.id || profile?.role === "leader";
  if (!allowed) throw httpError(403, "Somente o autor ou o líder pode excluir este arquivo.");

  const toDelete = [file.storage_path, file.thumbnail_path].filter(Boolean);
  if (toDelete.length) await env.MEDIA_BUCKET.delete(toDelete);
  await db(env, "media_files", {
    method: "DELETE",
    query: `id=eq.${encodeURIComponent(file.id)}`,
    prefer: "return=minimal"
  });
  return json({ ok: true }, 200, cors);
}

async function handleLogin(request, env, cors) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username) || !password) {
    throw httpError(401, "Usuário ou senha incorretos.");
  }

  const rows = await rpc(env, "media_check_credentials", {
    p_username: username,
    p_password: password
  });
  const user = Array.isArray(rows) ? rows[0] : null;
  if (!user) throw httpError(401, "Usuário ou senha incorretos.");

  const rawToken = randomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db(env, "media_sessions", {
    method: "POST",
    body: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    },
    prefer: "return=minimal"
  });

  return json({ token: rawToken, expiresAt, user: publicUser(user) }, 200, cors);
}

async function handleLogout(request, env, cors) {
  const token = bearerToken(request);
  if (token) {
    const tokenHash = await sha256Hex(token);
    await db(env, "media_sessions", {
      method: "DELETE",
      query: `token_hash=eq.${encodeURIComponent(tokenHash)}`,
      prefer: "return=minimal"
    });
  }
  return json({ ok: true }, 200, cors);
}

async function requireUser(request, env) {
  const token = bearerToken(request);
  if (!token) throw httpError(401, "Entre na Central de Mídia novamente.");

  const tokenHash = await sha256Hex(token);
  const sessions = await db(env, "media_sessions", {
    query: `token_hash=eq.${encodeURIComponent(tokenHash)}&select=user_id,expires_at&limit=1`
  });
  const session = sessions?.[0];
  if (!session) throw httpError(401, "Sessão expirada ou inválida.");
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await db(env, "media_sessions", {
      method: "DELETE",
      query: `token_hash=eq.${encodeURIComponent(tokenHash)}`,
      prefer: "return=minimal"
    });
    throw httpError(401, "Sessão expirada. Entre novamente.");
  }

  const users = await db(env, "media_accounts", {
    query: `id=eq.${encodeURIComponent(session.user_id)}&active=eq.true&select=id,name,username,role&limit=1`
  });
  const user = users?.[0];
  if (!user) throw httpError(401, "Usuário desativado ou inexistente.");
  return user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role };
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}


async function findResumableUpload(env, userId, fingerprint) {
  const rows = await db(env, "media_uploads", {
    query: `uploader_id=eq.${encodeURIComponent(userId)}&fingerprint=eq.${encodeURIComponent(fingerprint)}&status=eq.uploading&order=created_at.desc&limit=1&select=*`
  });
  return rows?.[0] || null;
}

async function getUploadForUser(env, uploadId, userId) {
  const rows = await db(env, "media_uploads", {
    query: `id=eq.${encodeURIComponent(uploadId)}&uploader_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`
  });
  if (!rows?.[0]) throw httpError(404, "Upload não encontrado.");
  return rows[0];
}

async function getUploadParts(env, uploadId) {
  const rows = await db(env, "media_upload_parts", {
    query: `upload_id=eq.${encodeURIComponent(uploadId)}&select=part_number,etag,size_bytes&order=part_number.asc`
  });
  return rows || [];
}

async function getFileById(env, fileId) {
  const rows = await db(env, "media_files", {
    query: `id=eq.${encodeURIComponent(fileId)}&select=id,uploader_id,uploader_name,original_name,title,category,media_kind,thumbnail_path,storage_path,mime_type,size_bytes,service_date,created_at&limit=1`
  });
  return rows?.[0] || null;
}

async function rpc(env, functionName, body) {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY não configurada no Worker.");
  const url = `${trimSlash(env.SUPABASE_URL)}/rest/v1/rpc/${encodeURIComponent(functionName)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body || {})
  });
  if (!response.ok) {
    const text = await response.text();
    console.error("Supabase RPC", functionName, response.status, text);
    throw httpError(502, "Falha ao validar a conta no Supabase.");
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function db(env, table, { method = "GET", query = "", body, prefer } = {}) {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY não configurada no Worker.");
  const url = `${trimSlash(env.SUPABASE_URL)}/rest/v1/${table}${query ? `?${query}` : ""}`;
  const headers = new Headers({
    apikey: env.SUPABASE_SECRET_KEY,
    Accept: "application/json"
  });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (prefer) headers.set("Prefer", prefer);

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Supabase DB", method, table, response.status, text);
    throw httpError(502, "Falha ao sincronizar metadados com o Supabase.");
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function publicUpload(row, parts, env) {
  const exp = Math.floor(Date.now() / 1000) + UPLOAD_TOKEN_TTL_SECONDS;
  const payload = `${row.id}|${row.uploader_id}|${exp}`;
  const signature = await hmacSign(env.MEDIA_TOKEN_SECRET, payload);
  const uploadToken = `${base64url(payload)}.${signature}`;
  return {
    id: row.id,
    name: row.original_name,
    title: row.title || cleanTitle(row.original_name),
    category: row.category || "outro",
    mediaKind: row.media_kind || "video",
    thumbnailPath: row.thumbnail_path || null,
    size: Number(row.size_bytes),
    type: row.mime_type,
    serviceDate: row.service_date,
    partSize: Number(row.part_size),
    status: row.status,
    uploadToken,
    uploadTokenExpiresIn: UPLOAD_TOKEN_TTL_SECONDS,
    parts: (parts || []).map(p => ({
      partNumber: Number(p.part_number),
      etag: p.etag,
      size: Number(p.size_bytes)
    }))
  };
}

async function buildPreviewUrl(request, env, fileId) {
  const exp = Math.floor(Date.now() / 1000) + PREVIEW_TOKEN_TTL_SECONDS;
  const payload = `preview|${fileId}|${exp}`;
  const signature = await hmacSign(env.MEDIA_TOKEN_SECRET, payload);
  const token = `${base64url(payload)}.${signature}`;
  return `${new URL(request.url).origin}/api/preview/${encodeURIComponent(fileId)}?token=${encodeURIComponent(token)}`;
}

async function verifyPreviewToken(secret, token, fileId) {
  try {
    const [payloadB64, signature] = token.split(".");
    if (!payloadB64 || !signature) return false;
    const payload = new TextDecoder().decode(base64urlToBytes(payloadB64));
    const [kind, id, expText] = payload.split("|");
    if (kind !== "preview" || id !== fileId) return false;
    const exp = Number(expText);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = await hmacSign(secret, payload);
    return timingSafeEqual(expected, signature);
  } catch {
    return false;
  }
}

async function requireUploadToken(request, env, expectedUploadId) {
  const token = request.headers.get("X-Upload-Token") || "";
  if (!token) throw httpError(401, "Token de upload ausente.");
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) throw httpError(401, "Token de upload inválido.");
  let payload;
  try { payload = new TextDecoder().decode(base64urlToBytes(payloadB64)); }
  catch { throw httpError(401, "Token de upload inválido."); }
  const [uploadId, userId, expText] = payload.split("|");
  if (uploadId !== expectedUploadId || !userId) throw httpError(401, "Token de upload não corresponde a este envio.");
  const exp = Number(expText);
  if (!exp || exp < Math.floor(Date.now() / 1000)) throw httpError(401, "Token de upload expirado. Selecione o arquivo novamente para retomar.");
  const expected = await hmacSign(env.MEDIA_TOKEN_SECRET, payload);
  if (!timingSafeEqual(expected, signature)) throw httpError(401, "Token de upload inválido.");
  return { uploadId, userId, exp };
}

function normalizePartSize(fileSize, requested) {
  let size = Math.max(MIN_PART_SIZE, Number(requested) || 16 * MiB);
  // Mantém folga abaixo de 100 MB do plano Free da Cloudflare.
  size = Math.min(size, 64 * MiB);
  const minimumForPartCount = Math.ceil(fileSize / MAX_PARTS);
  size = Math.max(size, minimumForPartCount);
  size = Math.ceil(size / MiB) * MiB;
  if (Math.ceil(fileSize / size) > MAX_PARTS) throw httpError(413, "Arquivo grande demais para o multipart configurado.");
  return size;
}

function validateDate(value) {
  const s = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw httpError(400, "Data do culto inválida.");
  return s;
}

function cleanOriginalName(name) {
  return String(name || "").replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 220);
}

function cleanTitle(value) {
  const raw = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\.[^.]{1,8}$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (raw || "Arquivo").slice(0, 100);
}

function validateCategory(value) {
  const allowed = new Set(["louvor","pregacao","publico","igreja","story","bastidores","outro"]);
  const category = String(value || "outro").toLowerCase();
  return allowed.has(category) ? category : "outro";
}

function validateMediaKind(value, mime, name) {
  const requested = String(value || "").toLowerCase();
  if (requested === "photo" || requested === "video") return requested;
  const lowerMime = String(mime || "").toLowerCase();
  const ext = String(name || "").split(".").pop().toLowerCase();
  if (lowerMime.startsWith("image/") || ["jpg","jpeg","png","webp","heic","heif","gif"].includes(ext)) return "photo";
  return "video";
}

function downloadDisplayName(file) {
  const original = String(file.original_name || "arquivo");
  const dot = original.lastIndexOf(".");
  const ext = dot >= 0 ? original.slice(dot) : "";
  const base = cleanTitle(file.title || original)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 120) || "arquivo";
  return `${base}${ext}`;
}

function safeFileName(name) {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  const base = (dot >= 0 ? name.slice(0, dot) : name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "arquivo";
  return `${base}${ext}`;
}

function contentDispositionAttachment(name) {
  const ascii = String(name || "arquivo").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name || "arquivo")}`;
}

function randomToken(bytes = 32) {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return bytesToBase64url(array);
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSign(secret, payload) {
  if (!secret) throw new Error("MEDIA_TOKEN_SECRET não configurado.");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64url(new Uint8Array(sig));
}

async function verifyDownloadToken(secret, token, fileId) {
  try {
    const [payloadB64, signature] = token.split(".");
    if (!payloadB64 || !signature) return false;
    const payload = new TextDecoder().decode(base64urlToBytes(payloadB64));
    const [id, userId, expText] = payload.split(".");
    if (id !== fileId || !userId) return false;
    const exp = Number(expText);
    if (!exp || exp < Math.floor(Date.now() / 1000)) return false;
    const expected = await hmacSign(secret, payload);
    return timingSafeEqual(expected, signature);
  } catch {
    return false;
  }
}

function base64url(text) {
  return bytesToBase64url(new TextEncoder().encode(text));
}

function bytesToBase64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlToBytes(text) {
  let s = text.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const binary = atob(s);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function corsHeaders(origin, env) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,X-Upload-Token,Content-Type,Content-Length,Range,If-None-Match,If-Match",
    "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges,ETag",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  });
  const allowed = String(env.ALLOWED_ORIGINS || "*").split(",").map(x => x.trim()).filter(Boolean);
  if (allowed.includes("*")) headers.set("Access-Control-Allow-Origin", "*");
  else if (origin && allowed.includes(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(value, status = 200, extraHeaders) {
  const headers = new Headers(extraHeaders || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}

function trimSlash(s) { return String(s || "").replace(/\/+$/, ""); }
function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
