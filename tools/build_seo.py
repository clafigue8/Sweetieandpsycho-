#!/usr/bin/env python3
"""Genera las páginas para Google a partir de data/store.json.

- products/<id>/index.html y collections/<id>/index.html: la misma tienda,
  pero con su propio título, descripción, foto, datos de producto
  (precio, disponibilidad, opiniones) y un contenido básico que Google lee
  sin ejecutar programación. Al abrirlas, la tienda muestra ese producto.
- sitemap.xml, robots.txt y 404.html (los enlaces viejos que ya no existen
  llevan a la tienda en vez de mostrar error).
- El encabezado de index.html (bloque <!--SEO--> ... <!--/SEO-->).

Lo corre GitHub Actions cada vez que cambia la tienda (.github/workflows/seo.yml).
Uso manual:  python3 tools/build_seo.py
"""
import html, json, os, re, shutil, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
D = json.load(open("data/store.json", encoding="utf-8"))
S = D["store"]
SITE = (S.get("siteUrl") or "").rstrip("/") + "/"
if SITE == "/":
    sys.exit("Falta store.siteUrl en data/store.json")
NAME = S.get("name", "Tienda")
CUR = S.get("currency", "HNL")
TODAY = date.today().isoformat()
esc = lambda s: html.escape(str(s or ""), quote=True)


def absu(path):
    if not path:
        return ""
    return path if re.match(r"^https?://", path) else SITE + path.lstrip("/")


def money(n):
    return f"L {float(n or 0):,.2f}" if CUR == "HNL" else f"{float(n or 0):,.2f} {CUR}"


def clip(text, n=158):
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t if len(t) <= n else t[: n - 1].rsplit(" ", 1)[0] + "…"


def jsonld(obj):
    return '<script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False).replace("</", "<\\/") + "</script>"


def head_block(title, desc, url, image, extra="", robots="index,follow"):
    return f"""<!--SEO-->
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="robots" content="{robots}">
  <link rel="canonical" href="{esc(url)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="{esc(NAME)}">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{esc(url)}">
  <meta property="og:image" content="{esc(image)}">
  <meta property="og:locale" content="es_HN">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{esc(image)}">
  {extra}
  <!--/SEO-->"""


TEMPLATE = open("index.html", encoding="utf-8").read()
if "<!--SEO-->" not in TEMPLATE:
    sys.exit("index.html no tiene el bloque <!--SEO--> ... <!--/SEO-->")


def page(head, body_html, route=None, depth=0):
    t = re.sub(r"<!--SEO-->.*?<!--/SEO-->", lambda m: head, TEMPLATE, flags=re.S)
    if depth:
        base = "../" * depth
        t = t.replace("<head>", f'<head>\n  <base href="{base}">', 1)
    if route:
        t = t.replace("</head>", f"  <script>window.INITIAL_ROUTE = {json.dumps(route)};</script>\n</head>", 1)
    t = re.sub(r'(<main id="app">).*?(</main>)', lambda m: m.group(1) + "\n" + body_html + "\n  " + m.group(2), t, count=1, flags=re.S)
    return t


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


ig = (S.get("instagram") or "").lstrip("@")
same = [f"https://www.instagram.com/{ig}/"] if ig else []
STORE_LD = {
    "@context": "https://schema.org", "@type": "Store", "name": NAME, "url": SITE,
    "logo": absu(S.get("logo") or "assets/icon-180.png"), "image": absu("assets/og-image.jpg"),
    "description": S.get("seoDescription") or S.get("tagline") or "",
    "address": {"@type": "PostalAddress", "addressLocality": S.get("city", "Tegucigalpa"), "addressCountry": "HN"},
    "areaServed": "HN", "currenciesAccepted": CUR, "sameAs": same,
}
if S.get("whatsapp"):
    STORE_LD["telephone"] = S["whatsapp"]

active = [p for p in D["products"] if p.get("status") == "active"]
archived = [p for p in D["products"] if p.get("status") == "archived"]
cols = [c for c in D.get("collections", []) if c.get("visible") is not False]
reviews = [r for r in D.get("reviews", []) if r.get("visible") is not False and r.get("text")]
in_stock = lambda p: p.get("stock") in ("", None) or float(p.get("stock") or 0) > 0

# ---------- Inicio ----------
home_title = S.get("seoTitle") or f"{NAME} | Tienda en línea en Honduras"
home_desc = clip(S.get("seoDescription") or S.get("tagline") or "")
home_body = ['  <section class="seo-static">', f"    <h1>{esc(NAME)}</h1>", f"    <p>{esc(home_desc)}</p>", "    <h2>Colecciones</h2>", "    <ul>"]
home_body += [f'      <li><a href="collections/{esc(c["id"])}/">{esc(c["name"])}</a></li>' for c in cols]
home_body += ["    </ul>", "    <h2>Productos</h2>", "    <ul>"]
home_body += [f'      <li><a href="products/{esc(p["id"])}/">{esc(p["name"])}</a> — {money(p.get("price"))}</li>' for p in active[:60]]
home_body += ["    </ul>", '    <p class="loading">Cargando tienda…</p>', "  </section>"]
home = page(head_block(home_title, home_desc, SITE, absu("assets/og-image.jpg"), jsonld(STORE_LD)), "\n".join(home_body))
write("index.html", home)

# ---------- Productos ----------
generated = set()
for p in active + archived:
    pid = p["id"]
    url = f"{SITE}products/{pid}/"
    imgs = [absu(i) for i in (p.get("images") or [])][:6]
    desc = clip(p.get("description") or f'{p["name"]} en {NAME}. Envíos a todo Honduras.')
    title = f'{p["name"]} | {NAME}'
    revs = [r for r in reviews if r.get("product") == pid]
    ld = {
        "@context": "https://schema.org", "@type": "Product", "name": p["name"], "sku": pid,
        "description": clip(p.get("description") or p["name"], 500), "image": imgs,
        "brand": {"@type": "Brand", "name": NAME},
        "offers": {"@type": "Offer", "url": url, "priceCurrency": CUR, "price": f'{float(p.get("price") or 0):.2f}',
                   "availability": "https://schema.org/InStock" if (in_stock(p) and p["status"] == "active") else "https://schema.org/OutOfStock",
                   "itemCondition": "https://schema.org/NewCondition", "seller": {"@type": "Organization", "name": NAME}},
    }
    if revs:
        ld["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": round(sum(float(r.get("rating") or 5) for r in revs) / len(revs), 1), "reviewCount": len(revs)}
        ld["review"] = [{"@type": "Review", "author": {"@type": "Person", "name": r.get("name") or "Clienta"},
                         "reviewRating": {"@type": "Rating", "ratingValue": r.get("rating") or 5}, "reviewBody": r["text"]} for r in revs[:5]]
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": NAME, "item": SITE},
        {"@type": "ListItem", "position": 2, "name": p["name"], "item": url}]}
    body = f"""  <article class="seo-static">
    <p><a href="./">{esc(NAME)}</a></p>
    {f'<img src="{esc(imgs[0])}" alt="{esc(p["name"])}" width="600" height="600">' if imgs else ''}
    <h1>{esc(p["name"])}</h1>
    <p>{money(p.get("price"))}{"" if in_stock(p) else " · Agotado"}</p>
    <p>{esc(p.get("description") or "")}</p>
    <p><a href="#/producto/{esc(pid)}">Ver producto</a></p>
    <p class="loading">Cargando tienda…</p>
  </article>"""
    robots = "index,follow" if p["status"] == "active" else "noindex,follow"
    head = head_block(title, desc, url, imgs[0] if imgs else absu("assets/og-image.jpg"), jsonld(ld) + "\n  " + jsonld(crumbs), robots)
    write(f"products/{pid}/index.html", page(head, body, f"#/producto/{pid}", depth=2))
    generated.add(f"products/{pid}")

# ---------- Colecciones ----------
for c in cols:
    cid = c["id"]
    url = f"{SITE}collections/{cid}/"
    items = [p for p in active if cid in (p.get("collections") or [])]
    desc = clip(c.get("description") or f'{c["name"]}: {", ".join(p["name"] for p in items[:6])}. Envíos a todo Honduras.')
    ld = {"@context": "https://schema.org", "@type": "CollectionPage", "name": c["name"], "url": url,
          "mainEntity": {"@type": "ItemList", "itemListElement": [
              {"@type": "ListItem", "position": i + 1, "url": f"{SITE}products/{p['id']}/", "name": p["name"]} for i, p in enumerate(items[:100])]}}
    body = ['  <section class="seo-static">', f'    <p><a href="./">{esc(NAME)}</a></p>', f'    <h1>{esc(c["name"])}</h1>', f'    <p>{esc(c.get("description") or "")}</p>', "    <ul>"]
    body += [f'      <li><a href="products/{esc(p["id"])}/">{esc(p["name"])}</a> — {money(p.get("price"))}</li>' for p in items]
    body += ["    </ul>", '    <p class="loading">Cargando tienda…</p>', "  </section>"]
    head = head_block(f'{c["name"]} | {NAME}', desc, url, absu(c.get("image") or "assets/og-image.jpg"), jsonld(ld))
    write(f"collections/{cid}/index.html", page(head, "\n".join(body), f"#/coleccion/{cid}", depth=2))
    generated.add(f"collections/{cid}")

# Quitar páginas de productos o colecciones que ya no existen
for folder in ("products", "collections"):
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            if f"{folder}/{name}" not in generated:
                shutil.rmtree(os.path.join(folder, name), ignore_errors=True)

# ---------- sitemap.xml y robots.txt ----------
urls = [(SITE, "1.0")] + [(f"{SITE}collections/{c['id']}/", "0.8") for c in cols] + [(f"{SITE}products/{p['id']}/", "0.7") for p in active]
sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
sm += [f"  <url><loc>{esc(u)}</loc><lastmod>{TODAY}</lastmod><priority>{pr}</priority></url>" for u, pr in urls]
sm.append("</urlset>")
write("sitemap.xml", "\n".join(sm) + "\n")
write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: {SITE}sitemap.xml\n")

# ---------- 404: los enlaces viejos llevan a la tienda ----------
write("404.html", f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>{esc(NAME)}</title>
<script>
  // Enlaces viejos (por ejemplo de Shopify) que ya no existen: llevar a la tienda.
  var site = {json.dumps(SITE)};
  var path = location.pathname.replace(/\\/+$/, "");
  var m = path.match(/\\/products\\/([^\\/?#]+)/) || null;
  location.replace(m ? site + "#/producto/" + m[1] : site);
</script></head>
<body><p><a href="{esc(SITE)}">Ir a {esc(NAME)}</a></p></body></html>
""")
print(f"OK: {len(generated)} páginas, {len(urls)} direcciones en el sitemap ({SITE})")
