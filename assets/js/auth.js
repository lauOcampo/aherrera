/* Acceso al panel de administración.
   El usuario y la contraseña se comprueban en el servidor (backend/server.js);
   aquí no hay ninguna credencial. La sesión es una cookie HttpOnly que JavaScript no puede leer.
   Requiere api.js. */
(() => {
    window.Auth = {
        async activo() {
            try { return (await API.get("/api/sesion")).activo; } catch (_) { return false; }
        },

        // Devuelve "" si entró, o el mensaje de error del servidor
        async login(usuario, password) {
            try {
                await API.post("/api/login", { usuario, password });
                return "";
            } catch (err) {
                return err.message;
            }
        },

        async logout() {
            try { await API.post("/api/logout"); } catch (_) { /* nada */ }
        },

        // Oculta la página hasta confirmar la sesión; si no hay, va al login.
        // (La protección real está en el servidor: sin sesión la API no deja modificar nada.)
        proteger(urlLogin) {
            const raiz = document.documentElement;
            raiz.style.visibility = "hidden";
            const comprobar = async () => {
                if (await Auth.activo()) raiz.style.visibility = "";
                else location.replace(urlLogin);
            };
            comprobar();
            window.addEventListener("pageshow", (e) => { if (e.persisted) comprobar(); });
        },
    };
})();
