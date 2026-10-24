/**
 * TVC-ORBAT - Sistema de Alertas Globales de Evento y Banner Permanente
 * Control de Inicio de Operaciones, Fin de Evento, Pausas Tácticas y Directivas de Mando
 */

(function() {
    'use strict';

    if (window.__orbatEventoAlertaLoaded) return;
    window.__orbatEventoAlertaLoaded = true;

    // Configuración
    const POLL_INTERVAL_MS = 6000;
    let pollTimer = null;
    let lastActualizadoEn = sessionStorage.getItem('orbat_evento_last_ts') || '';
    let isCollapsed = localStorage.getItem('orbat_evento_banner_collapsed') === 'true';

    // Generar estilos CSS tácticos embebidos
    function injectStyles() {
        if (document.getElementById('orbat-evento-alerta-styles')) return;
        const style = document.createElement('style');
        style.id = 'orbat-evento-alerta-styles';
        style.textContent = `
            /* =========================================================
               BANNER PERMANENTE SUPERIOR TÁCTICO
               ========================================================= */
            .orbat-global-banner-wrapper {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 99990;
                font-family: 'Rajdhani', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                pointer-events: none;
                transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease;
                box-shadow: 0 4px 25px rgba(0,0,0,0.85);
            }

            .orbat-global-banner {
                pointer-events: auto;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 16px;
                min-height: 44px;
                color: #ffffff;
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                border-bottom: 2px solid rgba(255, 255, 255, 0.2);
                gap: 12px;
                box-sizing: border-box;
                position: relative;
                overflow: hidden;
            }

            /* Rayas tácticas de fondo sutiles */
            .orbat-global-banner::before {
                content: '';
                position: absolute;
                top: 0; left: 0; right: 0; bottom: 0;
                background-image: repeating-linear-gradient(
                    -45deg,
                    rgba(255, 255, 255, 0.03),
                    rgba(255, 255, 255, 0.03) 10px,
                    transparent 10px,
                    transparent 20px
                );
                pointer-events: none;
            }

            /* Variaciones por nivel */
            .orbat-global-banner.nivel-success {
                background: linear-gradient(90deg, rgba(10, 36, 22, 0.96) 0%, rgba(13, 28, 20, 0.94) 100%);
                border-bottom-color: #00ff88;
                border-left: 5px solid #00ff88;
            }
            .orbat-global-banner.nivel-danger {
                background: linear-gradient(90deg, rgba(46, 12, 16, 0.97) 0%, rgba(30, 8, 12, 0.95) 100%);
                border-bottom-color: #ff3344;
                border-left: 5px solid #ff3344;
            }
            .orbat-global-banner.nivel-warning {
                background: linear-gradient(90deg, rgba(42, 30, 8, 0.96) 0%, rgba(28, 20, 6, 0.94) 100%);
                border-bottom-color: #f59e0b;
                border-left: 5px solid #f59e0b;
            }
            .orbat-global-banner.nivel-info {
                background: linear-gradient(90deg, rgba(8, 26, 42, 0.96) 0%, rgba(6, 18, 30, 0.94) 100%);
                border-bottom-color: #00d2ff;
                border-left: 5px solid #00d2ff;
            }

            /* Baliza parpadeante */
            .orbat-banner-beacon {
                width: 12px;
                height: 12px;
                border-radius: 50%;
                display: inline-block;
                flex-shrink: 0;
                box-shadow: 0 0 10px currentColor;
                animation: orbatBeaconPulse 1.4s infinite ease-in-out;
            }
            @keyframes orbatBeaconPulse {
                0% { opacity: 0.4; transform: scale(0.9); }
                50% { opacity: 1; transform: scale(1.15); }
                100% { opacity: 0.4; transform: scale(0.9); }
            }

            .nivel-success .orbat-banner-beacon { background: #00ff88; color: #00ff88; }
            .nivel-danger .orbat-banner-beacon { background: #ff3344; color: #ff3344; }
            .nivel-warning .orbat-banner-beacon { background: #f59e0b; color: #f59e0b; }
            .nivel-info .orbat-banner-beacon { background: #00d2ff; color: #00d2ff; }

            .orbat-banner-badge {
                font-family: 'Orbitron', monospace;
                font-size: 0.75rem;
                font-weight: 800;
                padding: 3px 8px;
                border-radius: 3px;
                letter-spacing: 1px;
                text-transform: uppercase;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .nivel-success .orbat-banner-badge { background: rgba(0, 255, 136, 0.2); color: #00ff88; border: 1px solid rgba(0, 255, 136, 0.4); }
            .nivel-danger .orbat-banner-badge { background: rgba(255, 51, 68, 0.25); color: #ff5566; border: 1px solid rgba(255, 51, 68, 0.5); }
            .nivel-warning .orbat-banner-badge { background: rgba(245, 158, 11, 0.25); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.5); }
            .nivel-info .orbat-banner-badge { background: rgba(0, 210, 255, 0.2); color: #00d2ff; border: 1px solid rgba(0, 210, 255, 0.4); }

            .orbat-banner-content {
                display: flex;
                align-items: center;
                gap: 10px;
                flex: 1;
                overflow: hidden;
            }

            .orbat-banner-text-group {
                display: flex;
                flex-direction: column;
                min-width: 0;
            }

            .orbat-banner-title {
                font-family: 'Orbitron', monospace;
                font-size: 0.85rem;
                font-weight: 700;
                letter-spacing: 0.8px;
                color: #ffffff;
                text-transform: uppercase;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .orbat-banner-desc {
                font-size: 0.82rem;
                color: #cbd5e1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1.25;
            }

            .orbat-banner-actions {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }

            .orbat-banner-btn {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: #cbd5e1;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.72rem;
                font-family: 'Rajdhani', sans-serif;
                font-weight: 600;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            .orbat-banner-btn:hover {
                background: rgba(255, 255, 255, 0.16);
                color: #ffffff;
            }

            /* Badge flotante cuando el banner está contraído */
            .orbat-banner-mini-pill {
                position: fixed;
                top: 8px;
                right: 12px;
                z-index: 99991;
                cursor: pointer;
                padding: 4px 10px;
                border-radius: 20px;
                display: none;
                align-items: center;
                gap: 6px;
                backdrop-filter: blur(8px);
                font-family: 'Orbitron', monospace;
                font-size: 0.72rem;
                font-weight: 700;
                box-shadow: 0 4px 15px rgba(0,0,0,0.6);
                transition: transform 0.2s ease;
            }
            .orbat-banner-mini-pill:hover {
                transform: scale(1.05);
            }
            .orbat-banner-mini-pill.nivel-success { background: rgba(10, 36, 22, 0.95); border: 1px solid #00ff88; color: #00ff88; }
            .orbat-banner-mini-pill.nivel-danger { background: rgba(46, 12, 16, 0.95); border: 1px solid #ff3344; color: #ff5566; }
            .orbat-banner-mini-pill.nivel-warning { background: rgba(42, 30, 8, 0.95); border: 1px solid #f59e0b; color: #fbbf24; }
            .orbat-banner-mini-pill.nivel-info { background: rgba(8, 26, 42, 0.95); border: 1px solid #00d2ff; color: #00d2ff; }

            /* =========================================================
               FLASH MODAL OVERLAY (IMPACTO INICIAL DE TRANSMISIÓN)
               ========================================================= */
            .orbat-flash-overlay {
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.85);
                backdrop-filter: blur(8px);
                z-index: 99999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.3s ease;
            }
            .orbat-flash-overlay.active {
                opacity: 1;
                pointer-events: auto;
            }

            .orbat-flash-card {
                background: #090e17;
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 8px;
                max-width: 520px;
                width: 100%;
                padding: 24px 22px;
                position: relative;
                box-shadow: 0 0 50px rgba(0,0,0,0.9), 0 0 20px currentColor;
                transform: scale(0.92);
                transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
                color: #ffffff;
                text-align: center;
                overflow: hidden;
            }
            .orbat-flash-overlay.active .orbat-flash-card {
                transform: scale(1);
            }

            /* Brackets tácticos en esquinas */
            .orbat-flash-card::before, .orbat-flash-card::after {
                content: '';
                position: absolute;
                width: 16px;
                height: 16px;
                pointer-events: none;
            }
            .orbat-flash-card::before {
                top: 8px; left: 8px;
                border-top: 3px solid currentColor;
                border-left: 3px solid currentColor;
            }
            .orbat-flash-card::after {
                bottom: 8px; right: 8px;
                border-bottom: 3px solid currentColor;
                border-right: 3px solid currentColor;
            }

            .orbat-flash-card.nivel-success { border-color: #00ff88; color: #00ff88; }
            .orbat-flash-card.nivel-danger { border-color: #ff3344; color: #ff3344; }
            .orbat-flash-card.nivel-warning { border-color: #f59e0b; color: #f59e0b; }
            .orbat-flash-card.nivel-info { border-color: #00d2ff; color: #00d2ff; }

            .orbat-flash-tag {
                font-family: 'Orbitron', monospace;
                font-size: 0.76rem;
                font-weight: 700;
                letter-spacing: 2px;
                text-transform: uppercase;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
            }

            .orbat-flash-title {
                font-family: 'Orbitron', monospace;
                font-size: 1.45rem;
                font-weight: 900;
                letter-spacing: 1px;
                margin: 0 0 14px 0;
                color: #ffffff;
                text-transform: uppercase;
                line-height: 1.25;
            }

            .orbat-flash-message {
                font-size: 1.05rem;
                color: #e2e8f0;
                line-height: 1.5;
                margin-bottom: 22px;
                font-family: 'Rajdhani', sans-serif;
                font-weight: 500;
                background: rgba(255, 255, 255, 0.04);
                padding: 12px 14px;
                border-radius: 4px;
                border-left: 3px solid currentColor;
            }

            .orbat-flash-btn {
                background: currentColor;
                color: #000000;
                border: none;
                padding: 10px 24px;
                font-family: 'Orbitron', monospace;
                font-size: 0.88rem;
                font-weight: 800;
                letter-spacing: 1.2px;
                border-radius: 4px;
                cursor: pointer;
                transition: transform 0.15s ease, filter 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .orbat-flash-btn:hover {
                filter: brightness(1.15);
                transform: translateY(-1px);
            }

            /* Responsive para pantallas móviles */
            @media (max-width: 768px) {
                .orbat-global-banner {
                    padding: 6px 10px;
                    min-height: 40px;
                    gap: 8px;
                }
                .orbat-banner-badge {
                    font-size: 0.68rem;
                    padding: 2px 6px;
                }
                .orbat-banner-title {
                    font-size: 0.78rem;
                }
                .orbat-banner-desc {
                    font-size: 0.74rem;
                }
                .orbat-flash-title {
                    font-size: 1.2rem;
                }
                .orbat-flash-message {
                    font-size: 0.95rem;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Tono táctico de radio/alerta mediante Web Audio API
    function playTacticalChirp(nivel) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();

            // Desbloquear si está suspendido
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {});
            }

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = (nivel === 'danger') ? 'sawtooth' : 'sine';

            // Frecuencias según severidad
            if (nivel === 'danger') {
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
                osc.frequency.setValueAtTime(440, now + 0.22);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.34);
            } else if (nivel === 'warning') {
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.setValueAtTime(750, now + 0.15);
            } else {
                // Éxito / Inicio
                osc.frequency.setValueAtTime(660, now);
                osc.frequency.exponentialRampToValueAtTime(990, now + 0.18);
            }

            gain.gain.setValueAtTime(0.01, now);
            gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
            gain.gain.linearRampToValueAtTime(0.001, now + 0.45);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now);
            osc.stop(now + 0.5);
        } catch (e) {
            // Autoplay bloqueado por el navegador o sin interacción previa
        }
    }

    // Crear elementos DOM del banner y del flash si no existen
    function ensureDOMElements() {
        injectStyles();

        // 1. Wrapper del banner superior
        let bannerWrap = document.getElementById('orbat-global-banner-wrapper');
        if (!bannerWrap) {
            bannerWrap = document.createElement('div');
            bannerWrap.id = 'orbat-global-banner-wrapper';
            bannerWrap.className = 'orbat-global-banner-wrapper';
            bannerWrap.style.transform = 'translateY(-100%)';
            bannerWrap.style.opacity = '0';
            bannerWrap.innerHTML = `
                <div id="orbat-global-banner" class="orbat-global-banner nivel-info">
                    <div class="orbat-banner-content">
                        <span class="orbat-banner-beacon"></span>
                        <span id="orbat-banner-badge" class="orbat-banner-badge">ORDEN HQ</span>
                        <div class="orbat-banner-text-group">
                            <span id="orbat-banner-title" class="orbat-banner-title">TRANSMISIÓN DE MANDO</span>
                            <span id="orbat-banner-desc" class="orbat-banner-desc">--</span>
                        </div>
                    </div>
                    <div class="orbat-banner-actions">
                        <button type="button" class="orbat-banner-btn" id="orbat-banner-collapse-btn" title="Minimizar banner">
                            <span class="material-symbols-outlined" style="font-size: 16px;">keyboard_arrow_up</span>
                        </button>
                    </div>
                </div>
            `;
            document.body.prepend(bannerWrap);

            document.getElementById('orbat-banner-collapse-btn').addEventListener('click', () => {
                toggleCollapse(true);
            });
        }

        // 2. Mini Pill (botón flotante cuando está colapsado)
        let miniPill = document.getElementById('orbat-banner-mini-pill');
        if (!miniPill) {
            miniPill = document.createElement('div');
            miniPill.id = 'orbat-banner-mini-pill';
            miniPill.className = 'orbat-banner-mini-pill nivel-info';
            miniPill.innerHTML = `
                <span class="orbat-banner-beacon"></span>
                <span id="orbat-mini-pill-text">EN CURSO</span>
            `;
            miniPill.addEventListener('click', () => {
                toggleCollapse(false);
            });
            document.body.appendChild(miniPill);
        }

        // 3. Overlay Flash Emergente
        let flashOverlay = document.getElementById('orbat-flash-overlay');
        if (!flashOverlay) {
            flashOverlay = document.createElement('div');
            flashOverlay.id = 'orbat-flash-overlay';
            flashOverlay.className = 'orbat-flash-overlay';
            flashOverlay.innerHTML = `
                <div id="orbat-flash-card" class="orbat-flash-card nivel-info">
                    <div class="orbat-flash-tag">
                        <span class="material-symbols-outlined" style="font-size: 18px;">crisis_alert</span>
                        <span id="orbat-flash-tag-text">TRANSMISIÓN DE DIRECCIÓN // HORA H</span>
                    </div>
                    <h2 id="orbat-flash-title" class="orbat-flash-title">COMUNICADO OFICIAL</h2>
                    <div id="orbat-flash-message" class="orbat-flash-message">Mensaje de prueba</div>
                    <div>
                        <button type="button" id="orbat-flash-confirm-btn" class="orbat-flash-btn">
                            <span class="material-symbols-outlined" style="font-size: 18px;">check_circle</span>
                            RECIBIDO / ENTERADO
                        </button>
                    </div>
                </div>
            `;
            document.body.appendChild(flashOverlay);

            document.getElementById('orbat-flash-confirm-btn').addEventListener('click', () => {
                flashOverlay.classList.remove('active');
            });
        }
    }

    // Alternar modo contraído (mini-pill vs banner completo)
    function toggleCollapse(collapsed) {
        isCollapsed = collapsed;
        localStorage.setItem('orbat_evento_banner_collapsed', isCollapsed ? 'true' : 'false');
        
        const bannerWrap = document.getElementById('orbat-global-banner-wrapper');
        const miniPill = document.getElementById('orbat-banner-mini-pill');
        if (!bannerWrap || !miniPill) return;

        if (isCollapsed) {
            bannerWrap.style.transform = 'translateY(-100%)';
            miniPill.style.display = 'inline-flex';
            adjustBodyPadding(0);
        } else {
            bannerWrap.style.transform = 'translateY(0)';
            miniPill.style.display = 'none';
            adjustBodyPadding(bannerWrap.offsetHeight || 44);
        }
    }

    // Ajustar padding superior del documento para no solapar la barra fija
    function adjustBodyPadding(px) {
        // En index.html ajustamos el layout principal o top-bar
        const topBar = document.querySelector('.top-bar');
        const appLayout = document.querySelector('.app-layout');
        const mapTopBar = document.querySelector('.map-topbar');

        if (px > 0) {
            if (topBar) topBar.style.marginTop = px + 'px';
            if (mapTopBar) mapTopBar.style.top = (px + 10) + 'px';
            if (!topBar && !mapTopBar) document.body.style.paddingTop = px + 'px';
        } else {
            if (topBar) topBar.style.marginTop = '';
            if (mapTopBar) mapTopBar.style.top = '';
            if (!topBar && !mapTopBar) document.body.style.paddingTop = '';
        }
    }

    // Disparar el modal Flash impactante
    function triggerFlashAlert(data) {
        const overlay = document.getElementById('orbat-flash-overlay');
        const card = document.getElementById('orbat-flash-card');
        const titleEl = document.getElementById('orbat-flash-title');
        const msgEl = document.getElementById('orbat-flash-message');
        const tagEl = document.getElementById('orbat-flash-tag-text');

        if (!overlay || !card) return;

        // Reset clases de nivel
        card.className = 'orbat-flash-card nivel-' + (data.nivel || 'info');
        
        let tagText = 'DIRECTIVA DE DIRECCIÓN';
        if (data.estado === 'EN_CURSO') tagText = 'INICIO DE OPERACIONES // HORA H';
        else if (data.estado === 'PAUSADO') tagText = 'ALTO EL FUEGO // PAUSA TÁCTICA';
        else if (data.estado === 'FINALIZADO') tagText = 'FIN DEL EVENTO // DESMOVILIZACIÓN';

        tagEl.textContent = tagText;
        titleEl.textContent = data.titulo || (data.estado ? data.estado.replace('_', ' ') : 'COMUNICADO');
        msgEl.textContent = data.mensaje || 'Nueva directiva emitida por Mando.';

        overlay.classList.add('active');
        playTacticalChirp(data.nivel);

        // Auto-cerrar el flash tras 6.5 segundos si el usuario no clica
        clearTimeout(window.__orbatFlashTimeout);
        window.__orbatFlashTimeout = setTimeout(() => {
            overlay.classList.remove('active');
        }, 6500);
    }

    // Renderizar datos recibidos del servidor
    function renderAlerta(data) {
        ensureDOMElements();

        const bannerWrap = document.getElementById('orbat-global-banner-wrapper');
        const bannerEl = document.getElementById('orbat-global-banner');
        const badgeEl = document.getElementById('orbat-banner-badge');
        const titleEl = document.getElementById('orbat-banner-title');
        const descEl = document.getElementById('orbat-banner-desc');
        const miniPill = document.getElementById('orbat-banner-mini-pill');
        const miniText = document.getElementById('orbat-mini-pill-text');

        if (!data || !data.activo) {
            // Ocultar banner si no está activo
            if (bannerWrap) {
                bannerWrap.style.transform = 'translateY(-100%)';
                bannerWrap.style.opacity = '0';
            }
            if (miniPill) miniPill.style.display = 'none';
            adjustBodyPadding(0);
            return;
        }

        // Determinar badge según estado
        let badgeLabel = 'ORDEN MANDO';
        if (data.estado === 'EN_CURSO') badgeLabel = 'OPERACIONES ACTIVAS';
        else if (data.estado === 'PAUSADO') badgeLabel = 'ALTO EL FUEGO';
        else if (data.estado === 'FINALIZADO') badgeLabel = 'FIN DEL EVENTO';
        else if (data.estado === 'PRE_EVENTO') badgeLabel = 'PREPARACIÓN';

        // Asignar clases de color
        const nivel = data.nivel || 'info';
        bannerEl.className = 'orbat-global-banner nivel-' + nivel;
        miniPill.className = 'orbat-banner-mini-pill nivel-' + nivel;

        badgeEl.textContent = badgeLabel;
        titleEl.textContent = data.titulo || badgeLabel;
        descEl.textContent = data.mensaje || '';
        miniText.textContent = badgeLabel;

        // Comprobar si es una nueva alerta o cambio de timestamp para disparar Flash
        const currentTs = data.actualizado_en || '';
        if (lastActualizadoEn && currentTs && lastActualizadoEn !== currentTs) {
            // Cambio de estado en vivo -> activar Flash Overlay y descolapsar banner
            isCollapsed = false;
            localStorage.setItem('orbat_evento_banner_collapsed', 'false');
            triggerFlashAlert(data);
        } else if (!lastActualizadoEn && currentTs) {
            // Primera carga: si es crítico (ej. FINALIZADO o ALTO EL FUEGO), disparar flash suave
            if (data.estado === 'FINALIZADO' || data.estado === 'PAUSADO') {
                triggerFlashAlert(data);
            }
        }

        lastActualizadoEn = currentTs;
        if (currentTs) sessionStorage.setItem('orbat_evento_last_ts', currentTs);

        // Mostrar u ocultar banner según colapso
        if (isCollapsed) {
            bannerWrap.style.transform = 'translateY(-100%)';
            miniPill.style.display = 'inline-flex';
            adjustBodyPadding(0);
        } else {
            bannerWrap.style.transform = 'translateY(0)';
            bannerWrap.style.opacity = '1';
            miniPill.style.display = 'none';
            setTimeout(() => {
                adjustBodyPadding(bannerWrap.offsetHeight || 44);
            }, 50);
        }
    }

    // Función de consulta (Polling)
    async function checkEventoAlerta() {
        try {
            const res = await fetch('/api/evento/alerta', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                renderAlerta(data);
            }
        } catch (err) {
            // Ignorar errores de red silenciosamente para no interrumpir al usuario
        }
    }

    // Inicialización al cargar la página
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureDOMElements();
            checkEventoAlerta();
            pollTimer = setInterval(checkEventoAlerta, POLL_INTERVAL_MS);
        });
    } else {
        ensureDOMElements();
        checkEventoAlerta();
        pollTimer = setInterval(checkEventoAlerta, POLL_INTERVAL_MS);
    }

    // Exponer helper global para invocar recarga manual si el admin emite un cambio
    window.refreshOrbatEventoAlerta = checkEventoAlerta;

})();
