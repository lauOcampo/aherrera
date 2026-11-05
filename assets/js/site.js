/* Pide al servidor lo que el administrador guardó en el panel y lo pinta en el index */
(() => {
    const WHATSAPP = "https://wa.me/34682872705";
    const POR_PAGINA = 6;

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let data = { categorias: [], servicios: [], nosotros: null };
    let filtro = "todos";
    let verTodo = false;

    async function leer() {
        try {
            const res = await fetch("/api/contenido", { cache: "no-store" });
            if (!res.ok) throw new Error();
            const d = await res.json();
            return { categorias: d.categorias || [], servicios: d.servicios || [], nosotros: d.nosotros || null };
        } catch (_) {
            return { categorias: [], servicios: [], nosotros: null };
        }
    }

    /* ---------- Acerca de nosotros ---------- */
    function formatoValor(valor) {
        const v = valor.trim();
        const i = v.lastIndexOf(" ");
        return i < 0 ? esc(v) : `${esc(v.slice(0, i))} <span>${esc(v.slice(i + 1))}</span>`;
    }

    function renderNosotros() {
        const n = data.nosotros;
        if (!n) return; // si no hay nada guardado, se queda el contenido original del HTML

        if (n.imagen) $("aboutImg").src = n.imagen;
        if (n.titulo) $("aboutLead").textContent = n.titulo;

        const cajas = document.querySelectorAll("#nosotros .stat");
        (n.stats || []).forEach((s, i) => {
            const caja = cajas[i];
            if (!caja || (!s.valor && !s.texto)) return;
            caja.querySelector("p").textContent = s.texto;
            caja.querySelector("strong").innerHTML = formatoValor(s.valor);
        });
    }

    /* ---------- Servicios ---------- */
    function listaFiltrada() {
        return filtro === "todos"
            ? data.servicios
            : data.servicios.filter((s) => s.categoriaId === filtro);
    }

    function renderFiltros() {
        const usadas = data.categorias.filter((c) => data.servicios.some((s) => s.categoriaId === c.id));
        if (filtro !== "todos" && !usadas.some((c) => c.id === filtro)) filtro = "todos";

        const total = listaFiltrada().length;
        const pills = [{ id: "todos", nombre: "Todos" }, ...usadas].map((c) =>
            `<button type="button" class="pill${c.id === filtro ? " pill--active" : ""}" data-cat="${c.id}">${esc(c.nombre)}</button>`
        ).join("");

        const mas = total > POR_PAGINA
            ? `<a href="#" class="filters__more" data-mas>${verTodo ? "Ver menos ‹" : "Ver más ›"}</a>`
            : "";

        $("filters").innerHTML = pills + mas;
    }

    function renderCards() {
        const cont = $("cards");
        let lista = listaFiltrada();
        if (!verTodo) lista = lista.slice(0, POR_PAGINA);

        if (!lista.length) {
            cont.innerHTML = '<p class="cards__empty">Próximamente publicaremos nuestros servicios.</p>';
            return;
        }

        cont.innerHTML = lista.map((s) => `
      <article class="card">
        <img src="${s.imagenes[0]}" alt="${esc(s.nombre)}">
        <h3>${esc(s.nombre)}</h3>
        <p>${esc(s.descripcion)}</p>
        <ul>${(s.destacados || []).map((d) => `<li>${esc(d)}</li>`).join("")}</ul>
        <a href="#" class="btn btn--primary btn--sm" data-ver="${s.id}">Ver Servicio</a>
      </article>`).join("");
    }

    function renderServicios() {
        renderFiltros();
        renderCards();
    }

    $("filters").addEventListener("click", (e) => {
        const pill = e.target.closest("[data-cat]");
        if (pill) {
            filtro = pill.dataset.cat;
            verTodo = false;
            renderServicios();
            return;
        }
        if (e.target.closest("[data-mas]")) {
            e.preventDefault();
            verTodo = !verTodo;
            renderServicios();
        }
    });

    $("cards").addEventListener("click", (e) => {
        const link = e.target.closest("[data-ver]");
        if (!link) return;
        e.preventDefault();
        abrirModal(link.dataset.ver);
    });

    /* ---------- Modal de detalle ---------- */
    const modal = $("modal");

    function mostrarImagen(src) {
        $("mImg").src = src;
        document.querySelectorAll("#mThumbs img").forEach((t) =>
            t.classList.toggle("is-active", t.dataset.src === src));
    }

    function abrirModal(id) {
        const s = data.servicios.find((x) => x.id === id);
        if (!s) return;
        const cat = data.categorias.find((c) => c.id === s.categoriaId);

        $("mCat").textContent = cat ? cat.nombre : "";
        $("mTitulo").textContent = s.nombre;
        $("mDesc").textContent = s.descripcion;
        $("mDest").innerHTML = (s.destacados || []).map((d) => `<li>${esc(d)}</li>`).join("");
        $("mWa").href = `${WHATSAPP}?text=${encodeURIComponent("Hola, me interesa el servicio: " + s.nombre)}`;

        $("mThumbs").innerHTML = s.imagenes.length > 1
            ? s.imagenes.map((src) => `<img src="${src}" data-src="${src}" alt="">`).join("")
            : "";
        mostrarImagen(s.imagenes[0]);

        modal.hidden = false;
        document.body.classList.add("no-scroll");
    }

    function cerrarModal() {
        modal.hidden = true;
        document.body.classList.remove("no-scroll");
    }

    $("mThumbs").addEventListener("click", (e) => {
        if (e.target.dataset.src) mostrarImagen(e.target.dataset.src);
    });
    $("mClose").addEventListener("click", cerrarModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) cerrarModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) cerrarModal(); });

    /* ---------- Inicio ---------- */
    (async () => {
        data = await leer();
        renderNosotros();
        renderServicios();
    })();
})();