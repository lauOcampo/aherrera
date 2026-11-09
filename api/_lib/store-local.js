/*
 * Almacenamiento en archivos (para usar el sitio en tu computador con  npm start).
 * Contenido en data/db.json, imágenes en uploads/, sesiones e intentos en memoria.
 */
"use strict";

const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function crearStoreLocal(root) {
    const DATA_DIR = path.join(root, "data");
    const DB_FILE = path.join(DATA_DIR, "db.json");
    const UPLOADS_DIR = path.join(root, "uploads");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    const sesiones = new Map(); // id -> vence (ms)
    const intentos = new Map(); // ip -> { fallos, hasta }
    let cola = Promise.resolve();

    setInterval(() => {
        const ahora = Date.now();
        for (const [id, vence] of sesiones) if (vence < ahora) sesiones.delete(id);
        for (const [ip, r] of intentos) if (r.hasta < ahora) intentos.delete(ip);
    }, 10 * 60 * 1000).unref();

    return {
        nombre: "local",

        async leerDb() {
            if (!fs.existsSync(DB_FILE)) return null;
            return JSON.parse(await fsp.readFile(DB_FILE, "utf8"));
        },
        // Escribe en un archivo temporal y lo renombra, para no dejar el JSON a medias
        guardarDb(db) {
            cola = cola.then(async () => {
                const tmp = DB_FILE + ".tmp";
                await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
                await fsp.rename(tmp, DB_FILE);
            });
            return cola;
        },

        // Las imágenes se sirven como archivos desde /uploads/<nombre>
        async guardarImagen(nombre, buf) {
            await fsp.writeFile(path.join(UPLOADS_DIR, nombre), buf);
            return `/uploads/${nombre}`;
        },
        async leerImagen() {
            return null;
        },
        async borrarImagen(nombre) {
            await fsp.unlink(path.join(UPLOADS_DIR, nombre)).catch(() => {});
        },

        async crearSesion(id, segundos) {
            sesiones.set(id, Date.now() + segundos * 1000);
        },
        async sesionExiste(id) {
            const vence = sesiones.get(id);
            if (!vence) return false;
            if (vence < Date.now()) { sesiones.delete(id); return false; }
            return true;
        },
        async borrarSesion(id) {
            sesiones.delete(id);
        },

        async fallos(ip) {
            const r = intentos.get(ip);
            return r && r.hasta > Date.now() ? r.fallos : 0;
        },
        async registrarFallo(ip, segundos) {
            const r = intentos.get(ip);
            if (!r || r.hasta < Date.now()) intentos.set(ip, { fallos: 1, hasta: Date.now() + segundos * 1000 });
            else r.fallos += 1;
        },
        async limpiarFallos(ip) {
            intentos.delete(ip);
        },
    };
}

module.exports = { crearStoreLocal };
