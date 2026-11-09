/*
 * Sube a Upstash Redis el contenido que tienes en tu computador
 * (data/db.json y las fotos de uploads/), para que aparezca en el sitio de Vercel.
 *
 * Antes: copia en tu .env las variables KV_REST_API_URL y KV_REST_API_TOKEN
 * (Vercel → tu proyecto → Storage → tu base de datos Upstash → .env.local).
 *
 * Uso:  npm run migrar
 *       npm run migrar -- --forzar    (reemplaza lo que ya haya en Redis)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { cargarEnv, configRedis } = require("../api/_lib/env");
cargarEnv(path.join(ROOT, ".env"));
const { crearStoreRedis } = require("../api/_lib/store-redis");

const DB_FILE = path.join(ROOT, "data", "db.json");
const UPLOADS = path.join(ROOT, "uploads");
const forzar = process.argv.includes("--forzar");

(async () => {
    const config = configRedis();
    if (!config) {
        console.error("Faltan KV_REST_API_URL y KV_REST_API_TOKEN en .env (cópialos desde Vercel → Storage).");
        process.exit(1);
    }
    if (!fs.existsSync(DB_FILE)) {
        console.error("No existe data/db.json: no hay contenido local para subir.");
        process.exit(1);
    }
    const store = crearStoreRedis(config);

    if (!forzar && (await store.leerDb())) {
        console.error("Redis ya tiene contenido (quizá ya lo editaste desde el panel publicado).");
        console.error("Si quieres reemplazarlo por el de tu computador:  npm run migrar -- --forzar");
        process.exit(1);
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    const subidas = new Map();

    async function subir(ruta) {
        if (!ruta || !ruta.startsWith("/uploads/")) return ruta;
        if (subidas.has(ruta)) return subidas.get(ruta);
        const nombre = path.basename(ruta);
        const archivo = path.join(UPLOADS, nombre);
        if (!fs.existsSync(archivo)) {
            console.warn(`  ! No encontré ${ruta}; se quita del contenido.`);
            subidas.set(ruta, null);
            return null;
        }
        const nueva = await store.guardarImagen(nombre, fs.readFileSync(archivo));
        console.log(`  imagen ${nombre}`);
        subidas.set(ruta, nueva);
        return nueva;
    }

    for (const s of db.servicios || []) {
        const nuevas = [];
        for (const r of s.imagenes || []) {
            const n = await subir(r);
            if (n) nuevas.push(n);
        }
        s.imagenes = nuevas;
    }
    if (db.nosotros && db.nosotros.imagen) db.nosotros.imagen = (await subir(db.nosotros.imagen)) || "";

    await store.guardarDb(db);
    console.log(`\nListo: ${(db.categorias || []).length} categorías, ${(db.servicios || []).length} servicios y ${subidas.size} imágenes en Redis.`);
    console.log("Recarga tu sitio de Vercel para verlos.");
})().catch((err) => {
    console.error("\nError:", err.message);
    process.exit(1);
});
