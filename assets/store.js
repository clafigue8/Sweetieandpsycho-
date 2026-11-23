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
    if (s.whatsapp) {
      document.body.insertAdjacentHTML("beforeend", `<a class="wa-float" href="https://wa.me/${esc(onlyDigits(s.whatsapp))}?text=${encodeURIComponent("¡Hola " + s.name + "! Tengo una pregunta 😊")}" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.7c-2 0-4-.5-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.7 10.7 0 1 1 16 26.7zm5.9-8c-.3-.2-1.9-1-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.8 8.8 0 0 1-4.4-3.8c-.3-.6.3-.5 1-1.7.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.7 5.8 5.2 2.2.9 3 1 4.1.8.7-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5l-.6-.4z"/></svg>
      </a>`);
    }
    $("#footer").innerHTML = `<div>${links.join("")}</div><p>© ${new Date().getFullYear()} ${esc(s.name)}</p>`;
  }

  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

  // ---------- Datos ----------
  const activeProducts = () => DATA.products.filter((p) => p.status === "active");
  const visibleCollections = () => DATA.collections.filter((c) => c.visible !== false &&
    activeProducts().some((p) => (p.collections || []).includes(c.id)));
  const findProduct = (id) => DATA.products.find((p) => p.id === id);
  const priceOf = (p, opt) => (p.optionPrices && opt != null && opt in p.optionPrices ? Number(p.optionPrices[opt]) : p.price);
  const inStock = (p) => p.stock == null || p.stock === "" || Number(p.stock) > 0;

  // ---------- Rutas: #/  #/coleccion/:id  #/producto/:id ----------
  let backHash = "#/";
  function route() {
    const [, kind, id] = location.hash.replace(/^#\/?/, "/").split("/");
    if (kind === "producto" && id) {
      if (!$("#app").dataset.rendered) { backHash = "#/"; renderHome(); }
      openProduct(decodeURIComponent(id));
      return;
    }
    closeOverlay("product");
    closeOverlay("menu");
    stopSlider();
    if (kind === "coleccion" && id) renderListing({ collection: decodeURIComponent(id) });
    else if (kind === "colecciones") renderCollectionsPage();
    else if (kind === "nuevo") renderListing({ special: "new" });
    else if (kind === "descuentos") renderListing({ special: "sale" });
    else if (kind === "todo") renderListing({});
    else renderHome();
    drawMenu();
    reveal();
    backHash = location.hash || "#/";
  }

  function collectionCover(c) {
    if (c.image) return c.image;
    const p = activeProducts().find((x) => (x.collections || []).includes(c.id) && (x.images || []).length);
    return p ? p.images[0] : "";
  }
  const countIn = (id) => activeProducts().filter((p) => (p.collections || []).includes(id)).length;

  function colCard(c) {
    const img = collectionCover(c);
    return `<a class="col-card reveal" href="#/coleccion/${encodeURIComponent(c.id)}">
      <div class="card-media">${img ? `<img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="placeholder">${esc(c.name[0] || "?")}</div>`}</div>
      <div class="col-name">${esc(c.name)} <small>${countIn(c.id)}</small></div>
    </a>`;
  }

  function renderCollectionsPage() {
    $("#app").dataset.rendered = "";
    $("#app").innerHTML = `
      <h1 class="page-title">Colecciones</h1>
      <div class="col-grid">${visibleCollections().map(colCard).join("")}</div>`;
    window.scrollTo({ top: 0 });
  }

  function drawMenu() {
    const h = location.hash.replace(/^#\/?/, "");
    const link = (href, label, active, cls = "") =>
      `<a href="${href}" class="${cls} ${active ? "active" : ""}">${label}</a>`;
    $("#side-nav").innerHTML =
      link("#/", "Inicio", h === "") +
      link("#/colecciones", "Colecciones", h === "colecciones") +
      link("#/nuevo", "Lo nuevo", h === "nuevo") +
      (saleProducts().length ? link("#/descuentos", "Ofertas", h === "descuentos") : "") +
      link("#/todo", "Todos los productos", h === "todo") +
      `<div class="group">Categorías</div>` +
      visibleCollections().map((c) =>
        link(`#/coleccion/${encodeURIComponent(c.id)}`, esc(c.name), h === "coleccion/" + encodeURIComponent(c.id), "sub")).join("");
  }

  // ---------- Listas de productos ----------
  const byNew = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
  const saleProducts = () => activeProducts().filter((p) => p.comparePrice > p.price);
  const newestIds = () => new Set([...activeProducts()].sort(byNew).slice(0, 12).map((p) => p.id));

  let listing = {};
  let sortMode = "featured";
  let query = "";
  const PAGE = 48;
  let shown = PAGE;

  function listingProducts() {
    let list = activeProducts();
    if (listing.collection) list = list.filter((p) => (p.collections || []).includes(listing.collection));
    if (listing.special === "sale") list = list.filter((p) => p.comparePrice > p.price);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => (p.name + " " + (p.description || "") + " " + (p.tags || []).join(" ")).toLowerCase().includes(q));
    }
    list = [...list];
    const mode = listing.special === "new" && sortMode === "featured" ? "new" : sortMode;
    if (mode === "featured") list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    if (mode === "new") list.sort(byNew);
    if (mode === "price-asc") list.sort((a, b) => priceOf(a) - priceOf(b));
    if (mode === "price-desc") list.sort((a, b) => priceOf(b) - priceOf(a));
    return list;
  }

  function gridBlock(title, desc) {
    return `
      <div class="section-head" id="productos">
        <div>
          <h2>${esc(title)}</h2>
          ${desc ? `<p>${esc(desc)}</p>` : ""}
        </div>
        <select id="sort" aria-label="Ordenar">
          <option value="featured">${listing.special === "new" ? "Más nuevos" : "Destacados"}</option>
          ${listing.special === "new" ? "" : `<option value="new">Más nuevos</option>`}
          <option value="price-asc">Precio: menor a mayor</option>
          <option value="price-desc">Precio: mayor a menor</option>
        </select>
      </div>
      <div class="grid" id="grid"></div>`;
  }

  function bindGrid() {
    $("#app").dataset.rendered = "1";
    $("#sort").value = sortMode;
    $("#sort").onchange = (e) => { sortMode = e.target.value; shown = PAGE; renderGrid(); };
    renderGrid();
  }

  function renderListing(opts) {
    listing = opts; shown = PAGE; sortMode = "featured";
    const col = DATA.collections.find((c) => c.id === opts.collection);
    const title = col ? col.name : opts.special === "new" ? "Lo nuevo" : opts.special === "sale" ? "Ofertas" : "Todos los productos";
    $("#app").innerHTML = `
      <a class="back-link" href="${col ? "#/colecciones" : "#/"}">← ${col ? "Colecciones" : "Inicio"}</a>
      ${gridBlock(title, col && col.description)}`;
    bindGrid();
    window.scrollTo({ top: 0 });
  }

  // ---------- Inicio ----------
  function slides() {
    const h = DATA.hero || {};
    const s = (h.slides || []).filter((x) => x.image || x.title);
    return s.length ? s : [{ title: h.title || DATA.store.name, subtitle: h.subtitle, cta: h.cta || "Ver catálogo", link: "#/colecciones", image: h.image }];
  }

  function slideHtml(s, i) {
    const textual = !!s.title;
    const inner = textual
      ? `<div class="slide-text"><h1>${esc(s.title)}</h1>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ""}
         ${s.cta ? `<span class="btn light">${esc(s.cta)}</span>` : ""}</div>`
      : `${s.cta ? `<span class="btn light slide-cta">${esc(s.cta)}</span>` : ""}`;
    return `<a class="slide ${textual ? "textual" : ""} ${s.image ? "has-image" : ""}" href="${esc(s.link || "#/colecciones")}"
      ${s.image ? `style="background-image:url('${esc(s.image)}')"` : ""} aria-label="${esc(s.title || s.cta || "Ver")}" data-i="${i}">${inner}</a>`;
  }

  function homeSections() {
    return (DATA.home && DATA.home.sections) || [
      { type: "new", title: "Lo nuevo" },
      { type: "sale", title: "Ofertas" },
    ];
  }

  function sectionHtml(sec) {
    let list = [], link = "#/todo";
    if (sec.type === "new") { list = [...activeProducts()].sort(byNew); link = "#/nuevo"; }
    else if (sec.type === "sale") { list = saleProducts(); link = "#/descuentos"; }
    else if (sec.type === "featured") { list = activeProducts().filter((p) => p.featured); }
    else if (sec.type === "collection") {
      list = activeProducts().filter((p) => (p.collections || []).includes(sec.collection)).sort(byNew);
      link = `#/coleccion/${encodeURIComponent(sec.collection)}`;
    }
    if (!list.length || sec.visible === false) return "";
    const title = sec.title || DATA.collections.find((c) => c.id === sec.collection)?.name || "";
    return `<section class="home-section reveal">
      <div class="row-head"><h2>${esc(title)}</h2><a href="${link}">Ver todo →</a></div>
      <div class="scroller">${list.slice(0, 12).map(card).join("")}<a class="see-all" href="${link}">Ver todo<span>→</span></a></div>
    </section>`;
  }

  function renderHome() {
    listing = {}; shown = PAGE;
    const ss = slides();
    const home = DATA.home || {};
    const cols = visibleCollections();
    $("#app").innerHTML = `
      <section class="slider" id="slider">
        <div class="slides" id="slides">${ss.map(slideHtml).join("")}</div>
        ${ss.length > 1 ? `<div class="dots">${ss.map((_, i) => `<button data-dot="${i}" aria-label="Imagen ${i + 1}"></button>`).join("")}</div>` : ""}
      </section>
      ${home.showCollections === false || !cols.length ? "" : `
      <section class="home-section reveal">
        <div class="row-head"><h2>Colecciones</h2><a href="#/colecciones">Ver todas →</a></div>
        <div class="scroller cols">${cols.map(colCard).join("")}</div>
      </section>`}
      ${homeSections().map(sectionHtml).join("")}
      ${gridBlock("Todos los productos")}`;
    bindGrid();
    startSlider(ss.length);
  }

  // Carrusel: se desliza con el dedo (scroll-snap) y avanza solo.
  let sliderTimer = null;
  function stopSlider() { clearInterval(sliderTimer); sliderTimer = null; }
  function startSlider(n) {
    const track = $("#slides");
    if (!track || n < 2) return;
    const dots = [...document.querySelectorAll("[data-dot]")];
    const idx = () => Math.round(track.scrollLeft / track.clientWidth);
    const mark = () => dots.forEach((d, i) => d.classList.toggle("active", i === idx()));
    const go = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" });
    mark();
    track.addEventListener("scroll", () => requestAnimationFrame(mark), { passive: true });
    dots.forEach((d) => (d.onclick = () => { go(Number(d.dataset.dot)); restart(); }));
    const secs = Number(DATA.hero?.autoplay) || 5;
    const restart = () => { stopSlider(); sliderTimer = setInterval(() => go((idx() + 1) % n), secs * 1000); };
    track.addEventListener("pointerdown", restart, { passive: true });
    restart();
  }

  function renderGrid() {
    const list = listingProducts();
    const grid = $("#grid");
    if (!grid) return;
    grid.innerHTML = list.length ? list.slice(0, shown).map(card).join("") : `<p class="empty">No encontramos productos.</p>`;
    $("#more")?.remove();
    if (list.length > shown) {
      grid.insertAdjacentHTML("afterend", `<div class="more" id="more"><button class="btn ghost">Ver más (${list.length - shown})</button></div>`);
      $("#more button").onclick = () => { shown += PAGE; renderGrid(); };
    }
    reveal();
  }

  // Aparición suave al bajar por la página
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -40px 0px" }) : null;
  function reveal() {
    document.querySelectorAll(".reveal:not(.in)").forEach((el) => (io ? io.observe(el) : el.classList.add("in")));
  }

  function media(p, i = 0) {
    const src = (p.images || [])[i];
    return src
      ? `<img src="${esc(src)}" alt="${esc(p.name)}" loading="lazy">`
      : `<div class="placeholder">${esc((p.name || "?").trim()[0] || "?")}</div>`;
  }

  let NEWEST = null;
  function card(p) {
    NEWEST ??= newestIds();
    const sale = p.comparePrice > p.price;
    const pct = sale ? Math.round((1 - p.price / p.comparePrice) * 100) : 0;
    const few = p.stock !== "" && p.stock != null && Number(p.stock) > 0 && Number(p.stock) <= 3;
    const badges = !inStock(p) ? `<span class="badge dark">Agotado</span>`
      : (sale ? `<span class="badge">−${pct}%</span>` : NEWEST.has(p.id) ? `<span class="badge new">Nuevo</span>` : "") +
        (few ? `<span class="badge warn">Últimas piezas</span>` : "");
    const alt = (p.images || [])[1];
    return `<a class="card reveal" href="#/producto/${encodeURIComponent(p.id)}">
      <div class="card-media">${media(p)}${alt ? `<img class="alt" src="${esc(alt)}" alt="" loading="lazy">` : ""}<div class="badges">${badges}</div></div>
      <div class="card-body">
        <h3>${esc(p.name)}</h3>
        <div class="price">${p.optionPrices ? "Desde " : ""}${money(p.price)}${sale ? `<s>${money(p.comparePrice)}</s>` : ""}</div>
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
        <div class="price">${money(priceOf(p, opt))}${sale ? `<s>${money(p.comparePrice)}</s>` : ""}</div>
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
      history.replaceState(null, "", backHash);
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

  // Formas de entrega (si no hay, se usa un costo de envío único)
  const SHIP_KEY = "sp-ship";
  function shipOptions() {
    const o = (DATA.store.shippingOptions || []).filter((x) => x.name);
    return o.length ? o : [{ name: "Envío", price: Number(DATA.store.shippingCost) || 0, address: true }];
  }
  function currentShip() {
    const o = shipOptions();
    let i = Number(load(SHIP_KEY));
    if (!(i >= 0 && i < o.length)) i = 0;
    return { ...o[i], index: i };
  }

  function totals() {
    const s = DATA.store;
    const sub = cart.reduce((n, l) => { const p = findProduct(l.id); return n + (p ? priceOf(p, l.opt) : 0) * l.qty; }, 0);
    const opt = currentShip();
    const free = Number(opt.price) === 0 || (Number(s.freeShippingOver) > 0 && sub >= Number(s.freeShippingOver));
    const ship = cart.length && !free ? Number(opt.price) || 0 : 0;
    return { sub, ship, total: sub + ship, free, opt };
  }

  function shipPicker() {
    const o = shipOptions();
    if (o.length < 2) return "";
    const cur = currentShip().index;
    return `<fieldset class="ship"><legend>Entrega</legend>${o.map((x, i) => `
      <label class="${i === cur ? "active" : ""}"><input type="radio" name="ship" value="${i}" ${i === cur ? "checked" : ""}>
        <span><b>${esc(x.name)}</b>${x.note ? `<small>${esc(x.note)}</small>` : ""}</span>
        <em>${Number(x.price) ? money(x.price) : "Gratis"}</em></label>`).join("")}</fieldset>`;
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
          ${t.opt.address === false ? "" : `<label>Dirección de envío<textarea name="address" rows="3" required autocomplete="street-address"></textarea></label>`}
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
          <small>${money(priceOf(p, l.opt))}</small>
          <div class="qty" style="margin-top:.3rem"><button data-line="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-line="${i}" data-d="1">+</button></div>
          <button class="remove" data-remove="${i}">Quitar</button>
        </div>
        <strong>${money(priceOf(p, l.opt) * l.qty)}</strong>
      </div>`;
    }).join("");
    foot.innerHTML = shipPicker() + totalsHtml(t) +
      (missing > 0 && Number(s.freeShippingOver) > 0 ? `<p class="hint">Te faltan ${money(missing)} para envío gratis.</p>` : "") +
      `<button class="btn block" id="go-checkout">Finalizar pedido</button>`;
  }

  function totalsHtml(t) {
    return `<div class="totals">
      <div><span>Subtotal</span><span>${money(t.sub)}</span></div>
      <div><span>${shipOptions().length > 1 ? esc(t.opt.name) : "Envío"}</span><span>${t.free ? "Gratis" : money(t.ship)}</span></div>
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

  $("#cart-overlay").addEventListener("change", (e) => {
    if (e.target.name !== "ship") return;
    save(SHIP_KEY, Number(e.target.value));
    drawCart();
  });

  $("#cart-overlay").addEventListener("submit", (e) => {
    e.preventDefault();
    const via = e.submitter?.dataset.via || (DATA.store.whatsapp ? "wa" : "mail");
    const f = Object.fromEntries(new FormData(e.target));
    const s = DATA.store, t = totals();
    const lines = cart.map((l) => {
      const p = findProduct(l.id);
      return `• ${l.qty} × ${p.name}${l.opt ? ` (${p.optionName || "Opción"}: ${l.opt})` : ""} — ${money(priceOf(p, l.opt) * l.qty)}`;
    });
    const msg = [
      `¡Hola ${s.name}! Quiero hacer este pedido:`, "", ...lines, "",
      `Subtotal: ${money(t.sub)}`, `Entrega: ${t.opt.name}${t.opt.note ? ` (${t.opt.note})` : ""} — ${t.free ? "Gratis" : money(t.ship)}`, `Total: ${money(t.total)}`, "",
      `Nombre: ${f.name}`, `Teléfono: ${f.phone}`, f.address ? `Dirección: ${f.address}` : "",
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
    if ($("#product-overlay").hidden && $("#cart-overlay").hidden && $("#menu-overlay").hidden) document.body.style.overflow = "";
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (c) { c.dataset.close === "product" ? closeProduct() : closeOverlay(c.dataset.close); return; }
    if (e.target.id === "product-overlay") closeProduct();
    if (e.target.id === "cart-overlay") closeOverlay("cart");
    if (e.target.id === "menu-overlay") closeOverlay("menu");
    if (e.target.closest("#side-nav a")) closeOverlay("menu");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#menu-overlay").hidden) closeOverlay("menu");
    else if (!$("#cart-overlay").hidden) closeOverlay("cart");
    else if (!$("#product-overlay").hidden) closeProduct();
  });
  $("#cart-open").onclick = () => openOverlay("cart");
  $("#menu-open").onclick = () => { drawMenu(); openOverlay("menu"); };
  $("#brand").onclick = (e) => {
    e.preventDefault();
    query = ""; $("#search").value = ""; $("#search-bar").hidden = true;
    closeOverlay("menu");
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    else renderHome();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  $("#search-toggle").onclick = () => {
    const bar = $("#search-bar");
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $("#search").focus();
  };
  $("#search").addEventListener("input", (e) => {
    query = e.target.value.trim();
    shown = PAGE;
    if (!$("#grid")) location.hash = "#/todo";
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
