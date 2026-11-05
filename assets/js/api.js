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
        if (!res.ok) throw Object.assign(new Error(datos.error || "Ocurrió un error."), { status: res.status });
        return datos;
    }

    window.API = {
        get: (ruta) => pedir("GET", ruta),
        post: (ruta, cuerpo = {}) => pedir("POST", ruta, cuerpo),
        put: (ruta, cuerpo = {}) => pedir("PUT", ruta, cuerpo),
        del: (ruta) => pedir("DELETE", ruta),
    };
})();
