/*
 * Backend de Alex.H Surfaces — Node.js sin dependencias externas.
 *
 *  - Sirve el sitio (frontend/, assets/, uploads/).
 *  - Login real del administrador: la contraseña se guarda como hash scrypt en .env
 *    y nunca viaja al navegador. La sesión es una cookie HttpOnly.
 *  - API para categorías, servicios y "Acerca de nosotros", guardada en data/db.json.
 *  - Las imágenes se guardan como archivos en uploads/.
 *
 * Uso:  node backend/setup.js   (una vez, para crear usuario y contraseña)
 *       node backend/server.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(ROOT, "uploads");

// ------------------------------------------------------------------ configuración
function cargarEnv(file) {
    if (!fs.existsSync(file)) return;
    for (const linea of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}
cargarEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "";
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || "";
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";

if (!ADMIN_USER || !ADMIN_PASS_HASH) {
    console.error("\nFalta configurar el administrador.\nEjecuta primero:  node backend/setup.js\n");
    process.exit(1);
}

const SESSION_HORAS = 8;
const MAX_BODY = 30 * 1024 * 1024;          // 30 MB por petición
const MAX_IMG = 5 * 1024 * 1024;            // 5 MB por imagen
const MAX_IMGS_SERVICIO = 10;
const MAX_DESTACADOS = 4;

// ------------------------------------------------------------------ contraseña
// Formato del hash: scrypt$<sal hex>$<hash hex>
function verificarPassword(password, guardado) {
    const [alg, salHex, hashHex] = String(guardado).split("$");
    if (alg !== "scrypt" || !salHex || !hashHex) return false;
    const esperado = Buffer.from(hashHex, "hex");
    const calculado = crypto.scryptSync(String(password), Buffer.from(salHex, "hex"), esperado.length);
    return crypto.timingSafeEqual(esperado, calculado);
}

function igualSeguro(a, b) {
    const ha = crypto.createHash("sha256").update(String(a)).digest();
    const hb = crypto.createHash("sha256").update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// ------------------------------------------------------------------ sesiones
const sesiones = new Map(); // id -> vence (ms)

function crearSesion() {
    const id = crypto.randomBytes(32).toString("hex");
    sesiones.set(id, Date.now() + SESSION_HORAS * 3600 * 1000);
    return id;
}

function leerCookies(req) {
    const out = {};
    for (const par of (req.headers.cookie || "").split(";")) {
        const i = par.indexOf("=");
        if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
    }
    return out;
}

function sesionValida(req) {
    const id = leerCookies(req).sid;
    if (!id || !sesiones.has(id)) return null;
    if (sesiones.get(id) < Date.now()) { sesiones.delete(id); return null; }
    return id;
}

function cookieSesion(id, maxAge) {
    return `sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${COOKIE_SECURE ? "; Secure" : ""}`;
}

setInterval(() => {
    const ahora = Date.now();
    for (const [id, vence] of sesiones) if (vence < ahora) sesiones.delete(id);
    for (const [ip, r] of intentos) if (r.hasta < ahora) intentos.delete(ip);
}, 10 * 60 * 1000).unref();

// ------------------------------------------------------------------ límite de intentos de login
const intentos = new Map(); // ip -> { fallos, hasta }
const MAX_FALLOS = 5;
const BLOQUEO_MIN = 15;

function ipDe(req) {
    if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
    return req.socket.remoteAddress || "?";
}

function bloqueado(ip) {
    const r = intentos.get(ip);
    return r && r.fallos >= MAX_FALLOS && r.hasta > Date.now();
}

function registrarFallo(ip) {
    const r = intentos.get(ip);
    if (!r || r.hasta < Date.now()) intentos.set(ip, { fallos: 1, hasta: Date.now() + BLOQUEO_MIN * 60 * 1000 });
    else r.fallos += 1;
}

// ------------------------------------------------------------------ base de datos (archivo JSON)
const VACIO = () => ({
    categorias: [],
    servicios: [],
    nosotros: { imagen: "", titulo: "", stats: Array.from({ length: 4 }, () => ({ valor: "", texto: "" })) },
});

let db = VACIO();
let cola = Promise.resolve();

function cargarDb() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) db = { ...VACIO(), ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
}

// Escribe en un archivo temporal y lo renombra, para no dejar el JSON a medias
function guardarDb() {
    cola = cola.then(async () => {
        const tmp = DB_FILE + ".tmp";
        await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
        await fsp.rename(tmp, DB_FILE);
    });
    return cola;
}

const uid = () => crypto.randomBytes(8).toString("hex");

// ------------------------------------------------------------------ imágenes
const FIRMAS = [
    { ext: "jpg", ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { ext: "png", ok: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { ext: "webp", ok: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" },
];

class ErrorCliente extends Error {
    constructor(msg, status = 400) { super(msg); this.status = status; }
}

async function guardarImagen(dataUrl) {
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new ErrorCliente("Formato de imagen no válido (usa JPG, PNG o WEBP).");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_IMG) throw new ErrorCliente("Cada imagen debe pesar menos de 5 MB.");
    const tipo = FIRMAS.find((f) => f.ok(buf));
    if (!tipo) throw new ErrorCliente("El archivo no es una imagen válida.");
    const nombre = `${uid()}${uid()}.${tipo.ext}`;
    await fsp.writeFile(path.join(UPLOADS_DIR, nombre), buf);
    return `/uploads/${nombre}`;
}

// Recibe la lista que manda el panel: rutas ya existentes ("/uploads/...") o imágenes nuevas (data URL)
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

async function borrarImagenes(rutas) {
    for (const r of rutas) {
        const nombre = path.basename(r);
        if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(nombre)) continue;
        // No borra si otra parte del contenido todavía la usa
        const enUso = db.servicios.some((s) => s.imagenes.includes(r)) || db.nosotros.imagen === r;
        if (!enUso) await fsp.unlink(path.join(UPLOADS_DIR, nombre)).catch(() => {});
    }
}

// ------------------------------------------------------------------ validación
function texto(v, campo, max, obligatorio = true) {
    const s = typeof v === "string" ? v.trim() : "";
    if (obligatorio && !s) throw new ErrorCliente(`Falta ${campo}.`);
    if (s.length > max) throw new ErrorCliente(`${campo[0].toUpperCase() + campo.slice(1)} es demasiado largo (máx. ${max}).`);
    return s;
}

// ------------------------------------------------------------------ utilidades HTTP
const CABECERAS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function enviar(res, status, cuerpo, extra = {}) {
    const json = JSON.stringify(cuerpo);
    res.writeHead(status, { ...CABECERAS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
    res.end(json);
}

function leerJson(req) {
    return new Promise((resolve, reject) => {
        if (!/^application\/json/i.test(req.headers["content-type"] || "")) {
            return reject(new ErrorCliente("Se esperaba JSON.", 415));
        }
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
    if (!origin) return true; // navegadores siempre lo mandan en POST/PUT/DELETE desde otra página
    try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

// ------------------------------------------------------------------ rutas de la API
async function api(req, res, ruta) {
    const metodo = req.method;

    if (metodo !== "GET" && !mismoOrigen(req)) return enviar(res, 403, { error: "Origen no permitido." });

    // ---- públicas
    if (metodo === "GET" && ruta === "/api/contenido") return enviar(res, 200, db);

    if (metodo === "GET" && ruta === "/api/sesion") return enviar(res, 200, { activo: Boolean(sesionValida(req)) });

    if (metodo === "POST" && ruta === "/api/login") {
        const ip = ipDe(req);
        if (bloqueado(ip)) return enviar(res, 429, { error: `Demasiados intentos. Espera ${BLOQUEO_MIN} minutos.` });
        const { usuario, password } = await leerJson(req);
        const okUsuario = igualSeguro(usuario || "", ADMIN_USER);
        const okPass = verificarPassword(password || "", ADMIN_PASS_HASH);
        if (!okUsuario || !okPass) {
            registrarFallo(ip);
            return enviar(res, 401, { error: "Usuario o contraseña incorrectos." });
        }
        intentos.delete(ip);
        const id = crearSesion();
        return enviar(res, 200, { ok: true }, { "Set-Cookie": cookieSesion(id, SESSION_HORAS * 3600) });
    }

    if (metodo === "POST" && ruta === "/api/logout") {
        const id = sesionValida(req);
        if (id) sesiones.delete(id);
        return enviar(res, 200, { ok: true }, { "Set-Cookie": cookieSesion("", 0) });
    }

    // ---- de aquí en adelante, solo el administrador
    if (!sesionValida(req)) return enviar(res, 401, { error: "Tu sesión expiró. Inicia sesión de nuevo." });

    let m;

    // Categorías
    if (metodo === "POST" && ruta === "/api/categorias") {
        const nombre = texto((await leerJson(req)).nombre, "el nombre", 60);
        if (db.categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
            throw new ErrorCliente("Esa categoría ya existe.", 409);
        }
        db.categorias.push({ id: uid(), nombre });
        await guardarDb();
        return enviar(res, 201, db);
    }

    if (metodo === "DELETE" && (m = ruta.match(/^\/api\/categorias\/([a-f0-9]{16})$/))) {
        if (!db.categorias.some((c) => c.id === m[1])) throw new ErrorCliente("La categoría no existe.", 404);
        if (db.servicios.some((s) => s.categoriaId === m[1])) {
            throw new ErrorCliente("No puedes eliminar una categoría que tiene servicios. Elimina o mueve esos servicios primero.", 409);
        }
        db.categorias = db.categorias.filter((c) => c.id !== m[1]);
        await guardarDb();
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
        await guardarDb();
        if (anterior) await borrarImagenes(anterior.imagenes.filter((r) => !imagenes.includes(r)));
        return enviar(res, anterior ? 200 : 201, db);
    }

    if (metodo === "DELETE" && (m = ruta.match(/^\/api\/servicios\/([a-f0-9]{16})$/))) {
        const s = db.servicios.find((x) => x.id === m[1]);
        if (!s) throw new ErrorCliente("El servicio no existe.", 404);
        db.servicios = db.servicios.filter((x) => x.id !== s.id);
        await guardarDb();
        await borrarImagenes(s.imagenes);
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
        await guardarDb();
        if (anterior && anterior !== imagen) await borrarImagenes([anterior]);
        return enviar(res, 200, db);
    }

    return enviar(res, 404, { error: "Ruta no encontrada." });
}

// ------------------------------------------------------------------ archivos estáticos
const TIPOS = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
};
const CARPETAS_PUBLICAS = ["frontend", "assets", "uploads"];

async function estatico(req, res, ruta) {
    if (ruta === "/" || ruta === "/index.html") {
        res.writeHead(302, { Location: "/frontend/index.html" });
        return res.end();
    }
    if (ruta === "/admin" || ruta === "/admin/") {
        res.writeHead(302, { Location: "/frontend/admin/login.html" });
        return res.end();
    }
    const archivo = path.normalize(path.join(ROOT, ruta));
    const relativo = path.relative(ROOT, archivo);
    const carpeta = relativo.split(path.sep)[0];
    const oculto = relativo.split(path.sep).some((p) => p.startsWith("."));
    const tipo = TIPOS[path.extname(archivo).toLowerCase()];

    if (!CARPETAS_PUBLICAS.includes(carpeta) || oculto || relativo.startsWith("..") || !tipo ||
        (carpeta === "uploads" && !tipo.startsWith("image/"))) {
        return noEncontrado(res);
    }
    try {
        const st = await fsp.stat(archivo);
        if (!st.isFile()) return noEncontrado(res);
        res.writeHead(200, {
            ...CABECERAS,
            "Content-Type": tipo,
            "Content-Length": st.size,
            "Cache-Control": carpeta === "uploads" ? "public, max-age=31536000, immutable" : "no-cache",
        });
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(archivo).pipe(res);
    } catch (_) {
        noEncontrado(res);
    }
}

function noEncontrado(res) {
    res.writeHead(404, { ...CABECERAS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
}

// ------------------------------------------------------------------ servidor
const server = http.createServer(async (req, res) => {
    let ruta;
    try { ruta = decodeURIComponent(new URL(req.url, "http://x").pathname); }
    catch (_) { return noEncontrado(res); }

    try {
        if (ruta.startsWith("/api/")) return await api(req, res, ruta);
        if (req.method !== "GET" && req.method !== "HEAD") return enviar(res, 405, { error: "Método no permitido." });
        return await estatico(req, res, ruta);
    } catch (err) {
        if (err instanceof ErrorCliente) return enviar(res, err.status, { error: err.message });
        console.error(err);
        if (!res.headersSent) enviar(res, 500, { error: "Error interno del servidor." });
    }
});

cargarDb();
server.listen(PORT, () => {
    console.log(`Sitio:  http://localhost:${PORT}/`);
    console.log(`Panel:  http://localhost:${PORT}/admin`);
});
