(() => {
  const paths = {
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 15-4.5-4.5L8 19"/>',
    play: '<path d="m9 7 8 5-8 5Z"/>',
    user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/>',
    filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
    sparkles: '<path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/>',
    video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3Z"/>',
    media: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M7 6 9 3h6l2 3"/><circle cx="12" cy="13" r="3.2"/><path d="M6.5 10h.01"/>',
    filmUpload: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 3v18M16 3v18M3 8h5M16 8h5M3 16h5M16 16h5"/><path d="M12 16V9M9.5 11.5 12 9l2.5 2.5"/>',
    mediaUpload: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="10" r="1.7"/><path d="m4 17 4-4 3 3 2-2"/><path d="M16.5 16V8M13.5 11l3-3 3 3"/>',
    calendar: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="2"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 16.5a4.5 4.5 0 0 0-2-8.53A6 6 0 0 0 6.34 7.1 4 4 0 0 0 5 15h2"/>',
    files: '<path d="M14 2H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"/><path d="M18 6h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H10"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9a7 7 0 0 0-12.7-2L4 11M20 13l-1.8 4a7 7 0 0 1-12.7-2"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
    eyeoff: '<path d="m3 3 18 18"/><path d="M10.6 6.2A11.4 11.4 0 0 1 12 6c6.5 0 10 6 10 6a17.6 17.6 0 0 1-2.1 2.8M6.2 6.2C3.5 8 2 12 2 12s3.5 6 10 6a10.8 10.8 0 0 0 4.1-.8"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    wifi: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/>',
    activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
  };

  function icon(name, size = 20, className = '') {
    const body = paths[name] || paths.info;
    return `<svg class="ui-icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.iconSize || 20));
    });
  }

  window.MediaIcons = { icon, hydrate };
})();
