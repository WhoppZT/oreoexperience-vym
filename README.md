# Asignaciones - Vida y Ministerio

Página web sencilla y accesible para mostrar las asignaciones semanales de la reunión
*Vida y Ministerio Cristianos* a la congregación. Funciona sin conexión a internet
una vez cargada por primera vez (PWA).

Hecho por [OreoExperience](https://github.com/WhoppZT/OreoExperience-Notes) · Elihu Rueda.

## Características

- **Vista pública**: muestra automáticamente la semana actual basada en la fecha del dispositivo. Letras grandes, alto contraste, optimizada para personas mayores.
- **Mensaje "en espera de actualización"** cuando las semanas del PDF cargado ya pasaron.
- **Panel de administrador** protegido con correo y contraseña (Firebase Auth) para subir un PDF nuevo. El sistema detecta las semanas automáticamente.
- **Datos compartidos en la nube** (Firebase Firestore): el admin sube el PDF una vez y todos los visitantes ven la misma semana, sin tener que cargar nada.
- **PWA con soporte offline**: una vez visitada con internet, la página queda instalable y funciona sin conexión.
- **Diseño responsivo**: encabezado, tarjetas y botones se adaptan a celulares, tablets y desktop.
- **Sin servidor propio**: 100% estático (Firebase es el único backend). Se despliega gratis en GitHub Pages, Netlify, Vercel o Cloudflare Pages.

## Estructura

```
.
├── index.html
├── styles.css
├── manifest.webmanifest
├── service-worker.js
├── firestore.rules           # reglas de seguridad para Firestore
├── storage.rules             # reglas para Storage (no se usa, solo referencia)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── js/
│   ├── app.js                # orquestación general + UI
│   ├── pdf-parser.js         # extrae semanas del PDF (usa pdf.js)
│   ├── storage.js            # IndexedDB local + Firestore (cache + remoto)
│   ├── auth.js               # login admin vía Firebase Auth
│   ├── config.js             # configuración de Firebase (apiKey, projectId...)
│   ├── firebase.js           # wrapper sobre el SDK de Firebase
│   └── ui.js                 # render de la tarjeta semanal
└── vendor/
    ├── pdf.min.mjs
    └── pdf.worker.min.mjs
```

## Requisitos previos

Necesita un proyecto Firebase (gratis) con:

1. **Firestore Database** habilitado (modo producción).
2. **Authentication** con el proveedor *Correo electrónico/Contraseña* habilitado y al menos un usuario admin creado.
3. **Reglas de Firestore** publicadas (ver `firestore.rules`):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /assignments/{docId} {
         allow read: if true;
         allow write: if request.auth != null;
       }
     }
   }
   ```
4. Copie el bloque `firebaseConfig` de su proyecto en `js/config.js`.

> Los valores de `firebaseConfig` **no son secretos** — identifican el proyecto al navegador y cualquiera puede verlos. El control de acceso se hace con las reglas de Firestore y Firebase Auth.

## Desarrollo / prueba local

Sirva el sitio con cualquier servidor estático:

```bash
cd asignaciones-vym
python3 -m http.server 8080
```

Abra http://localhost:8080 en su navegador.

> **Nota**: el service worker requiere `http://` o `https://`. Abrir `index.html` con doble clic (`file://`) no activará el modo offline.

## Despliegue gratuito

Cualquier hosting estático funciona. Algunas opciones recomendadas:

- **GitHub Pages** — gratis, integrado con el repo. Activar en *Settings → Pages → Deploy from a branch → main / root*.
- **Netlify** — conectar el repo y desplegar como sitio estático (sin comandos de build).
- **Vercel** — igual que Netlify, framework: *Other*.
- **Cloudflare Pages** — conectar el repo, build command vacío, output directory: `/`.

Nada que compilar: subir los archivos tal como están es suficiente.

## Service Worker

El archivo `service-worker.js` cachea los recursos del sitio. Cada vez que se modifica el código,
suba el número de versión en la constante `CACHE_VERSION` para forzar a los navegadores
a refrescar la caché en su próxima visita.

## Cómo se detectan las semanas

El parser busca patrones de fechas en español dentro del texto del PDF, como:

- `25 – 31 DE MAYO`
- `01 A 07 DE JUNIO`
- `15 – 21 JUNIO – JEREMIAS 7,8`

A partir de cada coincidencia toma todo el contenido hasta la siguiente fecha
como una "semana". Dentro de cada semana detecta las secciones estándar:

- **TESOROS DE LA BIBLIA**
- **SEAMOS MEJORES MAESTROS**
- **NUESTRA VIDA CRISTIANA**

El año se infiere del texto del PDF, luego del nombre del archivo (`...2026.pdf`),
y finalmente del año actual del dispositivo. El admin puede sobrescribirlo
manualmente en el panel.
