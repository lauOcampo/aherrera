/*
 * Función de Vercel: atiende todas las rutas /api/...
 * (vercel.json redirige /api/loquesea a esta función con ?ruta=loquesea).
 * Guarda todo en Upstash Redis, porque Vercel no conserva archivos.
 */
"use strict";

const { configRedis } = require("./_lib/env");
const { crearStoreRedis } = require("./_lib/store-redis");
const { crearApi, enviar } = require("./_lib/app");

let api = null;

function rutaDe(req) {
    const url = new URL(req.url, "http://x");
    const r = url.searchParams.get("ruta");
    if (r !== null) return "/api/" + r.replace(/^\/+/, "");
    return decodeURIComponent(url.pathname);
}

module.exports = async (req, res) => {
    if (!api) {
        const redis = configRedis();
        if (!redis) {
            console.error("Falta conectar Upstash Redis al proyecto de Vercel.");
            return enviar(res, 500, {
                error: "Falta conectar la base de datos. En Vercel: Storage → Upstash (Redis) → Connect, y vuelve a desplegar.",
            });
        }
        api = crearApi(crearStoreRedis(redis));
    }
    let ruta;
    try { ruta = rutaDe(req); } catch (_) { return enviar(res, 400, { error: "Ruta no válida." }); }
    return api(req, res, ruta);
};
