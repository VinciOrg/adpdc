(() => {
  "use strict";

  const cfg = window.MEDIA_CONFIG || {};
  const roleLabels = { leader: "Líder", editor: "Editor", member: "Membro" };
  const icon = (name, size = 18, cls = "") => window.MediaIcons?.icon(name, size, cls) || "";

  let sessionToken = localStorage.getItem("media_session_token") || "";
  let pollTimer = null;
  let currentUser = null;
  let currentProfile = null;
  let files = [];
  let currentServiceDate = getCurrentServiceDateISO();
  let realtimeChannel = null;
  let activeDialogFile = null;
  let queue = [];
  let queueRunning = false;

  const els = {};
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    window.MediaIcons?.hydrate(document);
    wireEvents();
    setServiceDateLabel();
    setupConnectivity();

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }

    if (!cfg.WORKER_URL) {
      showFatalConfigError();
      return;
    }

    if (!sessionToken) {
      showLogin();
      return;
    }

    try {
      const data = await apiFetch("/api/auth/me");
      await enterApp(data.user);
    } catch {
      sessionToken = "";
      localStorage.removeItem("media_session_token");
      showLogin();
    }
  }

  function cacheElements() {
    [
      "loginView","appView","loginForm","loginUser","loginPassword","togglePassword","loginHint",
      "currentUserName","currentUserRole","userInitials","userMenuButton","userMenu","logoutButton",
      "connectionBadge","serviceTitle","serviceDateLabel","metricFiles","metricSize","metricLast","metricLastAgo",
      "fileInput","dropZone","selectFilesButton","mobileUploadButton","queueSection","queueSummary","uploadQueue",
      "clearFinishedButton","refreshButton","filesEmpty","filesTableBody","mobileFilesList","filesFooter",
      "activityList","previousServices","detailsDialog","detailsName","detailsBody","dialogDownloadButton",
      "closeDialogButton","toastContainer"
    ].forEach((id) => els[id] = document.getElementById(id));
  }

  function wireEvents() {
    els.loginForm.addEventListener("submit", handleLogin);
    els.togglePassword.addEventListener("click", () => {
      const reveal = els.loginPassword.type === "password";
      els.loginPassword.type = reveal ? "text" : "password";
      els.togglePassword.setAttribute("aria-label", reveal ? "Ocultar senha" : "Mostrar senha");
      els.togglePassword.innerHTML = icon(reveal ? "eyeoff" : "eye", 20);
    });

    els.userMenuButton.addEventListener("click", () => els.userMenu.classList.toggle("hidden"));
    document.addEventListener("click", (ev) => {
      if (!els.userMenuButton.contains(ev.target) && !els.userMenu.contains(ev.target)) {
        els.userMenu.classList.add("hidden");
      }
    });
    els.logoutButton.addEventListener("click", handleLogout);

    els.selectFilesButton.addEventListener("click", () => els.fileInput.click());
    els.mobileUploadButton.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", () => {
      handleSelectedFiles([...els.fileInput.files]);
      els.fileInput.value = "";
    });

    ["dragenter","dragover"].forEach((evt) => els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.add("dragging");
    }));
    ["dragleave","drop"].forEach((evt) => els.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropZone.classList.remove("dragging");
    }));
    els.dropZone.addEventListener("drop", (e) => handleSelectedFiles([...e.dataTransfer.files]));

    els.clearFinishedButton.addEventListener("click", clearFinishedQueue);
    els.refreshButton.addEventListener("click", () => loadDashboard(true));
    els.closeDialogButton.addEventListener("click", () => els.detailsDialog.close());
    els.dialogDownloadButton.addEventListener("click", () => activeDialogFile && downloadFile(activeDialogFile));

    document.querySelectorAll("[data-scroll]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.scroll === "top") window.scrollTo({ top: 0, behavior: "smooth" });
        if (button.dataset.scroll === "files") document.querySelector(".files-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function setupConnectivity() {
    const update = () => {
      const dot = els.connectionBadge.querySelector(".status-dot");
      const text = els.connectionBadge.querySelector("span:last-child");
      const online = navigator.onLine;
      dot.classList.toggle("online", online);
      dot.classList.toggle("offline", !online);
      text.textContent = online ? "Online" : "Sem internet";
    };

    window.addEventListener("online", () => {
      update();
      toast("Conexão restaurada", "Os envios pendentes continuarão automaticamente.", "success");
      queue.forEach(item => {
        if (item.state === "waiting-network") item.state = "waiting";
      });
      renderQueue();
      processQueue();
    });

    window.addEventListener("offline", () => {
      update();
      toast("Sem internet", "As partes concluídas continuam salvas e o envio será retomado.", "error");
    });
    update();
  }

  function showFatalConfigError() {
    showLogin();
    setLoginError("Preencha WORKER_URL em config.js antes de usar a central.");
  }

  function setLoginError(message) {
    els.loginHint.textContent = message;
    els.loginHint.style.color = "#b2252b";
  }

  async function handleLogin(ev) {
    ev.preventDefault();

    const username = els.loginUser.value.trim().toLowerCase();
    const password = els.loginPassword.value;
    const button = els.loginForm.querySelector("button[type='submit']");
    button.disabled = true;
    button.querySelector("span:first-child").textContent = "Entrando...";
    els.loginHint.textContent = "";

    try {
      const data = await publicApiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      if (!data?.token || !data?.user) throw new Error("Resposta de login inválida.");
      sessionToken = data.token;
      localStorage.setItem("media_session_token", sessionToken);
      await enterApp(data.user);
    } catch (error) {
      setLoginError(error.message || "Usuário ou senha incorretos.");
    } finally {
      button.disabled = false;
      button.querySelector("span:first-child").textContent = "Entrar na central";
    }
  }

  async function enterApp(user) {
    currentUser = user;
    currentProfile = user;
    showApp();
    renderCurrentUser();
    await loadDashboard();
    setupRealtime();
  }

  function showLogin() {
    currentUser = null;
    currentProfile = null;
    els.appView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    els.loginPassword.value = "";
  }

  function showApp() {
    els.loginView.classList.add("hidden");
    els.appView.classList.remove("hidden");
  }

  async function handleLogout() {
    els.userMenu.classList.add("hidden");
    teardownRealtime();
    cancelLocalRequests();
    try { if (sessionToken) await apiFetch("/api/auth/logout", { method: "POST", body: "{}" }); } catch {}
    sessionToken = "";
    localStorage.removeItem("media_session_token");
    showLogin();
  }

  function renderCurrentUser() {
    const name = currentProfile?.name || currentUser?.username || "Membro";
    els.currentUserName.textContent = name;
    els.currentUserRole.textContent = roleLabels[currentProfile?.role] || "Membro";
    els.userInitials.textContent = initials(name);
  }

  async function loadDashboard(showToast = false) {
    try {
      const data = await apiFetch("/api/files");
      files = data?.files || [];
      renderDashboard();
      if (showToast) toast("Atualizado", "Lista de arquivos sincronizada.", "success");
    } catch (error) {
      if (error?.status === 401) {
        sessionToken = "";
        localStorage.removeItem("media_session_token");
        teardownRealtime();
        showLogin();
        setLoginError("Sua sessão expirou. Entre novamente.");
        return;
      }
      toast("Erro ao carregar", error.message || "Não foi possível carregar os arquivos.", "error");
    }
  }

  function renderDashboard() {
    const serviceFiles = files.filter((f) => f.service_date === currentServiceDate);
    renderMetrics(serviceFiles);
    renderFiles(serviceFiles);
    renderActivity(serviceFiles);
    renderPreviousServices();
  }

  function renderMetrics(serviceFiles) {
    els.metricFiles.textContent = String(serviceFiles.length);
    const total = serviceFiles.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0);
    els.metricSize.textContent = formatBytes(total);

    if (serviceFiles[0]) {
      const date = new Date(serviceFiles[0].created_at);
      els.metricLast.textContent = formatTime(date);
      els.metricLastAgo.textContent = relativeTime(date);
    } else {
      els.metricLast.textContent = "—";
      els.metricLastAgo.textContent = "nenhum";
    }
  }

  function renderFiles(serviceFiles) {
    els.filesTableBody.innerHTML = "";
    els.mobileFilesList.innerHTML = "";
    els.filesEmpty.classList.toggle("hidden", serviceFiles.length > 0);

    serviceFiles.forEach((file, index) => {
      const isNew = index < 2 && (Date.now() - new Date(file.created_at).getTime()) < 10 * 60 * 1000;
      const canDelete = currentProfile?.role === "leader" || file.uploader_id === currentUser?.id;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div class="file-main">
            <span class="file-type-icon">${icon("video", 18)}</span>
            <div class="file-name-wrap">
              <span class="file-name" title="${escapeAttr(file.original_name)}">${escapeHtml(file.original_name)}</span>
              ${isNew ? '<span class="new-badge">NOVO</span>' : ""}
            </div>
          </div>
        </td>
        <td>${escapeHtml(file.uploader_name || "Membro")}</td>
        <td>${formatTime(new Date(file.created_at))}</td>
        <td>${formatBytes(file.size_bytes)}</td>
        <td>
          <div class="file-actions">
            <button class="action-button" data-action="download">${icon("download", 15)}<span>Baixar</span></button>
            <button class="action-button neutral" data-action="details">${icon("info", 15)}<span>Detalhes</span></button>
            ${canDelete ? `<button class="action-button danger icon-only" data-action="delete" aria-label="Excluir">${icon("trash", 15)}</button>` : ""}
          </div>
        </td>`;
      tr.querySelector('[data-action="download"]').addEventListener("click", () => downloadFile(file));
      tr.querySelector('[data-action="details"]').addEventListener("click", () => openDetails(file));
      tr.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteFile(file));
      els.filesTableBody.appendChild(tr);

      const card = document.createElement("article");
      card.className = "mobile-file-card";
      card.innerHTML = `
        <div class="mobile-file-top">
          <span class="file-type-icon">${icon("video", 18)}</span>
          <div class="mobile-file-copy">
            <strong>${escapeHtml(file.original_name)} ${isNew ? '<span class="new-badge">NOVO</span>' : ""}</strong>
            <span>por ${escapeHtml(file.uploader_name || "Membro")}</span>
          </div>
        </div>
        <div class="mobile-file-meta">
          <span>${icon("clock", 13)}${formatTime(new Date(file.created_at))}</span>
          <span>${icon("files", 13)}${formatBytes(file.size_bytes)}</span>
        </div>
        <div class="mobile-file-actions">
          <button class="action-button" data-action="download">${icon("download", 15)}<span>Baixar</span></button>
          <button class="action-button neutral" data-action="details">${icon("info", 15)}<span>Detalhes</span></button>
          ${canDelete ? `<button class="action-button danger icon-only" data-action="delete" aria-label="Excluir">${icon("trash", 15)}</button>` : ""}
        </div>`;
      card.querySelector('[data-action="download"]').addEventListener("click", () => downloadFile(file));
      card.querySelector('[data-action="details"]').addEventListener("click", () => openDetails(file));
      card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deleteFile(file));
      els.mobileFilesList.appendChild(card);
    });

    els.filesFooter.textContent = `${serviceFiles.length} ${serviceFiles.length === 1 ? "arquivo" : "arquivos"} neste culto`;
  }

  function renderActivity(serviceFiles) {
    const items = serviceFiles.slice(0, 6).map((f) => ({
      text: `${f.uploader_name || "Membro"} enviou ${f.original_name}`,
      date: new Date(f.created_at)
    }));

    els.activityList.innerHTML = "";
    if (!items.length) {
      els.activityList.innerHTML = '<p class="side-empty">A atividade aparecerá aqui durante o culto.</p>';
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "activity-item";
      row.innerHTML = `<span class="activity-dot"></span><p>${escapeHtml(item.text)}</p><time>${relativeTime(item.date)}</time>`;
      els.activityList.appendChild(row);
    });
  }

  function renderPreviousServices() {
    const groups = new Map();
    files.forEach((f) => {
      if (f.service_date === currentServiceDate) return;
      if (!groups.has(f.service_date)) groups.set(f.service_date, []);
      groups.get(f.service_date).push(f);
    });

    const entries = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
    els.previousServices.innerHTML = "";
    if (!entries.length) {
      els.previousServices.innerHTML = '<p class="side-empty">Os cultos anteriores aparecerão aqui.</p>';
      return;
    }

    entries.forEach(([date, list]) => {
      const total = list.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0);
      const button = document.createElement("button");
      button.className = "previous-service";
      button.type = "button";
      button.innerHTML = `
        <span class="previous-service-icon">${icon("calendar", 18)}</span>
        <span><strong>${formatDateBR(date)}</strong><small>${list.length} arquivos • ${formatBytes(total)}</small></span>
        <span class="previous-chevron">${icon("chevronRight", 17)}</span>`;
      button.addEventListener("click", () => openServiceDetails(date, list));
      els.previousServices.appendChild(button);
    });
  }

  function openServiceDetails(date, list) {
    activeDialogFile = null;
    els.dialogDownloadButton.classList.add("hidden");
    els.detailsName.textContent = `Culto • ${formatDateBR(date)}`;
    const names = list.slice(0, 12).map((f) => `
      <div class="detail-row"><span>${formatTime(new Date(f.created_at))}</span><span>${escapeHtml(f.original_name)} • ${formatBytes(f.size_bytes)}</span></div>`).join("");
    els.detailsBody.innerHTML = `<div class="detail-row"><span>Total</span><span>${list.length} arquivos • ${formatBytes(list.reduce((s,f)=>s+Number(f.size_bytes||0),0))}</span></div>${names}`;
    els.detailsDialog.showModal();
  }

  function openDetails(file) {
    activeDialogFile = file;
    els.dialogDownloadButton.classList.remove("hidden");
    els.detailsName.textContent = file.original_name;
    els.detailsBody.innerHTML = `
      <div class="detail-row"><span>Enviado por</span><span>${escapeHtml(file.uploader_name || "Membro")}</span></div>
      <div class="detail-row"><span>Data</span><span>${formatDateBR(file.service_date)} às ${formatTime(new Date(file.created_at))}</span></div>
      <div class="detail-row"><span>Tamanho</span><span>${formatBytes(file.size_bytes)}</span></div>
      <div class="detail-row"><span>Formato</span><span>${escapeHtml(fileExtension(file.original_name).toUpperCase() || file.mime_type || "Vídeo")}</span></div>
      <div class="detail-row"><span>Armazenamento</span><span>Cloudflare R2 privado</span></div>
      <div class="detail-row"><span>Qualidade</span><span>Arquivo original, sem conversão</span></div>`;
    els.detailsDialog.showModal();
  }

  function handleSelectedFiles(selected) {
    const accepted = selected.filter((file) => {
      const ext = fileExtension(file.name).toLowerCase();
      return file.type.startsWith("video/") || ["mov","mp4","m4v","avi","webm"].includes(ext);
    });

    if (!accepted.length) {
      toast("Nenhum vídeo válido", "Selecione arquivos de vídeo da galeria.", "error");
      return;
    }

    const maxBytes = Number(cfg.MAX_UPLOAD_BYTES || 0);
    const tooLarge = maxBytes > 0 ? accepted.filter((f) => f.size > maxBytes) : [];
    if (tooLarge.length) {
      toast("Arquivo acima do limite do app", `${tooLarge[0].name} tem ${formatBytes(tooLarge[0].size)}.`, "error");
    }

    accepted.filter((f) => !maxBytes || f.size <= maxBytes).forEach((file) => {
      const duplicate = queue.some(item => item.file.name === file.name && item.file.size === file.size && !["success","cancelled"].includes(item.state));
      if (duplicate) return;
      queue.push({
        id: crypto.randomUUID(),
        file,
        progress: 0,
        uploadedBytes: 0,
        state: navigator.onLine ? "waiting" : "waiting-network",
        error: "",
        uploadId: null,
        uploadToken: null,
        partSize: 0,
        activeXhrs: new Set(),
        cancelled: false,
        speed: 0,
        startedAt: 0
      });
    });

    renderQueue();
    processQueue();
  }

  async function processQueue() {
    if (queueRunning || !navigator.onLine || !currentUser) return;
    queueRunning = true;
    try {
      for (const item of queue) {
        if (item.state !== "waiting") continue;
        await uploadQueueItem(item);
      }
    } finally {
      queueRunning = false;
    }
  }

  async function uploadQueueItem(item) {
    item.state = "uploading";
    item.startedAt = Date.now();
    item.error = "";
    renderQueueItem(item);

    try {
      await uploadToR2(item);
      if (item.cancelled) return;
      item.state = "success";
      item.progress = 100;
      item.uploadedBytes = item.file.size;
      item.error = "";
      renderQueueItem(item);
      toast("Vídeo enviado", `${item.file.name} foi salvo no R2 sem compressão.`, "success");
      await loadDashboard();
    } catch (error) {
      if (item.cancelled) {
        item.state = "cancelled";
        item.error = "Envio cancelado";
      } else if (!navigator.onLine || isNetworkError(error)) {
        item.state = "waiting-network";
        item.error = "Aguardando internet para continuar";
      } else {
        item.state = "error";
        item.error = normalizeUploadError(error);
      }
      renderQueueItem(item);
      if (item.state === "error") toast("Erro no envio", item.error, "error");
    }
  }

  async function uploadToR2(item) {
    const file = item.file;
    const fingerprint = await fileFingerprint(file);
    const requestedPartSize = choosePartSize(file.size);

    const init = await apiFetch("/api/uploads/init", {
      method: "POST",
      body: JSON.stringify({
        name: file.name,
        size: file.size,
        type: file.type || guessMime(file.name),
        serviceDate: currentServiceDate,
        fingerprint,
        partSize: requestedPartSize
      })
    });

    const upload = init.upload;
    if (!upload?.id) throw new Error("A API não retornou uma sessão de upload válida.");

    item.uploadId = upload.id;
    item.uploadToken = upload.uploadToken;
    item.partSize = Number(upload.partSize);
    if (!item.uploadToken) throw new Error("A API não retornou o token temporário do upload.");

    const completed = new Map((upload.parts || []).map(p => [Number(p.partNumber), Number(p.size || 0)]));
    item.uploadedBytes = [...completed.values()].reduce((sum, n) => sum + n, 0);
    item.progress = Math.min(99, Math.floor((item.uploadedBytes / file.size) * 100));
    renderQueueItem(item);

    const totalParts = Math.ceil(file.size / item.partSize);
    const missing = [];
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      if (!completed.has(partNumber)) missing.push(partNumber);
    }

    const parallel = Math.max(1, Math.min(Number(cfg.MAX_PARALLEL_PARTS || 2), 3));
    let cursor = 0;
    const liveLoaded = new Map();

    const worker = async () => {
      while (cursor < missing.length) {
        if (item.cancelled) throw new Error("UPLOAD_CANCELLED");
        const index = cursor++;
        const partNumber = missing[index];
        const start = (partNumber - 1) * item.partSize;
        const end = Math.min(file.size, start + item.partSize);
        const blob = file.slice(start, end);

        const result = await uploadPartWithRetry(item, partNumber, blob, (loaded) => {
          liveLoaded.set(partNumber, loaded);
          updateItemProgress(item, liveLoaded);
        });

        liveLoaded.delete(partNumber);
        completed.set(partNumber, Number(result.size || blob.size));
        item.uploadedBytes = [...completed.values()].reduce((sum, n) => sum + n, 0);
        updateItemProgress(item, liveLoaded);
      }
    };

    await Promise.all(Array.from({ length: Math.min(parallel, Math.max(1, missing.length)) }, () => worker()));
    if (item.cancelled) throw new Error("UPLOAD_CANCELLED");

    item.progress = 99;
    renderQueueItem(item);
    await uploadApiFetch(item, `/api/uploads/${encodeURIComponent(item.uploadId)}/complete`, { method: "POST", body: "{}" });
  }

  async function uploadPartWithRetry(item, partNumber, blob, onProgress) {
    const delays = [0, 1200, 2500, 5000, 10000, 20000];
    let lastError = null;

    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (item.cancelled) throw new Error("UPLOAD_CANCELLED");
      if (!navigator.onLine) await waitUntilOnline(item);
      if (delays[attempt]) await sleep(delays[attempt]);

      try {
        return await uploadPartXHR(item, partNumber, blob, onProgress);
      } catch (error) {
        lastError = error;
        if (item.cancelled) throw error;
        if (error?.status === 401) throw error;
        if (error?.status && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
          throw error;
        }
      }
    }
    throw lastError || new Error("Não foi possível enviar uma parte do vídeo.");
  }

  async function uploadPartXHR(item, partNumber, blob, onProgress) {
    const url = `${trimSlash(cfg.WORKER_URL)}/api/uploads/${encodeURIComponent(item.uploadId)}/parts/${partNumber}`;

    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      item.activeXhrs.add(xhr);
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("X-Upload-Token", item.uploadToken);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded);
      };
      xhr.onerror = () => reject(Object.assign(new Error("Falha de rede durante o envio."), { network: true }));
      xhr.onabort = () => reject(new Error("UPLOAD_CANCELLED"));
      xhr.onload = () => {
        const body = safeJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body || { size: blob.size });
        else reject(Object.assign(new Error(body?.error || `Erro HTTP ${xhr.status}`), { status: xhr.status }));
      };
      xhr.onloadend = () => item.activeXhrs.delete(xhr);
      xhr.send(blob);
    });
  }

  function updateItemProgress(item, liveLoaded) {
    const live = [...liveLoaded.values()].reduce((sum, n) => sum + n, 0);
    const bytes = Math.min(item.file.size, item.uploadedBytes + live);
    item.progress = Math.min(99, Math.floor((bytes / item.file.size) * 100));
    const elapsed = Math.max(1, (Date.now() - item.startedAt) / 1000);
    item.speed = Math.max(0, bytes / elapsed);
    renderQueueItem(item);
  }

  async function cancelUpload(item) {
    if (["success","cancelled"].includes(item.state)) return;
    item.cancelled = true;
    for (const xhr of item.activeXhrs) {
      try { xhr.abort(); } catch {}
    }
    item.activeXhrs.clear();

    if (item.uploadId) {
      try {
        await uploadApiFetch(item, `/api/uploads/${encodeURIComponent(item.uploadId)}/abort`, { method: "POST", body: "{}" });
      } catch {}
    }
    item.state = "cancelled";
    item.error = "Envio cancelado";
    renderQueueItem(item);
  }

  function cancelLocalRequests() {
    queue.forEach(item => {
      item.cancelled = true;
      for (const xhr of item.activeXhrs || []) {
        try { xhr.abort(); } catch {}
      }
    });
  }

  function renderQueue() {
    els.queueSection.classList.toggle("hidden", queue.length === 0);
    els.queueSummary.textContent = `${queue.length} ${queue.length === 1 ? "arquivo" : "arquivos"}`;
    els.uploadQueue.innerHTML = "";
    queue.forEach((item) => {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.dataset.id = item.id;
      els.uploadQueue.appendChild(div);
      renderQueueItem(item);
    });
  }

  function renderQueueItem(item) {
    const div = els.uploadQueue.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    if (!div) return;

    const stateText = {
      waiting: "Aguardando",
      "waiting-network": "Aguardando internet",
      uploading: `${item.progress}%`,
      success: "Concluído",
      error: "Erro",
      cancelled: "Cancelado"
    }[item.state] || item.state;

    const extra = item.state === "uploading" && item.speed > 0
      ? ` • ${formatBytes(item.speed)}/s`
      : "";

    const resumableNote = item.state === "waiting-network"
      ? " • partes concluídas preservadas"
      : "";

    div.className = `queue-item ${item.state === "success" ? "success" : ["error","cancelled"].includes(item.state) ? "error" : ""}`;
    div.innerHTML = `
      <div class="queue-top">
        <div class="queue-file-icon">${icon(item.state === "success" ? "checkCircle" : "video", 18)}</div>
        <div class="queue-name">
          <strong>${escapeHtml(item.file.name)}</strong>
          <span>${formatBytes(item.file.size)}${extra}${item.error ? ` • ${escapeHtml(item.error)}` : ""}${resumableNote}</span>
        </div>
        <div class="queue-right">
          <span class="queue-state">${stateText}</span>
          ${!["success","cancelled"].includes(item.state) ? `<button class="queue-cancel" type="button" aria-label="Cancelar envio">${icon("close", 15)}</button>` : ""}
        </div>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${item.progress}%"></div></div>`;

    div.querySelector(".queue-cancel")?.addEventListener("click", () => cancelUpload(item));
  }

  function clearFinishedQueue() {
    queue = queue.filter((i) => !["success","error","cancelled"].includes(i.state));
    renderQueue();
  }

  async function downloadFile(file) {
    try {
      toast("Preparando download", `${file.original_name} será baixado do R2.`, "");
      const data = await apiFetch(`/api/files/${encodeURIComponent(file.id)}/download-token`, { method: "POST", body: "{}" });
      if (!data?.url) throw new Error("A API não retornou o link de download.");
      window.location.href = data.url;
    } catch (error) {
      toast("Não foi possível baixar", error.message || "Tente novamente.", "error");
    }
  }

  async function deleteFile(file) {
    const ok = window.confirm(`Excluir “${file.original_name}”?\n\nO vídeo será removido permanentemente do R2.`);
    if (!ok) return;

    try {
      await apiFetch(`/api/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
      toast("Arquivo excluído", file.original_name, "success");
      if (els.detailsDialog.open) els.detailsDialog.close();
      await loadDashboard();
    } catch (error) {
      toast("Erro ao excluir", error.message || "Não foi possível excluir.", "error");
    }
  }

  async function uploadApiFetch(item, path, options = {}) {
    if (!item?.uploadToken) throw new Error("Token temporário do upload ausente.");
    const headers = new Headers(options.headers || {});
    headers.set("X-Upload-Token", item.uploadToken);
    if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await fetch(`${trimSlash(cfg.WORKER_URL)}${path}`, { ...options, headers });
    } catch (error) {
      throw Object.assign(new Error("Não foi possível alcançar a API R2."), { network: true, cause: error });
    }
    const text = await response.text();
    const body = safeJson(text);
    if (!response.ok) throw Object.assign(new Error(body?.error || `Erro HTTP ${response.status}`), { status: response.status });
    return body;
  }

  async function publicApiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let response;
    try {
      response = await fetch(`${trimSlash(cfg.WORKER_URL)}${path}`, { ...options, headers });
    } catch (error) {
      throw Object.assign(new Error("Não foi possível alcançar a Central de Mídia."), { network: true, cause: error });
    }
    const text = await response.text();
    const body = safeJson(text);
    if (!response.ok) throw Object.assign(new Error(body?.error || `Erro HTTP ${response.status}`), { status: response.status });
    return body;
  }

  async function apiFetch(path, options = {}) {
    if (!sessionToken) throw Object.assign(new Error("Sessão expirada. Entre novamente."), { status: 401 });
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${sessionToken}`);
    if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await fetch(`${trimSlash(cfg.WORKER_URL)}${path}`, { ...options, headers });
    } catch (error) {
      throw Object.assign(new Error("Não foi possível alcançar a API R2."), { network: true, cause: error });
    }

    const text = await response.text();
    const body = safeJson(text);
    if (!response.ok) throw Object.assign(new Error(body?.error || `Erro HTTP ${response.status}`), { status: response.status });
    return body;
  }

  function setupRealtime() {
    teardownRealtime();
    // Com autenticação própria, atualizamos a lista em intervalos curtos.
    // É leve e mantém os celulares sincronizados durante o culto.
    pollTimer = setInterval(() => {
      if (!document.hidden && navigator.onLine && sessionToken) loadDashboard(false);
    }, 3500);
  }

  function teardownRealtime() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function setServiceDateLabel() {
    const [y, m, d] = currentServiceDate.split("-").map(Number);
    const serviceDate = new Date(y, m - 1, d, 12, 0, 0);
    const isToday = getLocalISODate() === currentServiceDate;
    els.serviceTitle.textContent = isToday ? "Culto de Hoje" : "Último Culto";
    const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(serviceDate);
    els.serviceDateLabel.textContent = `${capitalize(weekday)} • ${formatDateBR(currentServiceDate)}`;

    const livePill = document.querySelector(".pill.live");
    if (livePill) livePill.classList.toggle("hidden", !isToday);
  }

  function toast(title, message, type = "") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    const toastIcon = type === "success" ? "checkCircle" : type === "error" ? "alert" : "info";
    item.innerHTML = `<span class="toast-icon">${icon(toastIcon, 18)}</span><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
    els.toastContainer.appendChild(item);
    setTimeout(() => item.remove(), 4300);
  }

  function normalizeUploadError(error) {
    const msg = error?.message || String(error || "Falha no upload.");
    if (/20 GiB|413|too large|grande demais/i.test(msg)) return "O arquivo ultrapassa o limite de 20 GiB configurado no app.";
    if (/jwt|token|unauthorized|401|sessão/i.test(msg)) return "Sua sessão expirou. Entre novamente.";
    if (/R2|502/i.test(msg)) return `${msg} As partes já concluídas podem ser retomadas.`;
    if (/network|fetch|connection|rede|internet/i.test(msg)) return "A conexão caiu. As partes concluídas ficam salvas para retomada.";
    return msg;
  }

  function choosePartSize(fileSize) {
    const MiB = 1024 * 1024;
    const base = Math.max(8 * MiB, Number(cfg.BASE_PART_SIZE || 16 * MiB));
    const minFor10000 = Math.ceil(fileSize / 9500);
    return Math.ceil(Math.max(base, minFor10000) / MiB) * MiB;
  }

  async function fileFingerprint(file) {
    const source = `${file.name}|${file.size}|${file.lastModified}|${file.type}`;
    if (crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(source))).replace(/[^a-z0-9]/gi, "").slice(0, 120);
  }

  function waitUntilOnline(item) {
    if (navigator.onLine) return Promise.resolve();
    item.state = "waiting-network";
    item.error = "Aguardando internet para continuar";
    renderQueueItem(item);
    return new Promise((resolve, reject) => {
      const onOnline = () => {
        cleanup();
        item.state = "uploading";
        item.error = "";
        renderQueueItem(item);
        resolve();
      };
      const timer = setInterval(() => {
        if (item.cancelled) {
          cleanup();
          reject(new Error("UPLOAD_CANCELLED"));
        }
      }, 500);
      const cleanup = () => {
        clearInterval(timer);
        window.removeEventListener("online", onOnline);
      };
      window.addEventListener("online", onOnline, { once: true });
    });
  }

  function getCurrentServiceDateISO() {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay()); // domingo atual ou domingo mais recente
    return toLocalISODate(d);
  }

  function getLocalISODate() { return toLocalISODate(new Date()); }

  function toLocalISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDateBR(iso) {
    if (!iso) return "—";
    const [y,m,d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  function formatTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return "—";
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function relativeTime(date) {
    const diff = Math.max(0, Date.now() - date.getTime());
    const min = Math.floor(diff / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    return formatDateBR(toLocalISODate(date));
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${Math.round(n)} B`;
    const units = ["KB","MB","GB","TB"];
    let value = n / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits).replace(".", ",")} ${units[i]}`;
  }

  function fileExtension(name) {
    const match = String(name || "").match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : "";
  }

  function guessMime(name) {
    const ext = fileExtension(name).toLowerCase();
    return ({ mov: "video/quicktime", mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm", avi: "video/x-msvideo" })[ext] || "application/octet-stream";
  }

  function initials(name) {
    return String(name || "M").trim().split(/\s+/).slice(0,2).map(p => p[0]).join("").toUpperCase();
  }

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
  function trimSlash(s) { return String(s || "").replace(/\/+$/, ""); }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function safeJson(text) { try { return text ? JSON.parse(text) : null; } catch { return null; } }
  function isNetworkError(error) { return Boolean(error?.network) || /network|fetch|rede|internet/i.test(error?.message || ""); }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  }
  function escapeAttr(value) { return escapeHtml(value).replace(/'/g, "&#039;"); }
})();
