document.documentElement.classList.add('has-js');

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-nav');

function closeMenu() {
    if (!menuButton || !navigation) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Abrir menú');
    navigation.classList.remove('is-open');
    document.body.classList.remove('menu-open');
}

if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
        const willOpen = menuButton.getAttribute('aria-expanded') !== 'true';
        menuButton.setAttribute('aria-expanded', String(willOpen));
        menuButton.setAttribute('aria-label', willOpen ? 'Cerrar menú' : 'Abrir menú');
        navigation.classList.toggle('is-open', willOpen);
        document.body.classList.toggle('menu-open', willOpen);
    });

    navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeMenu();
    });
    window.addEventListener('resize', () => {
        if (window.innerWidth > 980) closeMenu();
    });
}

document.querySelectorAll('[data-year]').forEach((element) => {
    element.textContent = new Date().getFullYear();
});

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealElements = document.querySelectorAll(
    'main > section:not(.video-hero):not(.contact-stage), .service-line, .principles article, .step-stack details, .social-card'
);

revealElements.forEach((element) => element.classList.add('reveal'));

if (reduceMotion || !('IntersectionObserver' in window)) {
    revealElements.forEach((element) => element.classList.add('is-visible'));
} else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -35px' });
    revealElements.forEach((element) => revealObserver.observe(element));
}

const interactiveElements = document.querySelectorAll(
    '.pill, .nav-action, .cta-link, .social-card, .form-submit'
);

interactiveElements.forEach((element) => {
    element.addEventListener('pointerdown', (event) => {
        if (reduceMotion) return;
        const bounds = element.getBoundingClientRect();
        const wave = document.createElement('span');
        wave.className = 'click-wave';
        wave.style.left = `${event.clientX - bounds.left}px`;
        wave.style.top = `${event.clientY - bounds.top}px`;
        element.appendChild(wave);
        wave.addEventListener('animationend', () => wave.remove());
    });
});

document.querySelectorAll('a[href]').forEach((link) => {
    link.addEventListener('click', (event) => {
        if (reduceMotion || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return;
        const destination = new URL(link.href, window.location.href);
        if (destination.origin !== window.location.origin) return;
        if (destination.pathname === window.location.pathname && destination.hash) return;
        event.preventDefault();
        document.body.classList.add('is-leaving');
        window.setTimeout(() => { window.location.href = destination.href; }, 220);
    });
});

const appointmentForm = document.querySelector('#appointment-form');
const appointmentsEndpoint = 'https://solicitudes.gestiondevisaszaragoza.com/api/appointments';

if (appointmentForm) {
    const serviceSelect = appointmentForm.querySelector('#servicio');
    const dateInput = appointmentForm.querySelector('#fecha');
    const submitButton = appointmentForm.querySelector('.form-submit');
    const formStatus = appointmentForm.querySelector('#form-status');
    const selectedService = new URLSearchParams(window.location.search).get('servicio');
    const validServices = [
        'visa',
        'visa-canada',
        'renovaciones',
        'renovacion-visa',
        'pasaporte',
        'renovacion-pasaporte',
        'naturalizacion',
        'actas',
        'acta-nacimiento',
        'acta-defuncion',
        'acta-matrimonio',
        'acta-divorcio'
    ];

    if (validServices.includes(selectedService)) serviceSelect.value = selectedService;

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    dateInput.min = `${year}-${month}-${day}`;

    appointmentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!appointmentForm.reportValidity()) return;

        const data = new FormData(appointmentForm);
        const appointment = {
            nombre: String(data.get('nombre')).trim(),
            telefono: String(data.get('telefono')).trim(),
            correo: String(data.get('correo')).trim(),
            servicio: String(data.get('servicio')),
            fecha: String(data.get('fecha')),
            horario: String(data.get('horario')),
            mensaje: String(data.get('mensaje')).trim(),
            empresa: String(data.get('empresa') || '').trim(),
            consentimiento: data.get('consentimiento') === 'on'
        };

        submitButton.disabled = true;
        submitButton.textContent = 'Guardando solicitud…';
        formStatus.textContent = '';
        formStatus.className = 'form-status field--wide';

        try {
            const response = await fetch(appointmentsEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appointment)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || 'No fue posible registrar la solicitud.');
            const rememberedService = appointment.servicio;
            appointmentForm.reset();
            if (validServices.includes(rememberedService)) serviceSelect.value = rememberedService;
            formStatus.textContent = `Solicitud enviada correctamente. Tu folio es ${result.folio}. Nos pondremos en contacto contigo para confirmar la cita.`;
            formStatus.classList.add('is-success');
        } catch (error) {
            console.error('No se pudo guardar la solicitud:', error);
            formStatus.textContent = 'No pudimos enviar la solicitud en este momento. Inténtalo de nuevo o escríbenos por WhatsApp.';
            formStatus.classList.add('is-error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Enviar solicitud de cita';
        }
    });
}
