/*
 * Lógica de la API de Alex.H Surfaces. La usan:
 *   - api/index.js       en Vercel (con Upstash Redis)
 *   - backend/server.js  en tu computador (con archivos en data/ y uploads/)
 *
 *  - Login real del administrador: la contraseña se guarda como hash scrypt en
 *    ADMIN_PASS_HASH y nunca viaja al navegador. La sesión es una cookie HttpOnly.
 *  - Categorías, servicios y "Acerca de nosotros".
 */
"use strict";

const crypto = require("crypto");
const { leer } = require("./env");

const SESSION_HORAS = 8;
const MAX_IMG = 3 * 1024 * 1024;            // 3 MB por imagen (el panel ya las reduce a ~100 KB)
const MAX_IMGS_SERVICIO = 10;
const MAX_DESTACADOS = 4;
const MAX_FALLOS = 5;
const BLOQUEO_MIN = 15;

const EN_VERCEL = Boolean(process.env.VERCEL);
// Vercel rechaza peticiones de más de 4,5 MB antes de llegar aquí
const MAX_BODY = EN_VERCEL ? 4.5 * 1024 * 1024 : 30 * 1024 * 1024;

// ------------------------------------------------------------------ errores
class ErrorCliente extends Error {
    constructor(msg, status = 400) { super(msg); this.status = status; }
}

// ------------------------------------------------------------------ contraseña
// Formato del hash: scrypt$<sal hex>$<hash hex>
function verificarPassword(password, guardado) {
    const [alg, salHex, hashHex] = String(guardado).split("$");
    if (alg !== "scrypt" || !salHex || !hashHex) return false;
    const esperado = Buffer.from(hashHex, "hex");
    if (!esperado.length) return false;
    const calculado = crypto.scryptSync(String(password), Buffer.from(salHex, "hex"), esperado.length);
    return crypto.timingSafeEqual(esperado, calculado);
}

function igualSeguro(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// Devuelve qué falta configurar, o "" si está todo
function problemaConfig() {
    const user = leer("ADMIN_USER");
    const hash = leer("ADMIN_PASS_HASH");
    if (!user || !hash) return "Falta configurar ADMIN_USER y ADMIN_PASS_HASH en las variables de entorno.";
    if (!/^scrypt\$[a-f0-9]+\$[a-f0-9]+$/.test(hash)) {
        return "ADMIN_PASS_HASH no es válido. Copia el valor completo que genera  npm run setup  (empieza por scrypt$).";
    }
    return "";
}

// ------------------------------------------------------------------ utilidades
const uid = () => crypto.randomBytes(8).toString("hex");

const VACIO = () => ({
    categorias: [],
    servicios: [],
    nosotros: { imagen: "", titulo: "", stats: Array.from({ length: 4 }, () => ({ valor: "", texto: "" })) },
});

function texto(v, campo, max, obligatorio = true) {
    const s = typeof v === "string" ? v.trim() : "";
    if (obligatorio && !s) throw new ErrorCliente(`Falta ${campo}.`);
    if (s.length > max) throw new ErrorCliente(`${campo[0].toUpperCase() + campo.slice(1)} es demasiado largo (máx. ${max}).`);
    return s;
}

const FIRMAS = [
    { ext: "jpg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: "png", ok: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { ext: "webp", ok: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" },
];
const NOMBRE_IMG = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

const CABECERAS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src https://fonts.gstatic.com; " +
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function enviar(res, status, cuerpo, extra = {}) {
    const json = JSON.stringify(cuerpo);
    res.writeHead(status, { ...CABECERAS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
    res.end(json);
}

function leerCookies(req) {
    const out = {};
    for (const par of (req.headers.cookie || "").split(";")) {
        const i = par.indexOf("=");
        if (i > 0) {
            try { out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim()); } catch (_) { /* cookie rota */ }
        }
    }
    return out;
}

function leerJson(req) {
    if (!/^application\/json/i.test(req.headers["content-type"] || "")) {
        return Promise.reject(new ErrorCliente("Se esperaba JSON.", 415));
    }
    // En Vercel el cuerpo ya viene leído en req.body
    if (EN_VERCEL && "body" in req) {
        let b;
        try { b = req.body; } catch (_) { return Promise.reject(new ErrorCliente("JSON no válido.")); }
        if (b !== undefined && b !== null) {
            if (Buffer.isBuffer(b) || typeof b === "string") {
                try { return Promise.resolve(JSON.parse(b.toString("utf8") || "{}")); }
                catch (_) { return Promise.reject(new ErrorCliente("JSON no válido.")); }
            }
            return Promise.resolve(b);
        }
    }
    return new Promise((resolve, reject) => {
        let tam = 0;
        const partes = [];
        req.on("data", (c) => {
            tam += c.length;
            if (tam > MAX_BODY) { reject(new ErrorCliente("La petición es demasiado grande.", 413)); req.destroy(); return; }
            partes.push(c);
        });
        req.on("end", () => {
            try { resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")); }
            catch (_) { reject(new ErrorCliente("JSON no válido.")); }
        });
        req.on("error", reject);
    });
}

// Las peticiones que modifican datos deben venir del mismo sitio
function mismoOrigen(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    try { return new URL(origin).host === host; } catch (_) { return false; }
}

// ------------------------------------------------------------------ la API
function crearApi(store, { trustProxy = false, cookieSegura = false } = {}) {
    const confiarProxy = trustProxy || EN_VERCEL;
    const segura = cookieSegura || EN_VERCEL;

    function ipDe(req) {
        const xff = req.headers["x-forwarded-for"];
        if (confiarProxy && xff) return String(xff).split(",")[0].trim();
        return (req.socket && req.socket.remoteAddress) || "?";
    }

    const cookieSesion = (id, maxAge) =>
        `sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${segura ? "; Secure" : ""}`;

    async function sesionValida(req) {
        const id = leerCookies(req).sid;
        if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
        return (await store.sesionExiste(id)) ? id : null;
    }

    async function cargarDb() {
        const d = await store.leerDb();
        return d ? { ...VACIO(), ...d } : VACIO();
    }

    async function guardarImagen(dataUrl) {
        const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
        if (!m) throw new ErrorCliente("Formato de imagen no válido (usa JPG, PNG o WEBP).");
        const buf = Buffer.from(m[2], "base64");
        if (buf.length > MAX_IMG) throw new ErrorCliente("Cada imagen debe pesar menos de 3 MB.");
        const tipo = FIRMAS.find((f) => f.ok(buf));
        if (!tipo) throw new ErrorCliente("El archivo no es una imagen válida.");
        return store.guardarImagen(`${uid()}${uid()}.${tipo.ext}`, buf);
    }

    // Recibe la lista que manda el panel: rutas ya guardadas o imágenes nuevas (data URL)
    async function procesarImagenes(lista, permitidas) {
        const out = [];
        for (const item of lista) {
            if (typeof item !== "string") throw new ErrorCliente("Imagen no válida.");
            if (item.startsWith("data:")) out.push(await guardarImagen(item));
            else if (permitidas.includes(item)) out.push(item);
            else throw new ErrorCliente("Imagen no reconocida.");
        }
        return out;
    }

    async function borrarImagenes(db, rutas) {
        for (const r of rutas) {
            const nombre = String(r).split("/").pop();
            if (!NOMBRE_IMG.test(nombre)) continue;
            // No borra si otra parte del contenido todavía la usa
            const enUso = db.servicios.some((s) => s.imagenes.includes(r)) || db.nosotros.imagen === r;
            if (!enUso) await store.borrarImagen(nombre).catch(() => {});
        }
    }

    async function rutas(req, res, ruta) {
        const metodo = req.method;
        let m;

        if (metodo !== "GET" && metodo !== "HEAD" && !mismoOrigen(req)) {
            return enviar(res, 403, { error: "Origen no permitido." });
        }

        // ---- imágenes guardadas en Redis
        if ((metodo === "GET" || metodo === "HEAD") && (m = ruta.match(/^\/api\/img\/([^/]+)$/))) {
            const img = NOMBRE_IMG.test(m[1]) ? await store.leerImagen(m[1]) : null;
            if (!img) return enviar(res, 404, { error: "Imagen no encontrada." });
            res.writeHead(200, {
                ...CABECERAS,
                "Content-Type": img.tipo,
                "Content-Length": img.buf.length,
                // El nombre es único: la CDN de Vercel la guarda y no vuelve a pedirla a Redis
                "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
            });
            return res.end(metodo === "HEAD" ? undefined : img.buf);
        }

        // ---- públicas
        if (metodo === "GET" && ruta === "/api/contenido") return enviar(res, 200, await cargarDb());

        if (metodo === "GET" && ruta === "/api/sesion") {
            return enviar(res, 200, { activo: Boolean(await sesionValida(req)) });
        }

        if (metodo === "POST" && ruta === "/api/login") {
            const problema = problemaConfig();
            if (problema) {
                console.error(problema);
                return enviar(res, 500, { error: problema });
            }
            const ip = ipDe(req);
            if ((await store.fallos(ip)) >= MAX_FALLOS) {
                return enviar(res, 429, { error: `Demasiados intentos. Espera ${BLOQUEO_MIN} minutos.` });
            }
            const { usuario, password } = await leerJson(req);
            const okUsuario = igualSeguro(String(usuario || "").trim(), leer("ADMIN_USER"));
            const okPass = verificarPassword(password || "", leer("ADMIN_PASS_HASH"));
            if (!okUsuario || !okPass) {
                await store.registrarFallo(ip, BLOQUEO_MIN * 60);
                return enviar(res, 401, { error: "Usuario o contraseña incorrectos." });
            }
            await store.limpiarFallos(ip);
            const id = crypto.randomBytes(32).toString("hex");
            await store.crearSesion(id, SESSION_HORAS * 3600);
            return enviar(res, 200, { ok: true }, { "Set-Cookie": cookieSesion(id, SESSION_HORAS * 3600) });
        }

        if (metodo === "POST" && ruta === "/api/logout") {
            const id = await sesionValida(req);
            if (id) await store.borrarSesion(id);
            return enviar(res, 200, { ok: true }, { "Set-Cookie": cookieSesion("", 0) });
        }

        // ---- de aquí en adelante, solo el administrador
        if (!(await sesionValida(req))) return enviar(res, 401, { error: "Tu sesión expiró. Inicia sesión de nuevo." });

        const db = await cargarDb();

        // Categorías
        if (metodo === "POST" && ruta === "/api/categorias") {
            const nombre = texto((await leerJson(req)).nombre, "el nombre", 60);
            if (db.categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
                throw new ErrorCliente("Esa categoría ya existe.", 409);
            }
            db.categorias.push({ id: uid(), nombre });
            await store.guardarDb(db);
            return enviar(res, 201, db);
        }

        if (metodo === "DELETE" && (m = ruta.match(/^\/api\/categorias\/([a-f0-9]{16})$/))) {
            if (!db.categorias.some((c) => c.id === m[1])) throw new ErrorCliente("La categoría no existe.", 404);
            if (db.servicios.some((s) => s.categoriaId === m[1])) {
                throw new ErrorCliente("No puedes eliminar una categoría que tiene servicios. Elimina o mueve esos servicios primero.", 409);
            }
            db.categorias = db.categorias.filter((c) => c.id !== m[1]);
            await store.guardarDb(db);
            return enviar(res, 200, db);
        }

        // Servicios
        const esCrear = metodo === "POST" && ruta === "/api/servicios";
        const editar = metodo === "PUT" && ruta.match(/^\/api\/servicios\/([a-f0-9]{16})$/);
        if (esCrear || editar) {
            const b = await leerJson(req);
            const anterior = editar ? db.servicios.find((s) => s.id === editar[1]) : null;
            if (editar && !anterior) throw new ErrorCliente("El servicio no existe.", 404);

            const nombre = texto(b.nombre, "el nombre", 80);
            const descripcion = texto(b.descripcion, "la descripción", 2000);
            if (!db.categorias.some((c) => c.id === b.categoriaId)) throw new ErrorCliente("Selecciona una categoría válida.");
            const destacados = (Array.isArray(b.destacados) ? b.destacados : [])
                .map((d) => texto(d, "un elemento destacado", 60, false)).filter(Boolean).slice(0, MAX_DESTACADOS);
            if (!Array.isArray(b.imagenes) || !b.imagenes.length) throw new ErrorCliente("Agrega al menos una imagen.");
            if (b.imagenes.length > MAX_IMGS_SERVICIO) throw new ErrorCliente(`Máximo ${MAX_IMGS_SERVICIO} imágenes por servicio.`);

            const imagenes = await procesarImagenes(b.imagenes, anterior ? anterior.imagenes : []);
            const servicio = { id: anterior ? anterior.id : uid(), nombre, categoriaId: b.categoriaId, descripcion, destacados, imagenes };

            if (anterior) db.servicios = db.servicios.map((s) => (s.id === anterior.id ? servicio : s));
            else db.servicios.push(servicio);
            await store.guardarDb(db);
            if (anterior) await borrarImagenes(db, anterior.imagenes.filter((r) => !imagenes.includes(r)));
            return enviar(res, anterior ? 200 : 201, db);
        }

        if (metodo === "DELETE" && (m = ruta.match(/^\/api\/servicios\/([a-f0-9]{16})$/))) {
            const s = db.servicios.find((x) => x.id === m[1]);
            if (!s) throw new ErrorCliente("El servicio no existe.", 404);
            db.servicios = db.servicios.filter((x) => x.id !== s.id);
            await store.guardarDb(db);
            await borrarImagenes(db, s.imagenes);
            return enviar(res, 200, db);
        }

        // Acerca de nosotros
        if (metodo === "PUT" && ruta === "/api/nosotros") {
            const b = await leerJson(req);
            const anterior = db.nosotros.imagen;
            let imagen = "";
            if (b.imagen) [imagen] = await procesarImagenes([b.imagen], anterior ? [anterior] : []);
            const stats = Array.from({ length: 4 }, (_, i) => {
                const s = (Array.isArray(b.stats) && b.stats[i]) || {};
                return { valor: texto(s.valor, "el valor", 20, false), texto: texto(s.texto, "la descripción", 300, false) };
            });
            db.nosotros = { imagen, titulo: texto(b.titulo, "el texto principal", 500, false), stats };
            await store.guardarDb(db);
            if (anterior && anterior !== imagen) await borrarImagenes(db, [anterior]);
            return enviar(res, 200, db);
        }

        return enviar(res, 404, { error: "Ruta no encontrada." });
    }

    // Punto de entrada: atiende una ruta /api/... y convierte los errores en respuestas JSON
    return async function api(req, res, ruta) {
        try {
            return await rutas(req, res, ruta);
        } catch (err) {
            if (err instanceof ErrorCliente) return enviar(res, err.status, { error: err.message });
            console.error(err);
            if (!res.headersSent) enviar(res, 500, { error: "Error interno del servidor." });
        }
    };
}

module.exports = { crearApi, enviar, problemaConfig, CABECERAS, VACIO };
