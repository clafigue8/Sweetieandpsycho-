/* Sweetie & Psycho — tienda pública.
 * Todo el contenido (colores, colecciones, productos, ajustes del carrito)
 * vive en data/store.json y se edita desde /admin. */
(() => {
  "use strict";

  const CART_KEY = "sp-cart";
  const PREVIEW_KEY = "sp-preview";
  const $ = (s, el = document) => el.querySelector(s);

  let DATA = null;
  let cart = load(CART_KEY) || [];
  let modalState = null;

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* sin almacenamiento */ }
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function money(n) {
    const s = DATA.store;
    try {
      return new Intl.NumberFormat(s.locale || "es-MX", { style: "currency", currency: s.currency || "MXN" }).format(n || 0);
    } catch { return "$" + Number(n || 0).toFixed(2); }
  }

  // ---------- Carga ----------
  async function init() {
    const usePreview = new URLSearchParams(location.search).has("preview");
    const preview = usePreview ? load(PREVIEW_KEY) : null;
    if (preview) {
      DATA = preview;
    } else {
      const res = await fetch("data/store.json?v=" + Date.now());
      DATA = await res.json();
    }
    applyTheme();
    renderChrome(usePreview && preview);
    pruneCart();
    updateCartCount();
    route();
    window.addEventListener("hashchange", route);
  }

  function applyTheme() {
    const t = DATA.theme || {};
    const r = document.documentElement.style;
    const map = { primary: "--primary", secondary: "--secondary", accent: "--accent", background: "--bg", surface: "--surface", text: "--text" };
    for (const [k, v] of Object.entries(map)) if (t[k]) r.setProperty(v, t[k]);
    if (t.radius != null) r.setProperty("--radius", t.radius + "px");
    const fonts = [t.font, t.headingFont].filter(Boolean);
    if (t.font) r.setProperty("--font", `"${t.font}", system-ui, sans-serif`);
    if (t.headingFont) r.setProperty("--heading", `"${t.headingFont}", var(--font)`);
    if (fonts.length) {
      const fam = [...new Set(fonts)].map((f) => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;600;700").join("&");
      $("#font-link").href = `https://fonts.googleapis.com/css2?${fam}&display=swap`;
    }
  }

  function renderChrome(isPreview) {
    const s = DATA.store;
    document.title = s.name + (s.tagline ? " — " + s.tagline : "");
    $("#brand").innerHTML = s.logo
      ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}">`
      : esc(s.name);
    const ann = $("#announcement");
    const annText = isPreview ? "Vista previa — estos cambios aún no están publicados" : s.announcement;
    ann.hidden = !annText;
    ann.textContent = annText || "";
    const links = [];
    if (s.instagram) links.push(`<a href="https://instagram.com/${esc(s.instagram.replace(/^@/, ""))}" target="_blank" rel="noopener">Instagram</a>`);
    if (s.whatsapp) links.push(`<a href="https://wa.me/${esc(onlyDigits(s.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a>`);
    if (s.email) links.push(`<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>`);
    $("#footer").innerHTML = `<div>${links.join("")}</div><p>© ${new Date().getFullYear()} ${esc(s.name)}</p>`;
  }

  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

  // ---------- Datos ----------
  const activeProducts = () => DATA.products.filter((p) => p.status === "active");
  const visibleCollections = () => DATA.collections.filter((c) => c.visible !== false &&
    activeProducts().some((p) => (p.collections || []).includes(c.id)));
  const findProduct = (id) => DATA.products.find((p) => p.id === id);
  const inStock = (p) => p.stock == null || p.stock === "" || Number(p.stock) > 0;

  // ---------- Rutas: #/  #/coleccion/:id  #/producto/:id ----------
  function route() {
    const [, kind, id] = location.hash.replace(/^#\/?/, "/").split("/");
    if (kind === "producto" && id) {
      if (!$("#app").dataset.rendered) renderHome();
      openProduct(decodeURIComponent(id));
      return;
    }
    closeOverlay("product");
    if (kind === "coleccion" && id) renderHome(decodeURIComponent(id));
    else renderHome();
  }

  let currentCollection = null;
  let sortMode = "featured";
  let query = "";

  function renderHome(collectionId = null) {
    currentCollection = collectionId;
    const h = DATA.hero || {};
    const col = DATA.collections.find((c) => c.id === collectionId);
    const chips = visibleCollections().map((c) =>
      `<a class="chip ${c.id === collectionId ? "active" : ""}" href="#/coleccion/${encodeURIComponent(c.id)}">${esc(c.name)}</a>`).join("");

    $("#app").innerHTML = `
      ${collectionId ? "" : `
      <section class="hero ${h.image ? "has-image" : ""}" ${h.image ? `style="background-image:url('${esc(h.image)}')"` : ""}>
        <h1>${esc(h.title || DATA.store.name)}</h1>
        ${h.subtitle ? `<p>${esc(h.subtitle)}</p>` : ""}
        <a class="btn light" href="#productos">${esc(h.cta || "Comprar")}</a>
      </section>`}
      <nav class="chips" id="productos" aria-label="Colecciones">
        <a class="chip ${collectionId ? "" : "active"}" href="#/">Todo</a>${chips}
      </nav>
      <div class="section-head">
        <div>
          <h2>${esc(col ? col.name : "Productos")}</h2>
          ${col && col.description ? `<p>${esc(col.description)}</p>` : ""}
        </div>
        <select id="sort" aria-label="Ordenar">
          <option value="featured">Destacados</option>
          <option value="new">Más nuevos</option>
          <option value="price-asc">Precio: menor a mayor</option>
          <option value="price-desc">Precio: mayor a menor</option>
        </select>
      </div>
      <div class="grid" id="grid"></div>`;
    $("#app").dataset.rendered = "1";
    $("#sort").value = sortMode;
    $("#sort").onchange = (e) => { sortMode = e.target.value; renderGrid(); };
    if (collectionId) window.scrollTo({ top: 0 });
    renderGrid();
  }

  function renderGrid() {
    let list = activeProducts();
    if (currentCollection) list = list.filter((p) => (p.collections || []).includes(currentCollection));
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => (p.name + " " + (p.description || "")).toLowerCase().includes(q));
    }
    list = [...list];
    if (sortMode === "featured") list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    if (sortMode === "new") list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (sortMode === "price-asc") list.sort((a, b) => a.price - b.price);
    if (sortMode === "price-desc") list.sort((a, b) => b.price - a.price);

    const grid = $("#grid");
    if (!grid) return;
    grid.innerHTML = list.length ? list.map(card).join("") : `<p class="empty">No encontramos productos.</p>`;
  }

  function media(p, i = 0) {
    const src = (p.images || [])[i];
    return src
      ? `<img src="${esc(src)}" alt="${esc(p.name)}" loading="lazy">`
      : `<div class="placeholder">${esc((p.name || "?").trim()[0] || "?")}</div>`;
  }

  function card(p) {
    const sale = p.comparePrice > p.price;
    const badge = !inStock(p) ? `<span class="badge dark">Agotado</span>` : sale ? `<span class="badge">Oferta</span>` : "";
    return `<a class="card" href="#/producto/${encodeURIComponent(p.id)}">
      <div class="card-media">${media(p)}${badge}</div>
      <div class="card-body">
        <h3>${esc(p.name)}</h3>
        <div class="price">${money(p.price)}${sale ? `<s>${money(p.comparePrice)}</s>` : ""}</div>
      </div>
    </a>`;
  }

  // ---------- Ficha de producto ----------
  function openProduct(id) {
    const p = findProduct(id);
    if (!p || p.status !== "active") { location.hash = "#/"; return; }
    modalState = { p, img: 0, opt: (p.options || [])[0] || "", qty: 1 };
    drawProduct();
    openOverlay("product");
  }

  function drawProduct() {
    const { p, img, opt, qty } = modalState;
    const imgs = p.images || [];
    const sale = p.comparePrice > p.price;
    const avail = inStock(p);
    const stockTxt = p.stock === "" || p.stock == null ? "" :
      Number(p.stock) <= 0 ? "Agotado" : Number(p.stock) <= 3 ? `¡Solo quedan ${p.stock}!` : "Disponible";
    $("#product-modal").innerHTML = `
      <button class="icon-btn close" data-close="product" aria-label="Cerrar">✕</button>
      <div class="gallery">
        <div class="gallery-main">${media(p, img)}</div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((src, i) =>
          `<button class="${i === img ? "active" : ""}" data-img="${i}"><img src="${esc(src)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="detail">
        <h2>${esc(p.name)}</h2>
        <div class="price">${money(p.price)}${sale ? `<s>${money(p.comparePrice)}</s>` : ""}</div>
        ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ""}
        ${(p.options || []).length ? `<div>
          <div class="opt-label">${esc(p.optionName || "Opción")}: ${esc(opt)}</div>
          <div class="opts">${p.options.map((o) =>
            `<button class="${o === opt ? "active" : ""}" data-opt="${esc(o)}">${esc(o)}</button>`).join("")}</div>
        </div>` : ""}
        <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
          <div class="qty"><button data-qty="-1" aria-label="Menos">−</button><span>${qty}</span><button data-qty="1" aria-label="Más">+</button></div>
          ${stockTxt ? `<span class="stock">${esc(stockTxt)}</span>` : ""}
        </div>
        <button class="btn block" id="add-to-cart" ${avail ? "" : "disabled"}>${avail ? "Agregar al carrito" : "Agotado"}</button>
        ${p.paymentLink && avail ? `<a class="btn ghost block" href="${esc(p.paymentLink)}" target="_blank" rel="noopener">Comprar ahora</a>` : ""}
      </div>`;
  }

  $("#product-modal").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || !modalState) return;
    if (t.dataset.img) modalState.img = Number(t.dataset.img);
    else if (t.dataset.opt != null) modalState.opt = t.dataset.opt;
    else if (t.dataset.qty) {
      const max = modalState.p.stock === "" || modalState.p.stock == null ? 99 : Number(modalState.p.stock);
      modalState.qty = Math.min(max, Math.max(1, modalState.qty + Number(t.dataset.qty)));
    } else if (t.id === "add-to-cart") {
      addToCart(modalState.p, modalState.opt, modalState.qty);
      closeProduct();
      openOverlay("cart");
      return;
    } else return;
    drawProduct();
  });

  function closeProduct() {
    closeOverlay("product");
    if (location.hash.startsWith("#/producto/")) {
      history.replaceState(null, "", currentCollection ? `#/coleccion/${encodeURIComponent(currentCollection)}` : "#/");
    }
  }

  // ---------- Carrito ----------
  function pruneCart() {
    cart = cart.filter((l) => { const p = findProduct(l.id); return p && p.status === "active"; });
    save(CART_KEY, cart);
  }

  function addToCart(p, opt, qty) {
    const ex = cart.find((l) => l.id === p.id && l.opt === opt);
    const max = p.stock === "" || p.stock == null ? 99 : Number(p.stock);
    if (ex) ex.qty = Math.min(max, ex.qty + qty);
    else cart.push({ id: p.id, opt, qty });
    save(CART_KEY, cart);
    updateCartCount();
    toast("Agregado al carrito");
  }

  function updateCartCount() {
    $("#cart-count").textContent = cart.reduce((n, l) => n + l.qty, 0);
  }

  function totals() {
    const s = DATA.store;
    const sub = cart.reduce((n, l) => n + (findProduct(l.id)?.price || 0) * l.qty, 0);
    const free = Number(s.freeShippingOver) > 0 && sub >= Number(s.freeShippingOver);
    const ship = cart.length && !free ? Number(s.shippingCost) || 0 : 0;
    return { sub, ship, total: sub + ship, free };
  }

  let checkoutStep = false;

  function drawCart() {
    const body = $("#cart-body"), foot = $("#cart-foot");
    if (!cart.length) {
      checkoutStep = false;
      body.innerHTML = `<p class="empty">Tu carrito está vacío.</p>`;
      foot.innerHTML = `<button class="btn block" data-close="cart">Seguir comprando</button>`;
      return;
    }
    const s = DATA.store;
    const t = totals();
    const missing = Number(s.freeShippingOver) - t.sub;

    if (checkoutStep) {
      body.innerHTML = `
        <form class="checkout-form" id="checkout-form">
          <label>Nombre<input name="name" required autocomplete="name"></label>
          <label>Teléfono<input name="phone" type="tel" required autocomplete="tel"></label>
          <label>Dirección de envío<textarea name="address" rows="3" required autocomplete="street-address"></textarea></label>
          <label>Notas (opcional)<textarea name="notes" rows="2"></textarea></label>
          ${s.checkoutNote ? `<p class="hint">${esc(s.checkoutNote)}</p>` : ""}
        </form>`;
      const channels = [];
      if (s.whatsapp) channels.push(`<button class="btn block" form="checkout-form" type="submit" data-via="wa">Enviar pedido por WhatsApp</button>`);
      if (s.email) channels.push(`<button class="btn ${s.whatsapp ? "ghost" : ""} block" form="checkout-form" type="submit" data-via="mail">Enviar pedido por correo</button>`);
      if (!channels.length) channels.push(`<p class="hint">La tienda aún no tiene configurado un WhatsApp o correo para recibir pedidos.</p>`);
      foot.innerHTML = totalsHtml(t) + channels.join("") + `<button class="link-btn" id="back-cart">← Volver al carrito</button>`;
      return;
    }

    body.innerHTML = cart.map((l, i) => {
      const p = findProduct(l.id);
      return `<div class="line">
        <div class="line-img">${media(p)}</div>
        <div>
          <h4>${esc(p.name)}</h4>
          ${l.opt ? `<small>${esc(p.optionName || "Opción")}: ${esc(l.opt)}</small>` : ""}
          <small>${money(p.price)}</small>
          <div class="qty" style="margin-top:.3rem"><button data-line="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-line="${i}" data-d="1">+</button></div>
          <button class="remove" data-remove="${i}">Quitar</button>
        </div>
        <strong>${money(p.price * l.qty)}</strong>
      </div>`;
    }).join("");
    foot.innerHTML = totalsHtml(t) +
      (missing > 0 && Number(s.freeShippingOver) > 0 ? `<p class="hint">Te faltan ${money(missing)} para envío gratis.</p>` : "") +
      `<button class="btn block" id="go-checkout">Finalizar pedido</button>`;
  }

  function totalsHtml(t) {
    return `<div class="totals">
      <div><span>Subtotal</span><span>${money(t.sub)}</span></div>
      <div><span>Envío</span><span>${t.free ? "Gratis" : money(t.ship)}</span></div>
      <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
    </div>`;
  }

  $("#cart-overlay").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.line) {
      const l = cart[b.dataset.line];
      const p = findProduct(l.id);
      const max = p.stock === "" || p.stock == null ? 99 : Number(p.stock);
      l.qty = Math.min(max, l.qty + Number(b.dataset.d));
      if (l.qty <= 0) cart.splice(b.dataset.line, 1);
    } else if (b.dataset.remove) cart.splice(b.dataset.remove, 1);
    else if (b.id === "go-checkout") checkoutStep = true;
    else if (b.id === "back-cart") checkoutStep = false;
    else return;
    save(CART_KEY, cart);
    updateCartCount();
    drawCart();
  });

  $("#cart-overlay").addEventListener("submit", (e) => {
    e.preventDefault();
    const via = e.submitter?.dataset.via || (DATA.store.whatsapp ? "wa" : "mail");
    const f = Object.fromEntries(new FormData(e.target));
    const s = DATA.store, t = totals();
    const lines = cart.map((l) => {
      const p = findProduct(l.id);
      return `• ${l.qty} × ${p.name}${l.opt ? ` (${p.optionName || "Opción"}: ${l.opt})` : ""} — ${money(p.price * l.qty)}`;
    });
    const msg = [
      `¡Hola ${s.name}! Quiero hacer este pedido:`, "", ...lines, "",
      `Subtotal: ${money(t.sub)}`, `Envío: ${t.free ? "Gratis" : money(t.ship)}`, `Total: ${money(t.total)}`, "",
      `Nombre: ${f.name}`, `Teléfono: ${f.phone}`, `Dirección: ${f.address}`,
      f.notes ? `Notas: ${f.notes}` : "",
    ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
    const url = via === "wa"
      ? `https://wa.me/${onlyDigits(s.whatsapp)}?text=${encodeURIComponent(msg)}`
      : `mailto:${s.email}?subject=${encodeURIComponent("Pedido — " + f.name)}&body=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    cart = []; save(CART_KEY, cart); updateCartCount();
    checkoutStep = false;
    closeOverlay("cart");
    toast("¡Gracias! Tu pedido se abrió para enviarlo.");
  });

  // ---------- Overlays ----------
  function openOverlay(name) {
    if (name === "cart") drawCart();
    $(`#${name}-overlay`).hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeOverlay(name) {
    $(`#${name}-overlay`).hidden = true;
    if ($("#product-overlay").hidden && $("#cart-overlay").hidden) document.body.style.overflow = "";
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (c) { c.dataset.close === "product" ? closeProduct() : closeOverlay(c.dataset.close); return; }
    if (e.target.id === "product-overlay") closeProduct();
    if (e.target.id === "cart-overlay") closeOverlay("cart");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#cart-overlay").hidden) closeOverlay("cart");
    else if (!$("#product-overlay").hidden) closeProduct();
  });
  $("#cart-open").onclick = () => openOverlay("cart");
  $("#search-toggle").onclick = () => {
    const bar = $("#search-bar");
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("#search").focus();
  };
  $("#search").addEventListener("input", (e) => {
    query = e.target.value.trim();
    if (!$("#grid")) renderHome();
    renderGrid();
  });

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  init().catch((err) => {
    console.error(err);
    $("#app").innerHTML = `<p class="empty">No se pudo cargar la tienda.</p>`;
  });
})();
