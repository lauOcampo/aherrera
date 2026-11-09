/*
 * Almacenamiento en Upstash Redis (para Vercel).
 * Vercel no guarda archivos entre una petición y otra, así que el contenido,
 * las imágenes, las sesiones y los intentos de login viven aquí.
 * Usa la API REST de Upstash con fetch: no necesita dependencias.
 */
"use strict";

function crearStoreRedis({ url, token }) {
    async function cmd(...args) {
        let res;
        try {
            res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify(args),
            });
        } catch (err) {
            throw new Error(`No se pudo conectar con Redis: ${err.message}`);
        }
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.error) throw new Error(`Redis respondió ${res.status}: ${j.error || "error desconocido"}`);
        return j.result;
    }

    const TIPOS = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

    return {
        nombre: "redis",
        cmd,

        async leerDb() {
            const s = await cmd("GET", "db");
            return s ? JSON.parse(s) : null;
        },
        async guardarDb(db) {
            await cmd("SET", "db", JSON.stringify(db));
        },

        // Las imágenes se sirven desde /api/img/<nombre>
        async guardarImagen(nombre, buf) {
            await cmd("SET", `img:${nombre}`, buf.toString("base64"));
            return `/api/img/${nombre}`;
        },
        async leerImagen(nombre) {
            const b64 = await cmd("GET", `img:${nombre}`);
            if (!b64) return null;
            return { buf: Buffer.from(b64, "base64"), tipo: TIPOS[nombre.split(".").pop()] };
        },
        async borrarImagen(nombre) {
            await cmd("DEL", `img:${nombre}`);
        },

        async crearSesion(id, segundos) {
            await cmd("SET", `ses:${id}`, "1", "EX", String(segundos));
        },
        async sesionExiste(id) {
            return Boolean(await cmd("GET", `ses:${id}`));
        },
        async borrarSesion(id) {
            await cmd("DEL", `ses:${id}`);
        },

        async fallos(ip) {
            return Number(await cmd("GET", `fallos:${ip}`)) || 0;
        },
        async registrarFallo(ip, segundos) {
            const n = await cmd("INCR", `fallos:${ip}`);
            if (Number(n) === 1) await cmd("EXPIRE", `fallos:${ip}`, String(segundos));
        },
        async limpiarFallos(ip) {
            await cmd("DEL", `fallos:${ip}`);
        },
    };
}

module.exports = { crearStoreRedis };
