# Alex.H Surfaces

Sitio web con panel de administración. El backend está en Node.js y **no usa dependencias**: no hace falta `npm install`.

## Qué cambió en esta versión

| Antes | Ahora |
|---|---|
| Usuario y contraseña escritos en `auth.js`, visibles para cualquiera | El servidor comprueba la contraseña. En `.env` solo se guarda un hash (scrypt), nunca la contraseña |
| El contenido se guardaba en el `localStorage` del navegador del admin, así que **los visitantes no veían los servicios** | El contenido se guarda en el servidor (`data/db.json`) y todos los visitantes lo ven |
| Imágenes como texto base64 dentro del navegador | Imágenes guardadas como archivos en `uploads/` |
| Cualquiera podía "entrar" al panel editando el `sessionStorage` | Sesión con cookie `HttpOnly`. Sin sesión, la API rechaza cualquier cambio |

Otras protecciones:

- Bloqueo de 15 minutos tras 5 intentos de login fallidos.
- Se revisa que cada imagen sea de verdad JPG, PNG o WEBP.
- Solo se sirven las carpetas `frontend/`, `assets/` y `uploads/`; `.env`, `data/` y `backend/` no son accesibles desde el navegador.
- Cabeceras de seguridad (CSP, anti-iframe).

## Requisitos

[Node.js](https://nodejs.org) 18 o superior.

## Uso en tu computador

1. Crea el usuario y la contraseña del administrador (solo la primera vez):

   ```bash
   npm run setup
   ```

2. Enciende el servidor:

   ```bash
   npm start
   ```

3. Abre:
   - Sitio: <http://localhost:3000/>
   - Panel: <http://localhost:3000/admin>


### Cambiar la contraseña

Vuelve a ejecutar `npm run setup` y reinicia el servidor.

## Estructura

```
backend/
  server.js     servidor: archivos del sitio + API + login
  setup.js      crea o cambia usuario y contraseña
frontend/       páginas HTML (sitio y panel)
assets/js/
  api.js        llamadas a la API
  auth.js       login y cierre de sesión
  guard.js      oculta el panel si no hay sesión
  dashboard.js  panel de administración
  site.js       pinta el contenido en la página pública
data/db.json    contenido del sitio (se crea solo)
uploads/        imágenes subidas desde el panel
.env            usuario y hash de la contraseña (se crea con npm run setup)
```

## API

| Método | Ruta | Acceso |
|---|---|---|
| GET | `/api/contenido` | público |
| GET | `/api/sesion` | público |
| POST | `/api/login` · `/api/logout` | público |
| POST · DELETE | `/api/categorias` · `/api/categorias/:id` | admin |
| POST · PUT · DELETE | `/api/servicios` · `/api/servicios/:id` | admin |
| PUT | `/api/nosotros` | admin |

## Publicar el sitio

Sirve cualquier hosting que ejecute Node.js: Railway, Render, Fly.io o un VPS. Ten en cuenta tres cosas:

1. **Almacenamiento persistente.** El contenido vive en `data/` y las fotos en `uploads/`. En planes sin disco persistente (por ejemplo, el gratuito de Render), esos archivos se **borran en cada reinicio**. Usa un volumen o disco persistente (Railway Volumes, Render Disks) montado en esas carpetas, o un VPS.
2. **Variables de entorno.** En el hosting no subas `.env`. Ejecuta `npm run setup` en tu computador y copia `ADMIN_USER` y `ADMIN_PASS_HASH` de tu `.env` a las variables de entorno del hosting. Agrega también:
   - `NODE_ENV=production`: la cookie solo viaja por HTTPS.
   - `TRUST_PROXY=true`: el límite de intentos ve la IP real del visitante.
3. **Comando de inicio:** `npm start`. El hosting asigna el puerto con la variable `PORT`.

### Respaldos

Copia de vez en cuando `data/db.json` y la carpeta `uploads/`: son todo el contenido del sitio.
