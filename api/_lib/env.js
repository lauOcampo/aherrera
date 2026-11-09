/* Lee un archivo .env (solo en tu computador; en Vercel las variables se ponen en el panel). */
"use strict";

const fs = require("fs");

function cargarEnv(file) {
    if (!fs.existsSync(file)) return;
    for (const linea of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}

// Limpia valores pegados con espacios o comillas en el panel de Vercel
const leer = (nombre) => String(process.env[nombre] || "").trim().replace(/^["']|["']$/g, "");

// Upstash Redis conectado desde el Marketplace de Vercel crea KV_REST_API_*;
// si lo creas directamente en upstash.com, usa UPSTASH_REDIS_REST_*.
function configRedis() {
    const url = leer("UPSTASH_REDIS_REST_URL") || leer("KV_REST_API_URL");
    const token = leer("UPSTASH_REDIS_REST_TOKEN") || leer("KV_REST_API_TOKEN");
    return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

module.exports = { cargarEnv, leer, configRedis };
