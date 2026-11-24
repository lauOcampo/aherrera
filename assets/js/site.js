/* Pide al servidor lo que el administrador guardó en el panel y lo pinta en el index */
(() => {
    const WHATSAPP = "https://wa.me/34682872705";
    const POR_PAGINA = 6;

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let data = { categorias: [], servicios: [], nosotros: null, portada: null, footer: null };
    let filtro = "todos";
    let verTodo = false;

    async function leer() {
        try {
            const res = await fetch("/api/contenido", { cache: "no-store" });
            if (!res.ok) throw new Error();
            const d = await res.json();
            return {
                categorias: d.categorias || [], servicios: d.servicios || [], nosotros: d.nosotros || null,
                portada: d.portada || null, footer: d.footer || null,
            };
        } catch (_) {
            return { categorias: [], servicios: [], nosotros: null, portada: null, footer: null };
        }
    }

    /* ---------- Portada: carrusel, título y etiquetas ---------- */
    const reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let slideActual = 0;
    let temporizador = null;

    function irASlide(i) {
        const slides = document.querySelectorAll("#heroSlides .hero__slide");
        if (!slides.length) return;
        slideActual = (i + slides.length) % slides.length;
        slides.forEach((s, n) => s.classList.toggle("is-active", n === slideActual));
        document.querySelectorAll("#heroDots button").forEach((b, n) =>
            b.setAttribute("aria-current", n === slideActual ? "true" : "false"));
    }

    function iniciarCarrusel(segundos) {
        clearInterval(temporizador);
        const total = document.querySelectorAll("#heroSlides .hero__slide").length;
        if (total < 2 || reducirMovimiento) return;
        temporizador = setInterval(() => {
            if (!document.hidden) irASlide(slideActual + 1);
        }, segundos * 1000);
    }

    function renderPortada() {
        const p = data.portada;
        if (!p || !p.editado) return; // sin cambios guardados: se queda lo del HTML

        if (p.titulo) $("heroTitulo").textContent = p.titulo;
        $("heroTags").innerHTML = (p.tags || []).map((t) => `<li>${esc(t)}</li>`).join("");
        $("heroTags").hidden = !(p.tags || []).length;

        const imgs = p.imagenes || [];
        $("heroSlides").innerHTML = imgs.map((src, i) =>
            `<img class="hero__slide${i === 0 ? " is-active" : ""}" src="${esc(src)}" alt=""${i ? ' loading="lazy"' : ""}>`
        ).join("");
        const segundos = p.intervalo || 5;
        $("heroDots").innerHTML = imgs.length > 1
            ? imgs.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Imagen ${i + 1}"></button>`).join("")
            : "";
        slideActual = 0;
        irASlide(0);
        iniciarCarrusel(segundos);

        $("heroDots").onclick = (e) => {
            const b = e.target.closest("[data-slide]");
            if (!b) return;
            irASlide(Number(b.dataset.slide));
            iniciarCarrusel(segundos); // reinicia el tiempo tras elegir una imagen
        };
    }

    /* ---------- Pie de página ---------- */
    function renderFooter() {
        const f = data.footer;
        if (!f || !f.editado) return;

        $("ftTexto").textContent = f.texto;
        $("ftTexto").hidden = !f.texto;
        $("ftNombre").textContent = f.nombre;
        $("ftNombre").hidden = !f.nombre;

        const contacto = [];
        if (f.instagram) {
            contacto.push(`<p><a href="https://instagram.com/${encodeURIComponent(f.instagram)}" target="_blank" rel="noopener">IG: ${esc(f.instagram)}</a></p>`);
        }
        if (f.telefono) contacto.push(`<p><a href="tel:${f.telefono.replace(/[^+0-9]/g, "")}">${esc(f.telefono)}</a></p>`);
        if (f.direccion) contacto.push(`<p>${esc(f.direccion)}</p>`);
        $("ftContacto").innerHTML = contacto.join("");
        $("ftContacto").parentElement.hidden = !contacto.length;

        $("ftHorarios").innerHTML = (f.horarios || []).map((h) => `<p>${esc(h)}</p>`).join("");
        $("ftHorarios").parentElement.hidden = !(f.horarios || []).length;
    }

    /* ---------- Acerca de nosotros ---------- */
    function formatoValor(valor) {
        const v = valor.trim();
        const i = v.lastIndexOf(" ");
        return i < 0 ? esc(v) : `${esc(v.slice(0, i))} <span>${esc(v.slice(i + 1))}</span>`;
    }

    function renderNosotros() {
        const n = data.nosotros;
        if (!n) return; // sin respuesta del servidor: se queda el contenido original del HTML

        if (n.imagen) $("aboutImg").src = n.imagen;
        if (n.titulo) $("aboutLead").textContent = n.titulo;

        // Solo se muestran las cifras que tienen valor: una caja sin número parece rota.
        // Se quitan del DOM (no solo se ocultan) para que los bordes de la cuadrícula cuadren.
        const stats = n.stats || [];
        document.querySelectorAll("#nosotros .stat").forEach((caja, i) => {
            const s = stats[i];
            if (!s || !s.valor) return caja.remove();
            const p = caja.querySelector("p");
            p.textContent = s.texto;
            p.hidden = !s.texto;
            caja.querySelector("strong").innerHTML = formatoValor(s.valor);
        });
        document.querySelector("#nosotros .stats").hidden = !document.querySelector("#nosotros .stat");
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

    // Carrusel de fotos dentro del detalle
    const SEGUNDOS_FOTO = 4;
    let fotoActual = 0;
    let totalFotos = 0;
    let timerFotos = null;

    function mostrarFoto(i) {
        if (!totalFotos) return;
        fotoActual = (i + totalFotos) % totalFotos;
        document.querySelectorAll("#mSlides img").forEach((img, n) =>
            img.classList.toggle("is-active", n === fotoActual));
        document.querySelectorAll("#mDots button").forEach((b, n) =>
            b.setAttribute("aria-current", n === fotoActual ? "true" : "false"));
    }

    function pararFotos() {
        clearInterval(timerFotos);
        timerFotos = null;
    }

    function arrancarFotos() {
        pararFotos();
        if (totalFotos < 2 || reducirMovimiento) return;
        timerFotos = setInterval(() => mostrarFoto(fotoActual + 1), SEGUNDOS_FOTO * 1000);
    }

    // Al cambiar de foto a mano, el tiempo vuelve a empezar
    function irAFoto(i) {
        mostrarFoto(i);
        arrancarFotos();
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

        const fotos = s.imagenes || [];
        totalFotos = fotos.length;
        $("mSlides").innerHTML = fotos.map((src, i) =>
            `<img src="${esc(src)}" alt="${i === 0 ? esc(s.nombre) : ""}">`).join("");
        const varias = totalFotos > 1;
        $("mPrev").hidden = !varias;
        $("mNext").hidden = !varias;
        $("mDots").innerHTML = varias
            ? fotos.map((_, i) => `<button type="button" data-foto="${i}" aria-label="Foto ${i + 1}"></button>`).join("")
            : "";
        mostrarFoto(0);

        modal.hidden = false;
        document.body.classList.add("no-scroll");
        arrancarFotos();
    }

    function cerrarModal() {
        pararFotos();
        modal.hidden = true;
        document.body.classList.remove("no-scroll");
    }

    $("mPrev").addEventListener("click", () => irAFoto(fotoActual - 1));
    $("mNext").addEventListener("click", () => irAFoto(fotoActual + 1));
    $("mDots").addEventListener("click", (e) => {
        const b = e.target.closest("[data-foto]");
        if (b) irAFoto(Number(b.dataset.foto));
    });
    // Se detiene mientras el cursor está sobre la foto, para poder mirarla con calma
    $("mGallery").addEventListener("mouseenter", pararFotos);
    $("mGallery").addEventListener("mouseleave", () => { if (!modal.hidden) arrancarFotos(); });

    // Deslizar con el dedo en el móvil
    let toqueX = null;
    $("mGallery").addEventListener("touchstart", (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
    $("mGallery").addEventListener("touchend", (e) => {
        if (toqueX === null) return;
        const dx = e.changedTouches[0].clientX - toqueX;
        toqueX = null;
        if (Math.abs(dx) > 40) irAFoto(fotoActual + (dx < 0 ? 1 : -1));
    });

    $("mClose").addEventListener("click", cerrarModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) cerrarModal(); });
    document.addEventListener("keydown", (e) => {
        if (modal.hidden) return;
        if (e.key === "Escape") cerrarModal();
        if (e.key === "ArrowLeft") irAFoto(fotoActual - 1);
        if (e.key === "ArrowRight") irAFoto(fotoActual + 1);
    });

    /* ---------- Inicio ---------- */
    (async () => {
        data = await leer();
        renderPortada();
        renderFooter();
        renderNosotros();
        renderServicios();
    })();
})();