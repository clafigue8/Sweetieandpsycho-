# Sweetie & Psycho — tienda en línea

Tienda estática para **GitHub Pages** con dominio propio (`www.sweetieandpsycho.com`)
y un **panel de administración** en `/admin`.

```
index.html            Tienda pública (portada, colecciones, ficha de producto, carrito)
assets/store.css|js   Estilos y lógica de la tienda
data/store.json       TODO el contenido: colores, colecciones, productos, envío…
assets/products/      Fotos de productos (las sube el panel)
admin/                Panel de administración
```

## Qué puedes hacer desde el panel (`/admin`)

- **Productos:** crear, editar, duplicar, archivar (ocultar sin perderlo), restaurar y borrar.
  Precio, precio tachado (oferta), inventario (se marca "Agotado" en 0), fotos (se reducen
  automáticamente), tallas/colores, destacado, borrador y enlace de pago directo opcional.
- **Colecciones:** crear, renombrar, ordenar, ocultar y borrar.
- **Diseño y colores:** 6 colores, paletas listas (Sweetie, Psycho, Pastel, Gótico, Minimal),
  tipografías, redondeo de esquinas, logo, barra de anuncio y portada.
- **Carrito y pedidos:** WhatsApp y/o correo donde llegan los pedidos, costo de envío,
  envío gratis desde cierto monto, moneda y mensaje final.
- **Vista previa** antes de publicar, **Publicar** (hace un commit en GitHub) y **Respaldo**.

El cliente arma su carrito, llena nombre/teléfono/dirección y el pedido completo se le abre
en WhatsApp (o en su correo) listo para enviártelo.

## Puesta en marcha

### 1. Repositorio
1. Crea en GitHub un repositorio nuevo, en este caso `Sweetieandpsycho-` (público, para Pages gratis).
2. Sube el contenido de esta carpeta a la raíz de ese repositorio (rama `main`).
3. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   rama `main`, carpeta `/ (root)`.

### 2. Dominio `www.sweetieandpsycho.com`
1. Compra el dominio en cualquier registrador (Namecheap, GoDaddy, Cloudflare, Porkbun…).
2. En el DNS del dominio crea estos registros (reemplaza `TU_USUARIO` por tu usuario de GitHub):

   | Tipo  | Nombre | Valor                    |
   |-------|--------|--------------------------|
   | CNAME | `www`  | `TU_USUARIO.github.io`   |
   | A     | `@`    | `185.199.108.153`        |
   | A     | `@`    | `185.199.109.153`        |
   | A     | `@`    | `185.199.110.153`        |
   | A     | `@`    | `185.199.111.153`        |

3. En **Settings → Pages → Custom domain** escribe `www.sweetieandpsycho.com` y guarda
   (esto crea el archivo `CNAME`; por ahora no existe porque la tienda se publica en
   `https://clafigue8.github.io/Sweetieandpsycho-/` mientras se prepara). Cuando GitHub verifique el DNS, activa **Enforce HTTPS**.
   La propagación puede tardar desde minutos hasta 24 h.
4. Recomendado: en **Settings (tu perfil) → Pages → Add a domain** verifica el dominio para
   que nadie más pueda usarlo en GitHub.

### 3. Entrar al panel
1. Crea un token: **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
   - Repository access: *Only select repositories* → el repo de la tienda.
   - Permissions → Repository permissions → **Contents: Read and write**.
2. Abre `https://www.sweetieandpsycho.com/admin/`, escribe usuario, repositorio, rama `main`
   y pega el token. Marca "Recordar en este dispositivo" solo en tu propio equipo.

> El token es la llave del panel: quien lo tenga puede editar la tienda. No lo compartas;
> si se pierde, revócalo en GitHub y crea otro.

## Pagos

Por defecto los pedidos llegan por WhatsApp/correo y acuerdas el pago con el cliente.
Para cobrar en línea, en cada producto puedes pegar un **enlace de pago** (Stripe Payment
Links, PayPal, Mercado Pago) y aparecerá un botón "Comprar ahora".

## Probar en tu computadora

```bash
python3 -m http.server 8000
# tienda:  http://localhost:8000
# panel:   http://localhost:8000/admin  (botón "Probar sin conexión")
```

## Migración desde Shopify (noviembre 2026)

El catálogo público de la tienda Shopify (`sweetie-and-psycho.myshopify.com`) se copió aquí:

- **362 productos** con descripción, precio, precio tachado, opciones (y precio por opción),
  disponibilidad, etiquetas y su pertenencia a las **13 colecciones**.
- **863 fotos de productos** descargadas y optimizadas (WebP, máx. 1600 px) en `assets/products/`,
  imágenes de colecciones en `assets/collections/` y el logo en `assets/logo.webp`.
- `respaldo-shopify/`: los datos originales tal como los entregó Shopify (`productos.json`,
  `colecciones.json`, `tienda.json`, qué productos hay en cada colección) y las imágenes
  de la página de inicio (`imagenes-sitio/`).

**No se pudo copiar desde la tienda pública** (solo existe en el panel de Shopify):
productos ocultos/borradores/archivados, cantidades exactas de inventario, pedidos y clientes.
Antes de cancelar Shopify, expórtalos desde el panel: *Productos → Exportar*,
*Pedidos → Exportar* y *Clientes → Exportar* (CSV).
