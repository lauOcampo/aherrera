/* Panel de administración: todo se guarda en el servidor mediante la API (api.js). */
(() => {
    const MAX_DESTACADOS = 4;

    // ---------- Estado ----------
    const vacio = () => ({ valor: "", texto: "" });
    let state = {
        categorias: [],
        servicios: [],
        nosotros: { imagen: "", titulo: "", stats: Array.from({ length: 4 }, vacio) },
    };
    let imagenes = [];      // imágenes del formulario: rutas ya guardadas ("/uploads/...") o nuevas (data URL)
    let editandoId = null;

    // Ejecuta una petición a la API; el servidor responde con todo el contenido actualizado.
    // Devuelve "" si salió bien o el mensaje de error.
    async function enviar(peticion) {
        try {
            state = await peticion;
            return "";
        } catch (err) {
            if (err.status === 401) {
                alert(err.message);
                location.replace("login.html");
            }
            return err.message;
        }
    }
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const $ = (id) => document.getElementById(id);

    // ---------- Navegación ----------
    document.querySelectorAll(".nav-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
            document.querySelectorAll(".view").forEach((v) =>
                v.classList.toggle("is-active", v.id === "view-" + btn.dataset.view));
        });
    });

    // ---------- Categorías ----------
    const formCategoria = $("formCategoria");
    const listaCategorias = $("listaCategorias");

    formCategoria.addEventListener("submit", async (e) => {
        e.preventDefault();
        const nombre = $("catNombre").value.trim();
        if (!nombre) return;
        if (state.categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
            alert("Esa categoría ya existe.");
            return;
        }
        const boton = formCategoria.querySelector("button");
        boton.disabled = true;
        const error = await enviar(API.post("/api/categorias", { nombre }));
        boton.disabled = false;
        if (error) return alert(error);
        formCategoria.reset();
        renderCategorias();
        renderSelectCategorias();
    });

    function renderCategorias() {
        if (!state.categorias.length) {
            listaCategorias.innerHTML = '<li class="empty">Aún no hay categorías.</li>';
            return;
        }
        listaCategorias.innerHTML = state.categorias.map((c) => {
            const total = state.servicios.filter((s) => s.categoriaId === c.id).length;
            return `<li>
        <span>${esc(c.nombre)}<span class="count">${total} servicio${total === 1 ? "" : "s"}</span></span>
        <button class="btn btn--danger btn--sm" data-del-cat="${c.id}">Eliminar</button>
      </li>`;
        }).join("");
    }

    listaCategorias.addEventListener("click", async (e) => {
        const id = e.target.dataset.delCat;
        if (!id) return;
        const usados = state.servicios.filter((s) => s.categoriaId === id).length;
        if (usados) {
            alert("No puedes eliminar una categoría que tiene servicios. Elimina o mueve esos servicios primero.");
            return;
        }
        if (!confirm("¿Eliminar esta categoría?")) return;
        const error = await enviar(API.del(`/api/categorias/${id}`));
        if (error) return alert(error);
        renderCategorias();
        renderSelectCategorias();
    });

    function renderSelectCategorias(seleccion) {
        const select = $("srvCategoria");
        const actual = seleccion || select.value;
        if (!state.categorias.length) {
            select.innerHTML = '<option value="">Primero crea una categoría</option>';
            return;
        }
        select.innerHTML = '<option value="">Selecciona una categoría</option>' +
            state.categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
        select.value = actual || "";
    }

    // ---------- Elementos destacados ----------
    const contDestacados = $("destacados");
    const btnAddDestacado = $("addDestacado");

    function addDestacado(valor = "") {
        if (contDestacados.children.length >= MAX_DESTACADOS) return;
        const row = document.createElement("div");
        row.className = "destacado-row";
        row.innerHTML = `<input type="text" maxlength="60" placeholder="Ej: Alta fluidez" value="${esc(valor)}">
                     <button type="button" aria-label="Quitar">×</button>`;
        row.querySelector("button").addEventListener("click", () => {
            row.remove();
            actualizarBtnDestacado();
        });
        contDestacados.appendChild(row);
        actualizarBtnDestacado();
    }

    function actualizarBtnDestacado() {
        const lleno = contDestacados.children.length >= MAX_DESTACADOS;
        btnAddDestacado.disabled = lleno;
        btnAddDestacado.textContent = lleno
            ? `Máximo ${MAX_DESTACADOS} elementos`
            : "+ Agregar elemento";
    }

    btnAddDestacado.addEventListener("click", () => addDestacado());

    // ---------- Imágenes ----------
    const inputImagenes = $("srvImagenes");
    const preview = $("previewImagenes");

    // Reduce la imagen para que no llene el almacenamiento del navegador
    function comprimir(file, max = 900, calidad = 0.75) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                const img = new Image();
                img.onerror = reject;
                img.onload = () => {
                    const escala = Math.min(1, max / Math.max(img.width, img.height));
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.round(img.width * escala);
                    canvas.height = Math.round(img.height * escala);
                    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL("image/jpeg", calidad));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    inputImagenes.addEventListener("change", async () => {
        for (const file of inputImagenes.files) {
            try { imagenes.push(await comprimir(file)); } catch (_) { /* ignora archivos inválidos */ }
        }
        inputImagenes.value = "";
        renderPreview();
    });

    function renderPreview() {
        preview.innerHTML = imagenes.map((src, i) =>
            `<div class="thumb"><img src="${src}" alt=""><button type="button" data-rm="${i}" aria-label="Quitar imagen">×</button></div>`
        ).join("");
    }

    preview.addEventListener("click", (e) => {
        const i = e.target.dataset.rm;
        if (i === undefined) return;
        imagenes.splice(Number(i), 1);
        renderPreview();
    });

    // ---------- Servicios ----------
    const formServicio = $("formServicio");
    const msg = $("msgServicio");

    function mostrarMsg(texto, ok = false) {
        msg.textContent = texto;
        msg.classList.toggle("ok", ok);
    }

    function resetFormulario() {
        formServicio.reset();
        contDestacados.innerHTML = "";
        imagenes = [];
        editandoId = null;
        renderPreview();
        addDestacado();
        renderSelectCategorias("");
        $("formTitulo").textContent = "Nuevo servicio";
        $("btnGuardar").textContent = "Crear servicio";
        $("cancelarEdicion").hidden = true;
    }

    formServicio.addEventListener("submit", async (e) => {
        e.preventDefault();
        const nombre = $("srvNombre").value.trim();
        const categoriaId = $("srvCategoria").value;
        const descripcion = $("srvDescripcion").value.trim();
        const destacados = [...contDestacados.querySelectorAll("input")]
            .map((i) => i.value.trim()).filter(Boolean).slice(0, MAX_DESTACADOS);

        if (!state.categorias.length) return mostrarMsg("Primero crea una categoría.");
        if (!nombre) return mostrarMsg("Escribe el nombre del servicio.");
        if (!categoriaId) return mostrarMsg("Selecciona una categoría.");
        if (!descripcion) return mostrarMsg("Escribe una descripción.");
        if (!imagenes.length) return mostrarMsg("Agrega al menos una imagen.");

        const servicio = { nombre, categoriaId, descripcion, destacados, imagenes };
        const btn = $("btnGuardar");
        btn.disabled = true;
        mostrarMsg("Guardando...", true);
        const error = await enviar(editandoId
            ? API.put(`/api/servicios/${editandoId}`, servicio)
            : API.post("/api/servicios", servicio));
        btn.disabled = false;
        if (error) return mostrarMsg(error);

        const fueEdicion = Boolean(editandoId);
        resetFormulario();
        renderServicios();
        renderCategorias();
        mostrarMsg(fueEdicion ? "Servicio actualizado." : "Servicio creado.", true);
    });

    $("cancelarEdicion").addEventListener("click", () => {
        resetFormulario();
        mostrarMsg("");
    });

    function renderServicios() {
        const cont = $("listaServicios");
        if (!state.servicios.length) {
            cont.innerHTML = '<p class="empty">Aún no hay servicios.</p>';
            return;
        }
        cont.innerHTML = state.servicios.map((s) => {
            const cat = state.categorias.find((c) => c.id === s.categoriaId);
            return `<article class="card">
        <div class="card__img">
          <img src="${s.imagenes[0]}" alt="${esc(s.nombre)}">
          ${s.imagenes.length > 1 ? `<span class="card__badge">${s.imagenes.length} fotos</span>` : ""}
        </div>
        <div class="card__body">
          <span class="card__cat">${esc(cat ? cat.nombre : "Sin categoría")}</span>
          <h3>${esc(s.nombre)}</h3>
          <p class="card__desc">${esc(s.descripcion)}</p>
          <ul>${s.destacados.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
        </div>
        <div class="card__actions">
          <button class="btn btn--ghost btn--sm" data-edit="${s.id}">Editar</button>
          <button class="btn btn--danger btn--sm" data-del="${s.id}">Eliminar</button>
        </div>
      </article>`;
        }).join("");
    }

    $("listaServicios").addEventListener("click", async (e) => {
        const { edit, del } = e.target.dataset;

        if (del) {
            if (!confirm("¿Eliminar este servicio?")) return;
            const error = await enviar(API.del(`/api/servicios/${del}`));
            if (error) return alert(error);
            if (editandoId === del) resetFormulario();
            renderServicios();
            renderCategorias();
        }

        if (edit) {
            const s = state.servicios.find((x) => x.id === edit);
            if (!s) return;
            editandoId = s.id;
            $("srvNombre").value = s.nombre;
            $("srvDescripcion").value = s.descripcion;
            renderSelectCategorias(s.categoriaId);
            contDestacados.innerHTML = "";
            (s.destacados.length ? s.destacados : [""]).forEach(addDestacado);
            imagenes = [...s.imagenes];
            renderPreview();
            $("formTitulo").textContent = "Editar servicio";
            $("btnGuardar").textContent = "Guardar cambios";
            $("cancelarEdicion").hidden = false;
            mostrarMsg("");
            formServicio.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });

    // ---------- Acerca de nosotros ----------
    const formNos = $("formNosotros");
    const nosTitulo = $("nosTitulo");
    const statEls = [...formNos.querySelectorAll(".stat-edit")];
    let nosImagen = "";

    function leerNosotros() {
        return {
            imagen: nosImagen,
            titulo: nosTitulo.value.trim(),
            stats: statEls.map((el) => ({
                valor: el.querySelector(".stat-valor").value.trim(),
                texto: el.querySelector(".stat-texto").value.trim(),
            })),
        };
    }

    function renderNosImagen() {
        $("nosImagenPreview").innerHTML = nosImagen
            ? `<div class="thumb"><img src="${nosImagen}" alt=""><button type="button" id="quitarNosImagen" aria-label="Quitar imagen">×</button></div>`
            : "";
    }

    function renderAboutPreview() {
        const n = leerNosotros();
        $("aboutPreview").innerHTML = `
      <div class="ap__img">${n.imagen ? `<img src="${n.imagen}" alt="">` : '<div class="ap__ph">Sin imagen</div>'}</div>
      <div class="ap__txt">
        <p class="ap__lead">${esc(n.titulo) || '<span class="ph">Texto principal...</span>'}</p>
        <div class="ap__stats">
          ${n.stats.map((s, i) =>
            `<div class="ap__stat${i === 1 ? " is-hl" : ""}"><p>${esc(s.texto)}</p><strong>${esc(s.valor)}</strong></div>`
        ).join("")}
        </div>
      </div>`;
    }

    function cargarNosotros() {
        const n = state.nosotros;
        nosImagen = n.imagen;
        nosTitulo.value = n.titulo;
        statEls.forEach((el, i) => {
            el.querySelector(".stat-valor").value = n.stats[i].valor;
            el.querySelector(".stat-texto").value = n.stats[i].texto;
        });
        renderNosImagen();
        renderAboutPreview();
    }

    formNos.addEventListener("input", renderAboutPreview);

    $("nosImagen").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { nosImagen = await comprimir(file, 700); } catch (_) { /* archivo inválido */ }
        e.target.value = "";
        renderNosImagen();
        renderAboutPreview();
    });

    $("nosImagenPreview").addEventListener("click", (e) => {
        if (e.target.id !== "quitarNosImagen") return;
        nosImagen = "";
        renderNosImagen();
        renderAboutPreview();
    });

    formNos.addEventListener("submit", async (e) => {
        e.preventDefault();
        const msgNos = $("msgNosotros");
        const btn = formNos.querySelector("button[type=submit]");
        btn.disabled = true;
        const error = await enviar(API.put("/api/nosotros", leerNosotros()));
        btn.disabled = false;
        if (error) {
            msgNos.classList.remove("ok");
            msgNos.textContent = error;
            return;
        }
        cargarNosotros();
        msgNos.classList.add("ok");
        msgNos.textContent = "Cambios guardados.";
        setTimeout(() => { msgNos.textContent = ""; }, 3000);
    });

    // ---------- Cerrar sesión ----------
    $("logout").addEventListener("click", async () => {
        await Auth.logout();
        location.href = "login.html";
    });

    // ---------- Inicio ----------
    async function iniciar() {
        try {
            state = await API.get("/api/contenido");
        } catch (err) {
            alert("No se pudo cargar el contenido: " + err.message);
        }
        renderCategorias();
        renderSelectCategorias();
        renderServicios();
        cargarNosotros();
    }

    addDestacado();
    iniciar();
})();