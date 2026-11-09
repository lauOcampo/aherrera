/*
 * Servidor para usar el sitio en tu computador (Node.js, sin dependencias).
 * En Vercel no se usa este archivo: allí la API la atiende api/index.js.
 *
 *  - Sirve el sitio (index.html, frontend/, assets/, uploads/).
 *  - Atiende la API con la misma lógica que en Vercel (api/_lib/app.js).
 *  - Guarda en data/db.json y uploads/. Si en .env pones las claves de Upstash Redis,
 *    usa esa base de datos (la misma que el sitio publicado).
 *
 * Uso:  npm run setup   (una vez, para crear usuario y contraseña)
 *       npm start
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { cargarEnv, configRedis } = require("../api/_lib/env");
cargarEnv(path.join(ROOT, ".env"));

const { crearApi, enviar, problemaConfig, CABECERAS } = require("../api/_lib/app");
const { crearStoreLocal } = require("../api/_lib/store-local");
const { crearStoreRedis } = require("../api/_lib/store-redis");

const PORT = Number(process.env.PORT) || 3000;

const problema = problemaConfig();
if (problema) {
    console.error(`\n${problema}\nEjecuta primero:  npm run setup\n`);
    process.exit(1);
}

const redis = configRedis();
const store = redis ? crearStoreRedis(redis) : crearStoreLocal(ROOT);
const api = crearApi(store, {
    trustProxy: process.env.TRUST_PROXY === "true",
    cookieSegura: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
});

// ------------------------------------------------------------------ archivos estáticos
const TIPOS = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json",
};
const CARPETAS_PUBLICAS = ["frontend", "assets", "uploads"];

async function estatico(req, res, ruta) {
    if (ruta === "/admin" || ruta === "/admin/") {
        res.writeHead(302, { Location: "/frontend/admin/login.html" });
        return res.end();
    }

    // La página de inicio está en la raíz del proyecto (index.html)
    const esInicio = ruta === "/" || ruta === "/index.html";
    const archivo = esInicio ? path.join(ROOT, "index.html") : path.normalize(path.join(ROOT, ruta));
    const relativo = path.relative(ROOT, archivo);
    const carpeta = relativo.split(path.sep)[0];
    const oculto = relativo.split(path.sep).some((p) => p.startsWith("."));
    const tipo = TIPOS[path.extname(archivo).toLowerCase()];

    if (!esInicio && (!CARPETAS_PUBLICAS.includes(carpeta) || oculto || relativo.startsWith("..") || !tipo ||
        (carpeta === "uploads" && !tipo.startsWith("image/")))) {
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
        console.error(err);
        if (!res.headersSent) enviar(res, 500, { error: "Error interno del servidor." });
    }
});

server.listen(PORT, () => {
    console.log(`Datos:  ${store.nombre === "redis" ? "Upstash Redis (los mismos del sitio publicado)" : "data/ y uploads/ de esta carpeta"}`);
    console.log(`Sitio:  http://localhost:${PORT}/`);
    console.log(`Panel:  http://localhost:${PORT}/admin`);
});
