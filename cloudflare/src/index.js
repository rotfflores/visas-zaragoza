const SERVICE_NAMES = Object.freeze({
    visa: 'Visa estadounidense',
    'visa-canada': 'Visa canadiense',
    renovaciones: 'Renovación de visa o pasaporte',
    'renovacion-visa': 'Renovación de visa',
    pasaporte: 'Pasaporte mexicano',
    'renovacion-pasaporte': 'Renovación de pasaporte',
    naturalizacion: 'Naturalización mexicana',
    actas: 'Acta del Registro Civil',
    'acta-nacimiento': 'Acta de nacimiento',
    'acta-defuncion': 'Acta de defunción',
    'acta-matrimonio': 'Acta de matrimonio',
    'acta-divorcio': 'Acta de divorcio'
});

const VALID_SLOTS = new Set(['Por la mañana', 'Por la tarde']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_COOKIE = 'gvz_session';

function bytesToBase64Url(bytes) {
    let value = '';
    for (const byte of bytes) value += String.fromCharCode(byte);
    return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value) {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const raw = atob(padded);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function safeEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
}

async function verifyPassword(password, encodedRecord) {
    const [iterationsText, saltText, hashText] = String(encodedRecord || '').split(':');
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < 100000 || !saltText || !hashText) return false;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const derived = new Uint8Array(await crypto.subtle.deriveBits({
        name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(saltText), iterations
    }, key, 256));
    return safeEqual(derived, base64UrlToBytes(hashText));
}

async function hmac(value, secret) {
    const key = await crypto.subtle.importKey('raw', base64UrlToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

async function createSession(email, env) {
    const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ email, expires: Date.now() + 8 * 60 * 60 * 1000 })));
    return `${payload}.${bytesToBase64Url(await hmac(payload, env.SESSION_SECRET))}`;
}

async function getSessionEmail(request, env) {
    const match = request.headers.get('Cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
    if (!match) return null;
    const [payload, signature] = match[1].split('.');
    if (!payload || !signature) return null;
    try {
        const expected = await hmac(payload, env.SESSION_SECRET);
        if (!safeEqual(expected, base64UrlToBytes(signature))) return null;
        const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
        const credentials = JSON.parse(env.ADMIN_CREDENTIALS || '{}');
        if (session.expires < Date.now() || !credentials[String(session.email).toLowerCase()]) return null;
        return String(session.email).toLowerCase();
    } catch { return null; }
}

function json(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
    });
}

function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim());
    if (!allowed.includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin'
    };
}

function clean(value, maxLength) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function isRealDate(value) {
    if (!DATE_PATTERN.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function mexicoToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
}

function validateAppointment(input) {
    const appointment = {
        nombre: clean(input.nombre, 120),
        telefono: clean(input.telefono, 30),
        correo: clean(input.correo, 254).toLowerCase(),
        servicio: clean(input.servicio, 40),
        fecha: clean(input.fecha, 10),
        horario: clean(input.horario, 30),
        mensaje: clean(input.mensaje, 2000),
        consentimiento: input.consentimiento === true
    };

    if (appointment.nombre.length < 3) return { error: 'Escribe tu nombre completo.' };
    if (!/^[+\d][\d\s().-]{7,29}$/.test(appointment.telefono)) return { error: 'Revisa el número de teléfono.' };
    if (appointment.correo && !EMAIL_PATTERN.test(appointment.correo)) return { error: 'Revisa el correo electrónico.' };
    if (!(appointment.servicio in SERVICE_NAMES)) return { error: 'Selecciona un trámite válido.' };
    if (!isRealDate(appointment.fecha) || appointment.fecha < mexicoToday()) return { error: 'Selecciona una fecha válida.' };
    if (!VALID_SLOTS.has(appointment.horario)) return { error: 'Selecciona un horario válido.' };
    if (!appointment.consentimiento) return { error: 'Debes autorizar el uso de tus datos para enviar la solicitud.' };
    return { appointment };
}

function makeFolio() {
    return `GVZ-${crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

async function createAppointment(request, env) {
    const headers = corsHeaders(request, env);
    if (!headers['Access-Control-Allow-Origin']) return json({ ok: false, error: 'Origen no autorizado.' }, 403);
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 16384) return json({ ok: false, error: 'La solicitud es demasiado grande.' }, 413, headers);

    let input;
    try { input = await request.json(); } catch { return json({ ok: false, error: 'Datos no válidos.' }, 400, headers); }
    if (clean(input.empresa, 80)) return json({ ok: true, folio: makeFolio() }, 201, headers);

    const result = validateAppointment(input);
    if (result.error) return json({ ok: false, error: result.error }, 400, headers);
    const value = result.appointment;
    const folio = makeFolio();

    await env.DB.prepare(`
        INSERT INTO appointments
            (folio, nombre, telefono, correo, servicio, fecha, horario, mensaje, consentimiento_en)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        folio, value.nombre, value.telefono, value.correo || null, value.servicio,
        value.fecha, value.horario, value.mensaje || null, new Date().toISOString()
    ).run();

    return json({ ok: true, folio }, 201, headers);
}

async function listAppointments(env) {
    const { results } = await env.DB.prepare(`
        SELECT folio, nombre, telefono, correo, servicio, fecha, horario, mensaje, estado, creado_en
        FROM appointments
        ORDER BY creado_en DESC
        LIMIT 500
    `).all();
    return json({ ok: true, appointments: results }, 200, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
}

const ADMIN_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Solicitudes | Gestión de Visas Zaragoza</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap');
:root{--ink:#102a43;--teal:#285a5a;--paper:#fff;--fog:#f3f6f9;--muted:#607085;--line:#dce4eb;--danger:#a33a32}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--fog);font:400 16px/1.5 Manrope,Arial,sans-serif}.top{padding:22px clamp(20px,5vw,70px);display:flex;align-items:center;justify-content:space-between;gap:24px;color:#fff;background:var(--ink)}.brand{display:flex;gap:14px;align-items:center}.mark{width:42px;height:42px;display:grid;place-items:center;border:1px solid #ffffff55;border-radius:50%;font-weight:700}.brand b,.brand small{display:block}.brand small{color:#ffffffaa}button,input,select{font:inherit}.refresh{padding:11px 17px;color:#fff;background:#ffffff12;border:1px solid #ffffff55;border-radius:999px;cursor:pointer}.main{width:min(1180px,calc(100% - 34px));margin:0 auto;padding:55px 0}.heading{display:flex;align-items:end;justify-content:space-between;gap:30px;margin-bottom:28px}.heading h1{margin:0;font-size:clamp(2.2rem,5vw,4.6rem);line-height:1;letter-spacing:-.05em}.heading p{max-width:430px;margin:0;color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}.metric{padding:22px;background:var(--paper);border:1px solid var(--line)}.metric span{display:block;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.1em}.metric strong{font-size:2rem}.filters{padding:16px;display:grid;grid-template-columns:1fr 210px;gap:12px;background:var(--paper);border:1px solid var(--line);border-bottom:0}.filters input,.filters select{width:100%;min-height:48px;padding:11px 14px;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px}.table-wrap{overflow:auto;background:#fff;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;min-width:960px}th,td{padding:16px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{position:sticky;top:0;color:#fff;background:var(--teal);font-size:.75rem;letter-spacing:.08em;text-transform:uppercase}td{font-size:.88rem}.name{font-weight:700}.folio{color:var(--teal);font-weight:600}.meta{display:block;color:var(--muted);font-size:.78rem}.message{max-width:270px;white-space:pre-wrap}.status{display:inline-block;padding:5px 9px;background:#e7f0ef;border-radius:999px;font-size:.72rem;font-weight:700}.empty{padding:55px 20px;text-align:center;color:var(--muted)}.error{color:var(--danger)}
@media(max-width:720px){.top,.heading{align-items:flex-start}.brand small{display:none}.heading{flex-direction:column}.summary{grid-template-columns:1fr}.filters{grid-template-columns:1fr}.main{padding-top:35px}}
</style></head><body>
<header class="top"><div class="brand"><span class="mark">GV</span><span><b>Gestión de Visas</b><small>Zaragoza · Panel privado</small></span></div><div style="display:flex;gap:10px"><button class="refresh" id="refresh" type="button">Actualizar</button><form method="post" action="/panel/logout"><button class="refresh" type="submit">Salir</button></form></div></header>
<main class="main"><div class="heading"><h1>Solicitudes de cita</h1><p>Aquí aparecen los datos enviados desde el formulario de contacto, empezando por los más recientes.</p></div>
<section class="summary" aria-label="Resumen"><div class="metric"><span>Total</span><strong id="total">—</strong></div><div class="metric"><span>Pendientes</span><strong id="pending">—</strong></div><div class="metric"><span>Próximas citas</span><strong id="upcoming">—</strong></div></section>
<div class="filters"><input id="search" type="search" placeholder="Buscar por nombre, teléfono, correo o folio" aria-label="Buscar solicitudes"><select id="status" aria-label="Filtrar por estado"><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="contactado">Contactados</option><option value="cerrado">Cerrados</option></select></div>
<div class="table-wrap"><table><thead><tr><th>Persona</th><th>Trámite</th><th>Fecha solicitada</th><th>Mensaje</th><th>Recibida</th><th>Estado</th></tr></thead><tbody id="rows"><tr><td colspan="6" class="empty">Cargando solicitudes…</td></tr></tbody></table></div></main>
<script>
const names=${JSON.stringify(SERVICE_NAMES)};let all=[];const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeZone:'America/Mexico_City'}).format(new Date(v));
function render(){const q=document.querySelector('#search').value.trim().toLowerCase();const s=document.querySelector('#status').value;const shown=all.filter(a=>(!s||a.estado===s)&&(!q||[a.folio,a.nombre,a.telefono,a.correo,names[a.servicio]].join(' ').toLowerCase().includes(q)));document.querySelector('#rows').innerHTML=shown.length?shown.map(a=>'<tr><td><span class="name">'+esc(a.nombre)+'</span><span class="meta">'+esc(a.telefono)+'</span><span class="meta">'+esc(a.correo||'Sin correo')+'</span><span class="folio">'+esc(a.folio)+'</span></td><td>'+esc(names[a.servicio]||a.servicio)+'</td><td>'+esc(a.fecha)+'<span class="meta">'+esc(a.horario)+'</span></td><td class="message">'+esc(a.mensaje||'Sin mensaje')+'</td><td>'+date(a.creado_en)+'</td><td><span class="status">'+esc(a.estado)+'</span></td></tr>').join(''):'<tr><td colspan="6" class="empty">No hay solicitudes que coincidan.</td></tr>';}
async function load(){const rows=document.querySelector('#rows');rows.innerHTML='<tr><td colspan="6" class="empty">Cargando solicitudes…</td></tr>';try{const r=await fetch('/panel/api/appointments',{cache:'no-store'});if(!r.ok)throw new Error();const data=await r.json();all=data.appointments||[];document.querySelector('#total').textContent=all.length;document.querySelector('#pending').textContent=all.filter(a=>a.estado==='pendiente').length;const today=new Date().toISOString().slice(0,10);document.querySelector('#upcoming').textContent=all.filter(a=>a.fecha>=today&&a.estado!=='cerrado').length;render()}catch{rows.innerHTML='<tr><td colspan="6" class="empty error">No fue posible cargar las solicitudes. Actualiza la página.</td></tr>'}}
document.querySelector('#search').addEventListener('input',render);document.querySelector('#status').addEventListener('change',render);document.querySelector('#refresh').addEventListener('click',load);load();
</script></body></html>`;

const LOGIN_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Acceso privado | Gestión de Visas Zaragoza</title><style>
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap');*{box-sizing:border-box}body{min-height:100vh;margin:0;padding:24px;display:grid;place-items:center;color:#102a43;background:#f3f6f9;font:400 16px/1.5 Manrope,Arial,sans-serif}.card{width:min(460px,100%);padding:clamp(28px,7vw,52px);background:#fff;border-top:5px solid #285a5a;box-shadow:0 28px 70px #102a431a}.mark{width:54px;height:54px;margin-bottom:28px;display:grid;place-items:center;color:#fff;background:#102a43;border-radius:50%;font-weight:700}h1{margin:0 0 12px;font-size:clamp(2rem,8vw,3.5rem);line-height:1;letter-spacing:-.05em}p{margin:0 0 28px;color:#607085}label{display:grid;gap:8px;margin:0 0 18px;font-size:.82rem;font-weight:600}input{width:100%;min-height:52px;padding:13px 15px;color:#102a43;background:#fff;border:1px solid #cad5df;border-radius:9px;font:inherit}input:focus{outline:3px solid #285a5a33;border-color:#285a5a}button{width:100%;min-height:54px;margin-top:8px;color:#fff;background:#285a5a;border:0;border-radius:999px;font:600 1rem Manrope,Arial,sans-serif;cursor:pointer}.error{margin:18px 0 0;color:#a33a32;font-weight:600}.note{margin:22px 0 0;font-size:.78rem}</style></head><body><main class="card"><div class="mark">GV</div><h1>Panel privado</h1><p>Ingresa con el correo autorizado y tu contraseña.</p><form method="post" action="/panel/login"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">Entrar al panel</button></form>{{ERROR}}<p class="note">La sesión se cerrará automáticamente después de 8 horas.</p></main></body></html>`;

function panelHtml(body, status = 200, extraHeaders = {}) {
    return new Response(body, { status, headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        ...extraHeaders
    } });
}

async function login(request, env) {
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > 4096) return panelHtml(LOGIN_HTML.replace('{{ERROR}}', '<p class="error">Datos no válidos.</p>'), 400);
    const form = await request.formData();
    const email = clean(form.get('email'), 254).toLowerCase();
    const password = String(form.get('password') || '').slice(0, 200);
    let credentials = {};
    try { credentials = JSON.parse(env.ADMIN_CREDENTIALS || '{}'); } catch { /* configuración inválida */ }
    const isValid = credentials[email] && await verifyPassword(password, credentials[email]);
    if (!isValid) return panelHtml(LOGIN_HTML.replace('{{ERROR}}', '<p class="error">Correo o contraseña incorrectos.</p>'), 401);
    const session = await createSession(email, env);
    return new Response(null, { status: 303, headers: {
        Location: '/panel/',
        'Set-Cookie': `${SESSION_COOKIE}=${session}; Path=/panel; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
        'Cache-Control': 'no-store'
    } });
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        try {
            if (request.method === 'OPTIONS' && url.pathname === '/api/appointments') {
                const headers = corsHeaders(request, env);
                return new Response(null, { status: headers['Access-Control-Allow-Origin'] ? 204 : 403, headers });
            }
            if (request.method === 'POST' && url.pathname === '/api/appointments') return await createAppointment(request, env);
            if (request.method === 'POST' && url.pathname === '/panel/login') return await login(request, env);
            if (request.method === 'POST' && url.pathname === '/panel/logout') {
                return new Response(null, { status: 303, headers: { Location: '/panel/', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/panel; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, 'Cache-Control': 'no-store' } });
            }
            if (url.pathname.startsWith('/panel')) {
                const email = await getSessionEmail(request, env);
                if (!email) return panelHtml(LOGIN_HTML.replace('{{ERROR}}', ''));
            }
            if (request.method === 'GET' && url.pathname === '/panel/api/appointments') return await listAppointments(env);
            if (request.method === 'GET' && (url.pathname === '/panel' || url.pathname === '/panel/')) return panelHtml(ADMIN_HTML);
            return json({ ok: false, error: 'Ruta no encontrada.' }, 404);
        } catch (error) {
            console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, message: error instanceof Error ? error.message : 'Unknown error' }));
            if (url.pathname === '/api/appointments') {
                return json({ ok: false, error: 'No fue posible registrar la solicitud.' }, 500, corsHeaders(request, env));
            }
            return panelHtml(LOGIN_HTML.replace('{{ERROR}}', '<p class="error">El servicio no está disponible en este momento.</p>'), 500);
        }
    }
};
