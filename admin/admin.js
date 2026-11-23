/* Panel de administración de la tienda.
 * Lee y escribe data/store.json en el repositorio de GitHub mediante la API
 * de contenidos. Las fotos se suben a assets/products/. */
(() => {
  "use strict";

  const CFG_KEY = "sp-admin-config";
  const DRAFT_KEY = "sp-admin-draft";
  const PREVIEW_KEY = "sp-preview";
  const DATA_PATH = "data/store.json";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let cfg = null;        // { owner, repo, branch, token } — null en modo sin conexión
  let data = null;       // contenido de store.json que se está editando
  let published = "";    // JSON publicado, para saber si hay cambios
  let baseSha = null;    // sha del store.json que cargamos
  const localImages = new Map(); // ruta → objectURL mientras GitHub Pages despliega

  const FONTS = ["Poppins", "Inter", "Montserrat", "Nunito", "Quicksand", "DM Sans", "Work Sans", "Lora",
    "Playfair Display", "Rubik Mono One", "Bebas Neue", "Righteous", "Pacifico", "Creepster", "Fredoka",
    "Space Grotesk", "Abril Fatface", "Permanent Marker"];

  const PRESETS = {
    "Sweetie": { primary: "#e84a8a", secondary: "#1d1a22", accent: "#8b5cf6", background: "#fff7fb", surface: "#ffffff", text: "#1d1a22" },
    "Psycho": { primary: "#ff2e63", secondary: "#f5f5f5", accent: "#08d9d6", background: "#111014", surface: "#1c1a21", text: "#f2eff5" },
    "Pastel": { primary: "#f49cbb", secondary: "#5b4b8a", accent: "#88d4c3", background: "#fdf6ff", surface: "#ffffff", text: "#3a3150" },
    "Gótico": { primary: "#9b1d3a", secondary: "#e9e2d0", accent: "#6b4fa0", background: "#0d0b0e", surface: "#18141a", text: "#e9e2d0" },
    "Minimal": { primary: "#111111", secondary: "#111111", accent: "#888888", background: "#fafafa", surface: "#ffffff", text: "#111111" },
  };

  // ---------- Utilidades ----------
  function toast(msg, err = false) {
    const t = $("#toast");
    t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), err ? 6000 : 2600);
  }
  const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
  function uniqueId(base, list) {
    let id = slug(base), n = 2;
    while (list.some((x) => x.id === id)) id = slug(base) + "-" + n++;
    return id;
  }
  const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
  function set(obj, path, val) {
    const ks = path.split("."); const last = ks.pop();
    const tgt = ks.reduce((o, k) => (o[k] ??= {}), obj); tgt[last] = val;
  }
  const imgSrc = (p) => !p ? "" : localImages.get(p) || (/^(https?:|data:|blob:)/.test(p) ? p : "../" + p);
  const money = (n) => {
    try { return new Intl.NumberFormat(data.store.locale || "es-MX", { style: "currency", currency: data.store.currency || "MXN" }).format(n || 0); }
    catch { return "$" + n; }
  };
  function b64encodeText(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decodeText(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  const blobToB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob);
  });

  // ---------- GitHub ----------
  async function gh(path, opts = {}) {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`, {
      ...opts,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${cfg.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = res.status + "";
      try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return res.json();
  }
  const getFile = (path) => gh(`contents/${path}?ref=${encodeURIComponent(cfg.branch)}`);
  const putFile = (path, b64, message, sha) => gh(`contents/${path}`, {
    method: "PUT", body: JSON.stringify({ message, content: b64, branch: cfg.branch, ...(sha ? { sha } : {}) }),
  });

  function explain(err) {
    if (err.status === 401) return "El token no es válido o expiró.";
    if (err.status === 403) return "El token no tiene permiso de escritura (Contents: Read and write).";
    if (err.status === 404) return "No se encontró el repositorio, la rama o data/store.json. Revisa los datos.";
    if (err.status === 409) return "Alguien más publicó cambios al mismo tiempo. Recarga e inténtalo de nuevo.";
    return "Error de GitHub: " + err.message;
  }

  // ---------- Sesión ----------
  function readCfg() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY)) || JSON.parse(sessionStorage.getItem(CFG_KEY)); } catch { return null; }
  }
  function writeCfg(c, remember) {
    try {
      localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY);
      (remember ? localStorage : sessionStorage).setItem(CFG_KEY, JSON.stringify(c));
    } catch { /* sin almacenamiento */ }
  }

  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    cfg = { owner: f.owner.trim(), repo: f.repo.trim(), branch: f.branch.trim() || "main", token: f.token.trim() };
    const btn = e.submitter; btn.disabled = true;
    $("#login-error").hidden = true;
    try {
      await loadRemote();
      writeCfg(cfg, !!f.remember);
      startPanel();
    } catch (err) {
      cfg = null;
      $("#login-error").textContent = explain(err);
      $("#login-error").hidden = false;
    } finally { btn.disabled = false; }
  });

  $("#offline-btn").onclick = async () => {
    cfg = null;
    const res = await fetch("../" + DATA_PATH + "?v=" + Date.now());
    data = await res.json();
    published = JSON.stringify(data);
    startPanel();
  };

  $("#logout-btn").onclick = () => {
    if (isDirty() && !confirm("Tienes cambios sin publicar. ¿Salir de todos modos?")) return;
    try { localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); } catch { /* */ }
    location.reload();
  };

  async function loadRemote() {
    const file = await getFile(DATA_PATH);
    baseSha = file.sha;
    data = JSON.parse(b64decodeText(file.content));
    published = JSON.stringify(data);
  }

  function startPanel() {
    normalize();
    // ¿Hay un borrador guardado de una sesión anterior?
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (d && JSON.stringify(d.data) !== published &&
          confirm("Encontramos cambios que no publicaste la última vez. ¿Quieres recuperarlos?")) {
        data = d.data; normalize();
      }
    } catch { /* */ }
    $("#login").hidden = true;
    $("#panel").hidden = false;
    $("#mode-pill").textContent = cfg ? `${cfg.owner}/${cfg.repo}` : "sin conexión";
    $("#publish-btn").textContent = cfg ? "Publicar" : "Descargar store.json";
    renderAll();
  }

  function normalize() {
    data.store ??= {}; data.theme ??= {}; data.hero ??= {};
    data.collections ??= []; data.products ??= [];
    for (const p of data.products) { p.images ??= []; p.collections ??= []; p.options ??= []; p.status ??= "active"; }
  }

  // ---------- Estado ----------
  const isDirty = () => JSON.stringify(data) !== published;
  function changed() {
    $("#dirty").hidden = !isDirty();
    $("#store-name").textContent = data.store.name || "Tienda";
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ data })); } catch { /* */ }
  }
  window.addEventListener("beforeunload", (e) => { if (data && isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  function renderAll() {
    renderProducts(); renderCollections(); fillForms(); changed();
  }

  // ---------- Pestañas ----------
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + b.dataset.tab));
  });

  // ---------- Productos ----------
  const STATUS = { active: "Activo", draft: "Borrador", archived: "Archivado" };
  $("#p-search").oninput = renderProducts;
  $("#p-filter").onchange = renderProducts;

  function renderProducts() {
    const q = $("#p-search").value.trim().toLowerCase();
    const st = $("#p-filter").value;
    const list = data.products.filter((p) => (st === "all" || p.status === st) && (!q || p.name.toLowerCase().includes(q)));
    const colName = (id) => data.collections.find((c) => c.id === id)?.name || id;
    $("#p-list").innerHTML = list.length ? list.map((p) => {
      const i = data.products.indexOf(p);
      const stock = p.stock === "" || p.stock == null ? "∞" : p.stock;
      return `<div class="item">
        ${p.images[0] ? `<img class="thumb" src="${esc(imgSrc(p.images[0]))}" alt="">` : `<div class="thumb">${esc(p.name[0] || "?")}</div>`}
        <div>
          <h3>${esc(p.name)} ${p.featured ? "★" : ""}</h3>
          <div class="meta">
            <span class="status ${p.status}">${STATUS[p.status] || p.status}</span>
            <span>${money(p.price)}</span>
            <span>Inventario: ${esc(stock)}</span>
            <span>${esc(p.collections.map(colName).join(", ") || "Sin colección")}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost sm" data-act="edit" data-i="${i}">Editar</button>
          <button class="btn ghost sm" data-act="dup" data-i="${i}">Duplicar</button>
          ${p.status === "archived"
            ? `<button class="btn ghost sm" data-act="restore" data-i="${i}">Restaurar</button>`
            : `<button class="btn ghost sm" data-act="archive" data-i="${i}">Archivar</button>`}
          <button class="btn ghost sm danger" data-act="delete" data-i="${i}">Borrar</button>
        </div>
      </div>`;
    }).join("") : `<p class="empty">No hay productos${st !== "all" ? " en este filtro" : ""}.</p>`;
  }

  $("#p-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const i = Number(b.dataset.i), p = data.products[i];
    if (b.dataset.act === "edit") return openProduct(i);
    if (b.dataset.act === "dup") {
      const copy = structuredClone(p);
      copy.name = p.name + " (copia)"; copy.id = uniqueId(copy.name, data.products);
      copy.status = "draft"; copy.createdAt = new Date().toISOString().slice(0, 10);
      data.products.splice(i + 1, 0, copy); toast("Duplicado como borrador");
    }
    if (b.dataset.act === "archive") { p.status = "archived"; toast("Producto archivado (oculto en la tienda)"); }
    if (b.dataset.act === "restore") { p.status = "active"; toast("Producto activo otra vez"); }
    if (b.dataset.act === "delete") {
      if (!confirm(`¿Borrar “${p.name}” definitivamente? Si solo quieres ocultarlo, usa Archivar.`)) return;
      data.products.splice(i, 1); toast("Producto borrado");
    }
    renderProducts(); changed();
  });

  let editing = null; // { index, images }
  $("#p-new").onclick = () => openProduct(-1);

  function openProduct(index) {
    const p = index >= 0 ? data.products[index] : {
      name: "", description: "", price: "", comparePrice: "", stock: "", images: [], collections: [],
      optionName: "", options: [], paymentLink: "", status: "active", featured: false,
    };
    editing = { index, images: [...p.images] };
    const f = $("#p-form");
    $("#p-title").textContent = index >= 0 ? "Editar producto" : "Nuevo producto";
    f.name.value = p.name; f.description.value = p.description || "";
    f.price.value = p.price; f.comparePrice.value = p.comparePrice || "";
    f.stock.value = p.stock ?? ""; f.optionName.value = p.optionName || "";
    f.options.value = (p.options || []).join(", "); f.paymentLink.value = p.paymentLink || "";
    f.status.value = p.status; f.featured.checked = !!p.featured;
    $("#p-collections").innerHTML = data.collections.length ? data.collections.map((c) =>
      `<label><input type="checkbox" value="${esc(c.id)}" ${p.collections.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("")
      : `<span class="muted">Aún no hay colecciones.</span>`;
    $("#p-delete").hidden = index < 0;
    drawImages();
    $("#p-dialog").showModal();
  }

  function drawImages() {
    $("#p-images").innerHTML = editing.images.map((src, i) =>
      `<div class="img-tile ${src.startsWith("uploading:") ? "uploading" : ""}">
        ${src.startsWith("uploading:") ? "" : `<img src="${esc(imgSrc(src))}" alt="">`}
        <div class="bar">
          <button type="button" data-img="left" data-i="${i}" title="Mover a la izquierda">◀</button>
          <button type="button" data-img="del" data-i="${i}" title="Quitar">✕</button>
          <button type="button" data-img="right" data-i="${i}" title="Mover a la derecha">▶</button>
        </div>
      </div>`).join("") || `<span class="muted">Sin fotos. La primera foto es la portada.</span>`;
  }

  $("#p-images").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-img]"); if (!b) return;
    const i = Number(b.dataset.i), im = editing.images;
    if (b.dataset.img === "del") im.splice(i, 1);
    if (b.dataset.img === "left" && i > 0) [im[i - 1], im[i]] = [im[i], im[i - 1]];
    if (b.dataset.img === "right" && i < im.length - 1) [im[i + 1], im[i]] = [im[i], im[i + 1]];
    drawImages();
  });

  $("#p-add-url").onclick = () => {
    const url = prompt("Pega la URL de la imagen (https://…)");
    if (url && /^https?:\/\//.test(url.trim())) { editing.images.push(url.trim()); drawImages(); }
  };

  $("#p-upload").onchange = async (e) => {
    const files = [...e.target.files]; e.target.value = "";
    const base = $("#p-form").name.value || "producto";
    for (const file of files) {
      const tmp = "uploading:" + Math.random();
      editing.images.push(tmp); drawImages();
      try {
        const path = await uploadImage(file, "assets/products/" + slug(base));
        const i = editing.images.indexOf(tmp);
        if (i >= 0) editing.images[i] = path;
      } catch (err) {
        editing.images = editing.images.filter((x) => x !== tmp);
        toast(err.status ? explain(err) : err.message, true);
      }
      drawImages();
    }
  };

  /** Reduce la foto, la sube al repositorio y devuelve su ruta relativa. */
  async function uploadImage(file, prefix) {
    if (!cfg) throw new Error("Para subir fotos conecta el panel a GitHub. Sin conexión puedes usar “Agregar por URL”.");
    const blob = await shrink(file, 1600);
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    const path = `${prefix}-${Date.now().toString(36)}.${ext}`;
    await putFile(path, await blobToB64(blob), `Subir imagen ${path.split("/").pop()}`);
    localImages.set(path, URL.createObjectURL(blob));
    return path;
  }

  async function shrink(file, max) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const out = await new Promise((r) => c.toBlob(r, "image/webp", 0.85));
      return out && out.type === "image/webp" && out.size < file.size ? out : file;
    } catch { return file; }
  }

  $("#p-form").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "save") return;
    if (editing.images.some((x) => x.startsWith("uploading:"))) {
      e.preventDefault(); toast("Espera a que terminen de subir las fotos"); return;
    }
    const f = e.target;
    const num = (v) => (v === "" ? "" : Number(v));
    const old = editing.index >= 0 ? data.products[editing.index] : null;
    const p = {
      ...(old || {}),
      id: old ? old.id : uniqueId(f.name.value, data.products),
      name: f.name.value.trim(),
      description: f.description.value.trim(),
      price: Number(f.price.value) || 0,
      comparePrice: Number(f.comparePrice.value) || 0,
      stock: num(f.stock.value),
      images: editing.images,
      collections: $$("#p-collections input:checked").map((x) => x.value),
      optionName: f.optionName.value.trim(),
      options: f.options.value.split(",").map((s) => s.trim()).filter(Boolean),
      paymentLink: f.paymentLink.value.trim(),
      status: f.status.value,
      featured: f.featured.checked,
      createdAt: old?.createdAt || new Date().toISOString().slice(0, 10),
    };
    if (old) data.products[editing.index] = p; else data.products.unshift(p);
    renderProducts(); changed();
    toast("Guardado. Presiona “Publicar” para que se vea en la tienda.");
  });

  $("#p-delete").onclick = () => {
    const p = data.products[editing.index];
    if (!confirm(`¿Borrar “${p.name}” definitivamente?`)) return;
    data.products.splice(editing.index, 1);
    $("#p-dialog").close(); renderProducts(); changed();
  };

  // ---------- Colecciones ----------
  function renderCollections() {
    const count = (id) => data.products.filter((p) => p.collections.includes(id)).length;
    $("#c-list").innerHTML = data.collections.length ? data.collections.map((c, i) => `
      <div class="item no-thumb">
        <div>
          <h3>${esc(c.name)}</h3>
          <div class="meta">
            <span class="status ${c.visible !== false ? "active" : "draft"}">${c.visible !== false ? "Visible" : "Oculta"}</span>
            <span>${count(c.id)} producto(s)</span>
            ${c.description ? `<span>${esc(c.description)}</span>` : ""}
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost sm" data-act="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn ghost sm" data-act="down" data-i="${i}" ${i === data.collections.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn ghost sm" data-act="edit" data-i="${i}">Editar</button>
          <button class="btn ghost sm" data-act="toggle" data-i="${i}">${c.visible !== false ? "Ocultar" : "Mostrar"}</button>
          <button class="btn ghost sm danger" data-act="delete" data-i="${i}">Borrar</button>
        </div>
      </div>`).join("") : `<p class="empty">No hay colecciones.</p>`;
  }

  let editingCol = -1;
  $("#c-new").onclick = () => openCollection(-1);
  function openCollection(i) {
    editingCol = i;
    const c = i >= 0 ? data.collections[i] : { name: "", description: "", visible: true };
    const f = $("#c-form");
    $("#c-title").textContent = i >= 0 ? "Editar colección" : "Nueva colección";
    f.name.value = c.name; f.description.value = c.description || ""; f.visible.checked = c.visible !== false;
    $("#c-dialog").showModal();
  }
  $("#c-form").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "save") return;
    const f = e.target;
    const vals = { name: f.name.value.trim(), description: f.description.value.trim(), visible: f.visible.checked };
    if (editingCol >= 0) Object.assign(data.collections[editingCol], vals);
    else data.collections.push({ id: uniqueId(vals.name, data.collections), image: "", ...vals });
    renderCollections(); renderProducts(); changed();
  });
  $("#c-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const i = Number(b.dataset.i), cs = data.collections, c = cs[i];
    if (b.dataset.act === "edit") return openCollection(i);
    if (b.dataset.act === "up") [cs[i - 1], cs[i]] = [cs[i], cs[i - 1]];
    if (b.dataset.act === "down") [cs[i + 1], cs[i]] = [cs[i], cs[i + 1]];
    if (b.dataset.act === "toggle") c.visible = c.visible === false;
    if (b.dataset.act === "delete") {
      if (!confirm(`¿Borrar la colección “${c.name}”? Los productos no se borran, solo dejan de pertenecer a ella.`)) return;
      cs.splice(i, 1);
      for (const p of data.products) p.collections = p.collections.filter((x) => x !== c.id);
    }
    renderCollections(); renderProducts(); changed();
  });

  // ---------- Diseño / Carrito (formularios enlazados) ----------
  const fontOpts = (sel) => FONTS.map((f) => `<option ${f === sel ? "selected" : ""}>${f}</option>`).join("");
  $("#presets").innerHTML = Object.entries(PRESETS).map(([name, p]) =>
    `<button type="button" class="preset" data-preset="${name}"><i style="background:${p.primary}"></i><i style="background:${p.background};border:1px solid #0002"></i>${name}</button>`).join("");
  $("#presets").onclick = (e) => {
    const b = e.target.closest("[data-preset]"); if (!b) return;
    Object.assign(data.theme, PRESETS[b.dataset.preset]);
    fillForms(); changed();
  };

  function fillForms() {
    $("#font-select").innerHTML = fontOpts(data.theme.font);
    $("#heading-select").innerHTML = fontOpts(data.theme.headingFont);
    for (const el of $$("#design-form [name], #theme-form [name], #checkout-form [name]")) {
      const v = get(data, el.name);
      el.value = v ?? "";
    }
    $("#radius-out").textContent = data.theme.radius ?? 14;
    drawImgFields();
    drawSwatch();
  }

  function onField(e) {
    const el = e.target; if (!el.name) return;
    let v = el.value;
    if (el.type === "number" || el.type === "range") v = v === "" ? 0 : Number(v);
    set(data, el.name, v);
    if (el.name === "theme.radius") $("#radius-out").textContent = v;
    drawSwatch(); changed();
  }
  for (const id of ["#design-form", "#theme-form", "#checkout-form"]) {
    $(id).addEventListener("input", onField);
    $(id).addEventListener("submit", (e) => e.preventDefault());
  }

  function drawSwatch() {
    const t = data.theme, el = $("#swatch-preview");
    el.style.background = t.background; el.style.color = t.text;
    el.style.fontFamily = `"${t.font}", system-ui`;
    $(".sp-title", el).style.color = t.secondary;
    const card = $(".sp-card", el); card.style.background = t.surface; card.style.borderRadius = (t.radius ?? 14) + "px";
    $(".sp-img", el).style.background = `linear-gradient(145deg, ${t.primary}55, ${t.accent}55)`;
    $(".sp-price", el).style.color = t.primary;
    $(".sp-btn", el).style.background = t.primary;
  }

  function drawImgFields() {
    for (const box of $$(".img-field")) {
      const field = box.dataset.field, val = get(data, field);
      box.querySelector(".img-row")?.remove();
      const row = document.createElement("div"); row.className = "img-row";
      row.innerHTML = `${val ? `<img src="${esc(imgSrc(val))}" alt="">` : ""}
        <label class="btn ghost sm file-btn">${val ? "Cambiar" : "Subir"}<input type="file" accept="image/*" hidden></label>
        <button type="button" class="btn ghost sm" data-url>URL</button>
        ${val ? `<button type="button" class="btn ghost sm danger" data-clear>Quitar</button>` : ""}`;
      box.append(row);
      row.querySelector("input").onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          toast("Subiendo imagen…");
          set(data, field, await uploadImage(file, "assets/" + slug(field.split(".").pop())));
          drawImgFields(); changed(); toast("Imagen lista");
        } catch (err) { toast(err.status ? explain(err) : err.message, true); }
      };
      row.querySelector("[data-url]").onclick = () => {
        const url = prompt("URL de la imagen (https://…)", /^https?:/.test(val) ? val : "");
        if (url != null && (url === "" || /^https?:\/\//.test(url))) { set(data, field, url.trim()); drawImgFields(); changed(); }
      };
      const clr = row.querySelector("[data-clear]");
      if (clr) clr.onclick = () => { set(data, field, ""); drawImgFields(); changed(); };
    }
  }

  // ---------- Publicar / vista previa / respaldo ----------
  $("#preview-btn").onclick = () => {
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(withLocalImages())); } catch { toast("No se pudo crear la vista previa", true); return; }
    window.open("../?preview=1", "_blank");
  };
  // En la vista previa, las fotos recién subidas aún no están en GitHub Pages:
  // las mostramos desde la memoria del navegador.
  function withLocalImages() {
    const d = structuredClone(data);
    const fix = (s) => (localImages.has(s) ? localImages.get(s) : s);
    d.products.forEach((p) => (p.images = p.images.map(fix)));
    d.store.logo = fix(d.store.logo); d.hero.image = fix(d.hero.image);
    return d;
  }

  $("#publish-btn").onclick = async () => {
    const json = JSON.stringify(data, null, 2) + "\n";
    if (!cfg) { download(json, "store.json"); toast("Sube este archivo a data/store.json en tu repositorio"); return; }
    if (!isDirty()) { toast("No hay cambios por publicar"); return; }
    const btn = $("#publish-btn"); btn.disabled = true; btn.textContent = "Publicando…";
    try {
      const latest = await getFile(DATA_PATH);
      if (baseSha && latest.sha !== baseSha &&
          !confirm("La tienda cambió desde que abriste el panel (quizá desde otro dispositivo). ¿Sobrescribir con tu versión?")) return;
      const res = await putFile(DATA_PATH, b64encodeText(json), "Actualizar tienda desde el panel", latest.sha);
      baseSha = res.content.sha;
      published = JSON.stringify(data);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
      changed();
      toast("¡Publicado! La tienda se actualiza en 1–2 minutos.");
    } catch (err) {
      toast(explain(err), true);
    } finally { btn.disabled = false; btn.textContent = "Publicar"; }
  };

  function download(text, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $("#export-btn").onclick = () => download(JSON.stringify(data, null, 2), `respaldo-tienda-${new Date().toISOString().slice(0, 10)}.json`);
  $("#import-file").onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = ""; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d.store || !Array.isArray(d.products)) throw new Error("formato");
      if (!confirm("¿Reemplazar todo el contenido del panel con este respaldo?")) return;
      data = d; normalize(); renderAll(); toast("Respaldo cargado. Revisa y presiona Publicar.");
    } catch { toast("Ese archivo no es un respaldo válido de la tienda", true); }
  };
  $("#reload-btn").onclick = async () => {
    if (!confirm("Se perderán los cambios que no hayas publicado. ¿Continuar?")) return;
    try {
      if (cfg) await loadRemote(); else data = JSON.parse(published);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
      normalize(); renderAll(); toast("Recargado");
    } catch (err) { toast(explain(err), true); }
  };

  // ---------- Arranque ----------
  (async () => {
    const saved = readCfg();
    const f = $("#login-form");
    if (saved) {
      f.owner.value = saved.owner; f.repo.value = saved.repo; f.branch.value = saved.branch;
      cfg = saved;
      try { await loadRemote(); startPanel(); return; } catch { cfg = null; }
    }
    // Sugerencia: si el panel está en usuario.github.io/repo, rellenamos los campos.
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (m && !f.owner.value) {
      f.owner.value = m[1];
      f.repo.value = location.pathname.split("/").filter(Boolean)[0] || "";
    }
  })();
})();
