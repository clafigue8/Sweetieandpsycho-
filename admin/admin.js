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
    if (err.status === 403) return "GitHub no deja escribir con este token. Revisa: “Only select repositories” → Sweetieandpsycho- y Contents: Read and write. (GitHub dice: " + err.message + ")";
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
      if (d && JSON.stringify(d.data) !== published) {
        const sameBase = !cfg || (d.baseSha && d.baseSha === baseSha);
        const ask = sameBase
          ? "Encontramos cambios que no publicaste la última vez. ¿Quieres recuperarlos?"
          : "Hay cambios sin publicar guardados en este dispositivo, pero la tienda se actualizó después de que los hiciste.\n\n" +
            "Si los recuperas, al publicar se perderían las actualizaciones más nuevas.\n\n" +
            "Recomendado: Cancelar (carga la versión publicada). ¿Recuperarlos de todos modos?";
        if (confirm(ask)) { data = d.data; normalize(); }
        else { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } }
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
    if (!Array.isArray(data.hero.slides)) {
      const h = data.hero;
      data.hero = { autoplay: 5, slides: [{ image: h.image || "", title: h.title || data.store.name || "", subtitle: h.subtitle || "", cta: h.cta || "Ver catálogo", link: "#/colecciones" }] };
    }
    data.home ??= { showCollections: true, sections: [{ type: "new", title: "Lo nuevo", collection: "", visible: true }, { type: "sale", title: "Ofertas", collection: "", visible: true }] };
    data.home.sections ??= [];
    data.store.paymentOptions ??= [];
    data.store.shippingOptions ??= Number(data.store.shippingCost) ? [{ name: "Envío", note: "", price: Number(data.store.shippingCost), address: true }] : [];
  }

  // ---------- Estado ----------
  const isDirty = () => JSON.stringify(data) !== published;
  function changed() {
    $("#dirty").hidden = !isDirty();
    $("#store-name").textContent = data.store.name || "Tienda";
    if (isDirty()) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ data, baseSha })); } catch { /* */ } }
  }
  window.addEventListener("beforeunload", (e) => { if (data && isDirty()) { e.preventDefault(); e.returnValue = ""; } });

  function renderAll() {
    renderProducts(); renderCollections(); renderRestock(); renderHomeTab(); fillForms(); changed();
  }

  // ---------- Pestañas ----------
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tab").forEach((t) => (t.hidden = t.id !== "tab-" + b.dataset.tab));
  });

  // ---------- Productos ----------
  const STATUS = { active: "Activo", draft: "Borrador", archived: "Archivado" };
  const isOut = (p) => p.stock !== "" && p.stock != null && Number(p.stock) <= 0;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const splitList = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  /** Colecciones cuyas palabras clave aparecen en el producto. */
  function autoCollections(p) {
    const text = " " + norm([p.name, p.description, (p.tags || []).join(" ")].join(" ")).replace(/[^a-z0-9ñ]+/g, " ") + " ";
    return data.collections.filter((c) => (c.keywords || []).some((k) => {
      const kw = norm(k).replace(/[^a-z0-9ñ]+/g, " ").trim();
      return kw && text.includes(" " + kw);
    })).map((c) => c.id);
  }
  $("#p-search").oninput = renderProducts;
  $("#p-filter").onchange = renderProducts;

  function renderProducts() {
    const q = $("#p-search").value.trim().toLowerCase();
    const st = $("#p-filter").value;
    const match = (p) => st === "all" || p.status === st || (st === "soldout" && isOut(p)) || (st === "restock" && p.restock);
    const list = data.products.filter((p) => match(p) && (!q || (p.name + " " + (p.tags || []).join(" ")).toLowerCase().includes(q)));
    const colName = (id) => data.collections.find((c) => c.id === id)?.name || id;
    $("#p-list").innerHTML = list.length ? list.map((p) => {
      const i = data.products.indexOf(p);
      const stock = p.stock === "" || p.stock == null ? "∞" : p.stock;
      return `<div class="item">
        ${p.images[0] ? `<img class="thumb" src="${esc(imgSrc(p.images[0]))}" alt="" loading="lazy">` : `<div class="thumb">${esc(p.name[0] || "?")}</div>`}
        <div>
          <h3>${esc(p.name)} ${p.featured ? "★" : ""}</h3>
          <div class="meta">
            <span class="status ${p.status}">${STATUS[p.status] || p.status}</span>
            <span>${money(p.price)}</span>
            ${isOut(p) ? `<span class="tag out">Agotado</span>` : `<span>Inventario: ${esc(stock)}</span>`}
            ${p.restock ? `<span class="tag">🛒 Por comprar${p.trending ? " 🔥" : ""}</span>` : ""}
            <span>${esc(p.collections.map(colName).join(", ") || "Sin colección")}</span>
          </div>
        </div>
        <div class="actions">
          <button class="btn ghost sm" data-act="edit" data-i="${i}">Editar</button>
          ${isOut(p) ? `<button class="btn ghost sm" data-act="instock" data-i="${i}">Hay inventario</button>`
                     : `<button class="btn ghost sm" data-act="soldout" data-i="${i}">Agotado</button>`}
          <button class="btn ghost sm" data-act="restock" data-i="${i}">${p.restock ? "Quitar de compras" : "🛒 A compras"}</button>
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
    if (b.dataset.act === "soldout") { p.stock = 0; toast("Marcado como agotado"); }
    if (b.dataset.act === "instock") {
      const n = prompt(`¿Cuántas piezas de “${p.name}” tienes ahora? (vacío = sin control de inventario)`, "");
      if (n == null) return;
      p.stock = n.trim() === "" ? "" : Math.max(0, Math.round(Number(n)) || 0);
      toast("Inventario actualizado");
    }
    if (b.dataset.act === "restock") {
      p.restock = !p.restock;
      toast(p.restock ? "Agregado a la lista de compras" : "Quitado de la lista de compras");
    }
    if (b.dataset.act === "archive") { p.status = "archived"; toast("Producto archivado (oculto en la tienda)"); }
    if (b.dataset.act === "restore") { p.status = "active"; toast("Producto activo otra vez"); }
    if (b.dataset.act === "delete") {
      if (!confirm(`¿Borrar “${p.name}” definitivamente? Si solo quieres ocultarlo, usa Archivar.`)) return;
      data.products.splice(i, 1); toast("Producto borrado");
    }
    renderProducts(); renderRestock(); changed();
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
    f.restock.checked = !!p.restock; f.restockQty.value = p.restockQty ?? ""; f.restockNote.value = p.restockNote || "";
    f.trending.checked = !!p.trending; f.tags.value = (p.tags || []).join(", ");
    $("#p-collections").innerHTML = data.collections.length ? data.collections.map((c) =>
      `<label><input type="checkbox" value="${esc(c.id)}" ${p.collections.includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("")
      : `<span class="muted">Aún no hay colecciones.</span>`;
    $("#p-delete").hidden = index < 0;
    editing.manual = new Set(); // colecciones que tocó a mano
    autoHint();
    drawImages();
    $("#p-dialog").showModal();
  }

  // Marca solas las colecciones según palabras clave (solo en productos nuevos;
  // si tocas una casilla a mano, se respeta).
  function autoHint() {
    const f = $("#p-form");
    const ids = autoCollections({ name: f.name.value, description: f.description.value, tags: splitList(f.tags.value) });
    if (editing.index < 0) {
      for (const box of $$("#p-collections input")) {
        if (editing.manual.has(box.value)) continue;
        box.checked = ids.includes(box.value);
      }
    }
    const names = ids.map((id) => data.collections.find((c) => c.id === id)?.name).filter(Boolean);
    $("#p-auto-hint").textContent = names.length
      ? (editing.index < 0 ? "Marcadas por palabras clave: " : "Por sus palabras clave encajaría en: ") + names.join(", ")
      : "";
  }
  for (const n of ["name", "description", "tags"]) $("#p-form")[n].addEventListener("input", autoHint);
  $("#p-collections").addEventListener("change", (e) => editing?.manual.add(e.target.value));
  $("#p-soldout").onclick = () => { $("#p-form").stock.value = 0; toast("Inventario en 0: se mostrará como Agotado al guardar"); };

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
      restock: f.restock.checked,
      restockQty: f.restockQty.value === "" ? "" : Number(f.restockQty.value),
      restockNote: f.restockNote.value.trim(),
      trending: f.trending.checked,
      tags: splitList(f.tags.value),
      createdAt: old?.createdAt || new Date().toISOString().slice(0, 10),
    };
    if (old) data.products[editing.index] = p; else data.products.unshift(p);
    renderProducts(); renderRestock(); changed();
    toast("Guardado. Presiona “Publicar” para que se vea en la tienda.");
  });

  $("#p-delete").onclick = () => {
    const p = data.products[editing.index];
    if (!confirm(`¿Borrar “${p.name}” definitivamente?`)) return;
    data.products.splice(editing.index, 1);
    $("#p-dialog").close(); renderProducts(); changed();
  };

  // ---------- Lista de compras ----------
  function restockSorted() {
    return data.products.filter((p) => p.restock)
      .sort((a, b) => (b.trending ? 1 : 0) - (a.trending ? 1 : 0) || a.name.localeCompare(b.name));
  }
  function restockRow(p, suggest) {
    const i = data.products.indexOf(p);
    return `<div class="item">
      ${p.images[0] ? `<img class="thumb" src="${esc(imgSrc(p.images[0]))}" alt="" loading="lazy">` : `<div class="thumb">${esc(p.name[0] || "?")}</div>`}
      <div>
        <h3>${p.trending ? "🔥 " : ""}${esc(p.name)}</h3>
        <div class="meta">
          ${isOut(p) ? `<span class="tag out">Agotado</span>` : `<span>Inventario: ${p.stock === "" || p.stock == null ? "∞" : esc(p.stock)}</span>`}
          <span>${money(p.price)}</span>
          ${!suggest && p.restockQty ? `<span>Comprar: <b>${esc(p.restockQty)}</b></span>` : ""}
          ${!suggest && p.restockNote ? `<span>${esc(p.restockNote)}</span>` : ""}
        </div>
      </div>
      <div class="actions">
        ${suggest
          ? `<button class="btn ghost sm" data-r="add" data-i="${i}">🛒 Agregar</button>`
          : `<button class="btn ghost sm" data-r="trend" data-i="${i}">${p.trending ? "Quitar 🔥" : "🔥 Tendencia"}</button>
             <button class="btn sm" data-r="arrived" data-i="${i}">Ya llegó</button>
             <button class="btn ghost sm" data-r="edit" data-i="${i}">Editar</button>
             <button class="btn ghost sm danger" data-r="remove" data-i="${i}">Quitar</button>`}
      </div>
    </div>`;
  }
  function renderRestock() {
    const list = restockSorted();
    $("#restock-count").textContent = list.length || "";
    $("#r-list").innerHTML = list.length ? list.map((p) => restockRow(p, false)).join("")
      : `<p class="empty">La lista está vacía. Usa “🛒 A compras” en un producto para agregarlo.</p>`;
    const sug = data.products.filter((p) => !p.restock && isOut(p) && p.status !== "archived");
    $("#r-suggest").innerHTML = sug.length ? sug.map((p) => restockRow(p, true)).join("") : `<p class="empty">No hay otros agotados.</p>`;
  }
  $("#tab-restock").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]"); if (!b) return;
    const p = data.products[Number(b.dataset.i)];
    const act = b.dataset.r;
    if (act === "edit") return openProduct(Number(b.dataset.i));
    if (act === "add") p.restock = true;
    if (act === "trend") p.trending = !p.trending;
    if (act === "remove") p.restock = false;
    if (act === "arrived") {
      const n = prompt(`¿Cuántas piezas de “${p.name}” llegaron?`, p.restockQty || "");
      if (n == null) return;
      const got = Math.max(0, Math.round(Number(n)) || 0);
      if (p.stock !== "" && p.stock != null) p.stock = Math.max(0, Number(p.stock)) + got;
      else if (got) p.stock = got;
      p.restock = false; p.restockQty = ""; p.trending = false;
      if (p.status === "archived") p.status = "active";
      toast(`Listo: inventario de “${p.name}” en ${p.stock === "" ? "∞" : p.stock}`);
    }
    renderRestock(); renderProducts(); changed();
  });
  $("#r-copy").onclick = async () => {
    const text = "🛒 Lista de compras — " + (data.store.name || "") + "\n\n" + restockSorted().map((p) =>
      `${p.trending ? "🔥 " : "• "}${p.name}${p.restockQty ? ` × ${p.restockQty}` : ""}${p.restockNote ? ` — ${p.restockNote}` : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Lista copiada: pégala en WhatsApp o Notas"); }
    catch { prompt("Copia la lista:", text); }
  };

  // ---------- Colecciones ----------
  function renderCollections() {
    const count = (id) => data.products.filter((p) => p.collections.includes(id)).length;
    $("#c-list").innerHTML = data.collections.length ? data.collections.map((c, i) => `
      <div class="item">
        ${c.image ? `<img class="thumb" src="${esc(imgSrc(c.image))}" alt="" loading="lazy">` : `<div class="thumb">${esc(c.name[0] || "?")}</div>`}
        <div>
          <h3>${esc(c.name)}</h3>
          <div class="meta">
            <span class="status ${c.visible !== false ? "active" : "draft"}">${c.visible !== false ? "Visible" : "Oculta"}</span>
            <span>${count(c.id)} producto(s)</span>
            ${c.description ? `<span>${esc(c.description)}</span>` : ""}
            ${(c.keywords || []).length ? `<span>🔑 ${esc(c.keywords.join(", "))}</span>` : ""}
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

  $("#c-apply").onclick = () => {
    if (!data.collections.some((c) => (c.keywords || []).length)) { toast("Primero agrega palabras clave a alguna colección (Editar)"); return; }
    const changes = [];
    for (const p of data.products) {
      const add = autoCollections(p).filter((id) => !p.collections.includes(id));
      if (add.length) changes.push([p, add]);
    }
    if (!changes.length) { toast("Todos los productos ya están en sus colecciones"); return; }
    const total = changes.reduce((n, [, a]) => n + a.length, 0);
    const sample = changes.slice(0, 8).map(([p, a]) => `• ${p.name} → ${a.map((id) => data.collections.find((c) => c.id === id).name).join(", ")}`).join("\n");
    if (!confirm(`Se agregarán ${total} asignaciones en ${changes.length} productos (no se quita ninguna). Por ejemplo:\n\n${sample}${changes.length > 8 ? "\n…" : ""}\n\n¿Continuar?`)) return;
    for (const [p, add] of changes) p.collections.push(...add);
    renderCollections(); renderProducts(); changed();
    toast(`Listo: ${changes.length} productos agregados a sus colecciones`);
  };

  let editingCol = -1;
  let editingColImage = "";
  function drawColImage() {
    const v = editingColImage, row = $("#c-image");
    row.innerHTML = `${v ? `<img src="${esc(imgSrc(v))}" alt="">` : ""}
      <label class="btn ghost sm file-btn">${v ? "Cambiar" : "Subir"}<input type="file" accept="image/*" hidden></label>
      <button type="button" class="btn ghost sm" data-url>URL</button>
      ${v ? `<button type="button" class="btn ghost sm danger" data-clear>Quitar</button>` : ""}`;
    row.querySelector("input").onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        toast("Subiendo portada…");
        editingColImage = await uploadImage(file, "assets/collections/" + slug($("#c-form").name.value || "coleccion"));
        drawColImage(); toast("Portada lista");
      } catch (err) { toast(err.status ? explain(err) : err.message, true); }
    };
    row.querySelector("[data-url]").onclick = () => {
      const url = prompt("URL de la imagen (https://…)", /^https?:/.test(v) ? v : "");
      if (url != null && (url === "" || /^https?:\/\//.test(url))) { editingColImage = url.trim(); drawColImage(); }
    };
    const clr = row.querySelector("[data-clear]");
    if (clr) clr.onclick = () => { editingColImage = ""; drawColImage(); };
  }
  $("#c-new").onclick = () => openCollection(-1);
  function openCollection(i) {
    editingCol = i;
    const c = i >= 0 ? data.collections[i] : { name: "", description: "", visible: true };
    const f = $("#c-form");
    $("#c-title").textContent = i >= 0 ? "Editar colección" : "Nueva colección";
    f.name.value = c.name; f.description.value = c.description || ""; f.visible.checked = c.visible !== false;
    f.keywords.value = (c.keywords || []).join(", ");
    editingColImage = c.image || ""; drawColImage();
    $("#c-dialog").showModal();
  }
  $("#c-form").addEventListener("submit", (e) => {
    if (e.submitter?.value !== "save") return;
    const f = e.target;
    const vals = { name: f.name.value.trim(), description: f.description.value.trim(), visible: f.visible.checked, image: editingColImage, keywords: splitList(f.keywords.value) };
    if (editingCol >= 0) Object.assign(data.collections[editingCol], vals);
    else data.collections.push({ id: uniqueId(vals.name, data.collections), ...vals });
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
    renderShipping();
    renderPayments();
    drawImgFields();
    drawSwatch();
  }

  function renderShipping() {
    const list = data.store.shippingOptions;
    $("#ship-list").innerHTML = list.map((o, i) => `
      <div class="sec-item" data-i="${i}">
        <label>Nombre<input data-k="name" value="${esc(o.name)}" placeholder="Envío en Tegucigalpa"></label>
        <label>Detalle (opcional)<input data-k="note" value="${esc(o.note || "")}" placeholder="Ej.: horario o zona"></label>
        <label style="max-width:120px">Costo (0 = gratis)<input data-k="price" type="number" min="0" step="0.01" value="${Number(o.price) || 0}"></label>
        <label class="check" style="flex:0 0 auto"><input type="checkbox" data-k="address" ${o.address === false ? "" : "checked"}> Pide dirección</label>
        <div class="actions"><button type="button" class="btn ghost sm danger" data-del="${i}">Borrar</button></div>
      </div>`).join("") || `<p class="empty">Sin formas de entrega: no se cobrará envío.</p>`;
  }
  $("#ship-list").addEventListener("input", (e) => {
    const k = e.target.dataset.k; if (!k) return;
    const o = data.store.shippingOptions[Number(e.target.closest("[data-i]").dataset.i)];
    o[k] = k === "price" ? Number(e.target.value) || 0 : k === "address" ? e.target.checked : e.target.value;
    changed();
  });
  $("#ship-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    data.store.shippingOptions.splice(Number(b.dataset.del), 1); renderShipping(); changed();
  });
  $("#ship-new").onclick = () => { data.store.shippingOptions.push({ name: "", note: "", price: 0, address: true }); renderShipping(); changed(); };

  function renderPayments() {
    const list = data.store.paymentOptions;
    $("#pay-list").innerHTML = list.map((o, i) => `
      <div class="sec-item" data-i="${i}">
        <label>Nombre<input data-k="name" value="${esc(o.name)}" placeholder="Tarjeta de crédito o débito"></label>
        <label>Detalle (opcional)<input data-k="note" value="${esc(o.note || "")}" placeholder="Ej.: te enviamos un link de pago"></label>
        <div class="actions">
          <button type="button" class="btn ghost sm" data-mv="-1" data-i2="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn ghost sm danger" data-del="${i}">Borrar</button>
        </div>
      </div>`).join("") || `<p class="empty">Sin formas de pago: no se le preguntará a la clienta.</p>`;
  }
  $("#pay-list").addEventListener("input", (e) => {
    const k = e.target.dataset.k; if (!k) return;
    data.store.paymentOptions[Number(e.target.closest("[data-i]").dataset.i)][k] = e.target.value;
    changed();
  });
  $("#pay-list").addEventListener("click", (e) => {
    const arr = data.store.paymentOptions;
    const del = e.target.closest("[data-del]");
    const mv = e.target.closest("[data-mv]");
    if (del) arr.splice(Number(del.dataset.del), 1);
    else if (mv) { const i = Number(mv.dataset.i2); [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }
    else return;
    renderPayments(); changed();
  });
  $("#pay-new").onclick = () => { data.store.paymentOptions.push({ name: "", note: "" }); renderPayments(); changed(); };

  $("#order-test").onclick = async () => {
    const key = (data.store.orderKey || "").trim();
    if (!key) { toast("Primero pega tu Access Key", true); return; }
    const btn = $("#order-test"); btn.disabled = true;
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ access_key: key, subject: "🧪 Pedido de prueba — " + (data.store.name || "Tienda"), from_name: data.store.name || "Tienda",
          message: "Si te llegó este correo, los pedidos de la tienda ya llegan a tu correo. 💜" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.success !== false) toast("¡Enviado! Revisa tu correo (y la carpeta de spam). Luego presiona Publicar.");
      else toast("Web3Forms rechazó la clave: " + (j.message || res.status), true);
    } catch { toast("No se pudo conectar con Web3Forms", true); }
    finally { btn.disabled = false; }
  };

  function onField(e) {
    const el = e.target; if (!el.name) return;
    let v = el.name === "store.orderKey" ? el.value.trim() : el.value;
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

  // ---------- Inicio: carrusel y secciones ----------
  function linkOptions(sel) {
    const opts = [["#/colecciones", "Página de colecciones"], ["#/nuevo", "Lo nuevo"], ["#/descuentos", "Ofertas"], ["#/todo", "Todos los productos"],
      ...data.collections.map((c) => [`#/coleccion/${encodeURIComponent(c.id)}`, "Colección: " + c.name])];
    if (sel && !opts.some(([v]) => v === sel)) opts.push([sel, sel]);
    return opts.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join("");
  }

  function renderHomeTab() {
    const h = data.hero, home = data.home;
    $("#autoplay").value = String(h.autoplay || 5);
    $("#show-cols").checked = home.showCollections !== false;
    $("#slides-list").innerHTML = h.slides.length ? h.slides.map((s, i) => `
      <div class="slide-item" data-i="${i}">
        <div>
          <div class="slide-img" style="${s.image ? `background-image:url('${esc(imgSrc(s.image))}')` : ""}">${s.image ? "" : "Fondo de colores del tema"}</div>
          <div class="row" style="margin-top:.4rem">
            <label class="btn ghost sm file-btn">${s.image ? "Cambiar" : "Subir"}<input type="file" accept="image/*" data-up hidden></label>
            <button type="button" class="btn ghost sm" data-s="url">URL</button>
            ${s.image ? `<button type="button" class="btn ghost sm danger" data-s="noimg">Quitar</button>` : ""}
          </div>
        </div>
        <div class="fields">
          <div class="row">
            <label>Título (opcional)<input data-f="title" value="${esc(s.title)}"></label>
            <label>Texto del botón<input data-f="cta" value="${esc(s.cta)}"></label>
          </div>
          <label>Subtítulo (opcional)<input data-f="subtitle" value="${esc(s.subtitle)}"></label>
          <label>Al tocar, ir a<select data-f="link">${linkOptions(s.link)}</select></label>
          <div class="actions" style="justify-content:flex-start">
            <button type="button" class="btn ghost sm" data-s="up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="btn ghost sm" data-s="down" ${i === h.slides.length - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="btn ghost sm danger" data-s="del">Borrar</button>
          </div>
        </div>
      </div>`).join("") : `<p class="empty">Sin imágenes: se mostrará una portada con el nombre de la tienda.</p>`;

    const types = [["new", "Lo nuevo"], ["sale", "Ofertas (con precio tachado)"], ["featured", "Destacados ★"], ["collection", "Una colección"]];
    $("#sections-list").innerHTML = home.sections.length ? home.sections.map((s, i) => `
      <div class="sec-item" data-i="${i}">
        <label>Título<input data-f="title" value="${esc(s.title)}"></label>
        <label>Muestra<select data-f="type">${types.map(([v, l]) => `<option value="${v}" ${v === s.type ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        ${s.type === "collection" ? `<label>Colección<select data-f="collection">${data.collections.map((c) =>
          `<option value="${esc(c.id)}" ${c.id === s.collection ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
        <div class="actions">
          <button type="button" class="btn ghost sm" data-s="up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn ghost sm" data-s="down" ${i === home.sections.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn ghost sm" data-s="toggle">${s.visible === false ? "Mostrar" : "Ocultar"}</button>
          <button type="button" class="btn ghost sm danger" data-s="del">Borrar</button>
        </div>
      </div>`).join("") : `<p class="empty">Sin secciones.</p>`;
  }

  function listHandlers(listSel, getArr) {
    const el = $(listSel);
    el.addEventListener("input", (e) => {
      const f = e.target.dataset.f; if (!f) return;
      const i = Number(e.target.closest("[data-i]").dataset.i);
      getArr()[i][f] = e.target.value;
      if (f === "type") {
        const s = getArr()[i];
        if (s.type === "collection" && !s.collection) s.collection = data.collections[0]?.id || "";
        renderHomeTab();
      }
      changed();
    });
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-s]"); if (!b) return;
      const arr = getArr(), i = Number(b.closest("[data-i]").dataset.i);
      const act = b.dataset.s;
      if (act === "up") [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (act === "down") [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      if (act === "del") { if (!confirm("¿Borrar este elemento?")) return; arr.splice(i, 1); }
      if (act === "toggle") arr[i].visible = arr[i].visible === false;
      if (act === "noimg") arr[i].image = "";
      if (act === "url") {
        const url = prompt("URL de la imagen (https://…)", /^https?:/.test(arr[i].image) ? arr[i].image : "");
        if (url == null || !(url === "" || /^https?:\/\//.test(url))) return;
        arr[i].image = url.trim();
      }
      renderHomeTab(); changed();
    });
    el.addEventListener("change", async (e) => {
      if (!e.target.matches("[data-up]")) return;
      const file = e.target.files[0]; if (!file) return;
      const i = Number(e.target.closest("[data-i]").dataset.i);
      try {
        toast("Subiendo imagen…");
        getArr()[i].image = await uploadImage(file, "assets/slides/slide");
        renderHomeTab(); changed(); toast("Imagen lista");
      } catch (err) { toast(err.status ? explain(err) : err.message, true); }
    });
  }
  listHandlers("#slides-list", () => data.hero.slides);
  listHandlers("#sections-list", () => data.home.sections);
  $("#slide-new").onclick = () => {
    data.hero.slides.push({ image: "", title: "", subtitle: "", cta: "Ver catálogo", link: "#/colecciones" });
    renderHomeTab(); changed();
  };
  $("#section-new").onclick = () => {
    data.home.sections.push({ type: "collection", title: "", collection: data.collections[0]?.id || "", visible: true });
    renderHomeTab(); changed();
  };
  $("#autoplay").onchange = (e) => { data.hero.autoplay = Number(e.target.value); changed(); };
  $("#show-cols").onchange = (e) => { data.home.showCollections = e.target.checked; changed(); };

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
    d.store.logo = fix(d.store.logo);
    d.hero.slides.forEach((x) => (x.image = fix(x.image)));
    d.collections.forEach((c) => (c.image = fix(c.image)));
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
