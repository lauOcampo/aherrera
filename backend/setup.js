/*
 * Crea o cambia el usuario y la contraseña del administrador.
 * Guarda en .env el usuario y un HASH de la contraseña (la contraseña en sí no se guarda).
 *
 * Uso:  node backend/setup.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

const ENV = path.resolve(__dirname, "..", ".env");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let silenciar = false;
const escribir = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => { if (!silenciar || s.includes("\n")) escribir(silenciar ? "\n" : s); };

const lineas = rl[Symbol.asyncIterator]();

// Con oculto = true no se muestra lo que se escribe (para la contraseña)
async function preguntar(texto, oculto = false) {
    process.stdout.write(texto);
    silenciar = oculto;
    const { value } = await lineas.next();
    silenciar = false;
    if (oculto && !process.stdin.isTTY) process.stdout.write("\n");
    return value || "";
}

function hashPassword(password) {
    const sal = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, sal, 64);
    return `scrypt$${sal.toString("hex")}$${hash.toString("hex")}`;
}

function escribirEnv(valores) {
    const lineas = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8").split(/\r?\n/) : [];
    for (const [k, v] of Object.entries(valores)) {
        const i = lineas.findIndex((l) => l.startsWith(k + "="));
        if (i >= 0) lineas[i] = `${k}=${v}`;
        else lineas.push(`${k}=${v}`);
    }
    fs.writeFileSync(ENV, lineas.filter((l, i, a) => l || i < a.length - 1).join("\n") + "\n", { mode: 0o600 });
}

(async () => {
    console.log("Configuración del administrador\n");
    const usuario = (await preguntar("Usuario: ")).trim();
    if (!/^[\w.@-]{3,40}$/.test(usuario)) {
        console.error("El usuario debe tener entre 3 y 40 caracteres (letras, números, punto, guion o @).");
        process.exit(1);
    }
    const pass = await preguntar("Contraseña (mínimo 10 caracteres): ", true);
    if (pass.length < 10) {
        console.error("La contraseña es muy corta. Usa al menos 10 caracteres.");
        process.exit(1);
    }
    const repetir = await preguntar("Repite la contraseña: ", true);
    if (pass !== repetir) {
        console.error("Las contraseñas no coinciden.");
        process.exit(1);
    }
    rl.close();
    const hash = hashPassword(pass);
    escribirEnv({ ADMIN_USER: usuario, ADMIN_PASS_HASH: hash });
    console.log("\nListo. Datos guardados en .env");
    console.log("Si el servidor estaba encendido, reinícialo para aplicar el cambio.");
    console.log("\nPara el sitio en Vercel, crea estas dos variables (Settings → Environment Variables),");
    console.log("sin comillas ni espacios, y vuelve a desplegar:\n");
    console.log(`  ADMIN_USER       ${usuario}`);
    console.log(`  ADMIN_PASS_HASH  ${hash}\n`);
})();
