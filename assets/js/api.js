/* Comunicación con el backend (backend/server.js). */
(() => {
    async function pedir(metodo, ruta, cuerpo) {
        const opciones = { method: metodo, credentials: "same-origin", headers: {} };
        if (cuerpo !== undefined) {
            opciones.headers["Content-Type"] = "application/json";
            opciones.body = JSON.stringify(cuerpo);
        }
        let res;
        try {
            res = await fetch(ruta, opciones);
        } catch (_) {
            throw Object.assign(new Error("No se pudo conectar con el servidor."), { status: 0 });
        }
        const datos = await res.json().catch(() => ({}));
        if (!res.ok) {
            let msg = datos.error;
            if (!msg && res.status === 413) msg = "Las imágenes pesan demasiado. Sube menos fotos a la vez.";
            if (!msg && res.status === 404) msg = "El servidor no responde en esta dirección (falta la API).";
            throw Object.assign(new Error(msg || `Ocurrió un error (${res.status}).`), { status: res.status });
        }
        return datos;
    }

    window.API = {
        get: (ruta) => pedir("GET", ruta),
        post: (ruta, cuerpo = {}) => pedir("POST", ruta, cuerpo),
        put: (ruta, cuerpo = {}) => pedir("PUT", ruta, cuerpo),
        del: (ruta) => pedir("DELETE", ruta),
    };
})();
