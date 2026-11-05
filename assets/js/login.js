(async () => {
    const DESTINO = "dashboard.html";

    // Si ya hay sesión, directo al panel
    if (await Auth.activo()) {
        location.replace(DESTINO);
        return;
    }

    const form = document.getElementById("loginForm");
    const pass = document.getElementById("password");
    const toggle = document.getElementById("toggle");
    const error = document.getElementById("error");
    const boton = form.querySelector(".login__btn");

    toggle.addEventListener("click", () => {
        const oculto = pass.type === "password";
        pass.type = oculto ? "text" : "password";
        toggle.textContent = oculto ? "Ocultar" : "Mostrar";
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const usuario = form.usuario.value.trim();

        if (!usuario || !pass.value) {
            error.textContent = "Completa usuario y contraseña.";
            return;
        }

        boton.disabled = true;
        error.textContent = "";
        const fallo = await Auth.login(usuario, pass.value);
        boton.disabled = false;

        if (fallo) {
            error.textContent = fallo;
            pass.value = "";
            pass.focus();
            return;
        }
        location.href = DESTINO;
    });
})();
