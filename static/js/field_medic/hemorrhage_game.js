/**
 * Fase 1: Minijuego de Control de Hemorragia
 * Mecánica táctica de precisión temporal directamente sobre la pantalla táctil.
 * El sanitario pulsa sobre el círculo central en el momento en que el marcador cruza la zona verde.
 */
class HemorrhageGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        const raw = config || {};
        this.config = {
            velocidad_marcador_ms: Number(raw.velocidad_marcador_ms) || 1600,
            ancho_zona_objetivo_pct: Number(raw.ancho_zona_objetivo_pct) || 22.0,
            aciertos_requeridos: Number(raw.aciertos_requeridos) || 4,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 15.0,
            progreso_por_acierto_pct: Number(raw.progreso_por_acierto_pct) || 25.0,
            tiempo_limite_segundos: Number(raw.tiempo_limite_segundos) || 60,
            decay_pasivo_por_segundo_pct: Number(raw.decay_pasivo_por_segundo_pct) || 1.0
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0 a 100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedGameTime = 0;
        this.pulseTime = 0;
        this.tapRippleTime = 0;
        this.lastTapSuccess = false;

        // Marcador oscilante: 0% a 100%
        this.markerPos = 0; // 0..1
        this.markerDir = 1;

        // Zona objetivo (centro aleatorio o dinámico)
        this.targetWidth = this.config.ancho_zona_objetivo_pct / 100;
        this.targetStart = 0.5 - (this.targetWidth / 2);
        this.targetEnd = 0.5 + (this.targetWidth / 2);

        this.consecutiveErrors = 0;
        this.hitStreak = 0;
        this.feedbackText = "TOCA EL CÍRCULO CENTRAL CUANDO LA AGUJA CRUCE LA ZONA VERDE";
        this.feedbackColor = "#888";
        this.feedbackTimer = 0;

        this.attachEvents();
    }

    attachEvents() {
        if (this._eventsAttached) return;
        this._eventsAttached = true;

        this.canvas.style.touchAction = 'none';
        this.canvas.style.cursor = 'pointer';

        this.canvas.addEventListener('pointerdown', (e) => {
            if (!this.isRunning) return;
            if (e && e.cancelable) e.preventDefault();
            this.triggerTap();
        });

        window.addEventListener('resize', () => {
            if (this.isRunning) this.setupHiDPI();
        });
    }

    setupHiDPI() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width > 0 ? rect.width : 360;
        const cssH = 190;
        
        this.w = cssW;
        this.h = cssH;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.isRunning = true;
        this.lastTime = performance.now();
        this.repositionTarget();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    repositionTarget() {
        const margin = 0.12;
        const available = 1 - (2 * margin) - this.targetWidth;
        this.targetStart = margin + (Math.random() * available);
        this.targetEnd = this.targetStart + this.targetWidth;
    }

    triggerTap() {
        if (!this.isRunning) return;

        this.tapRippleTime = 0.35; // Animación de onda

        // Verificar si el marcador está dentro de la zona objetivo
        const isHit = (this.markerPos >= this.targetStart && this.markerPos <= this.targetEnd);
        this.lastTapSuccess = isHit;

        if (isHit) {
            this.hitStreak++;
            this.consecutiveErrors = 0;
            this.progress = Math.min(100, this.progress + this.config.progreso_por_acierto_pct);

            this.showFeedback("¡PRECISIÓN! PRESIÓN EFECTIVA", "#2ecc71");
            this.repositionTarget();

            this.onProgressUpdate(this.progress, { hit: true, streak: this.hitStreak });

            if (this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedGameTime });
            }
        } else {
            this.hitStreak = 0;
            this.consecutiveErrors++;

            const penalty = this.config.penalizacion_por_error_pct + (this.consecutiveErrors > 1 ? 5 : 0);
            this.progress = Math.max(0, this.progress - penalty);

            this.showFeedback("¡DESFASE! HEMORRAGIA ACTIVA", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false, errors: this.consecutiveErrors });
        }
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 1.0;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
        this.lastTime = timestamp;
        this.elapsedGameTime += delta;
        this.pulseTime += delta;

        if (this.tapRippleTime > 0) {
            this.tapRippleTime -= delta;
        }

        // Decay pasivo leve si la hemorragia está desatendida
        if (this.config.decay_pasivo_por_segundo_pct > 0 && this.progress > 0) {
            this.progress = Math.max(0, this.progress - (this.config.decay_pasivo_por_segundo_pct * delta));
            this.onProgressUpdate(this.progress, { passive: true });
        }

        // Mover marcador
        const speed = 1 / (this.config.velocidad_marcador_ms / 1000);
        this.markerPos += this.markerDir * speed * delta;

        if (this.markerPos >= 1) {
            this.markerPos = 1;
            this.markerDir = -1;
        } else if (this.markerPos <= 0) {
            this.markerPos = 0;
            this.markerDir = 1;
        }

        if (this.feedbackTimer > 0) {
            this.feedbackTimer -= delta;
        }

        this.draw();
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    draw() {
        const w = this.w || this.canvas.clientWidth || 360;
        const h = this.h || 190;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo HUD táctico ORBAT
        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, w, h);

        // Rejilla técnica sutil
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // ==================== 1. RIEL DE PRECISIÓN TEMPORAL ====================
        const trackY = 22;
        const trackH = 22;
        const trackMargin = 16;
        const trackW = w - (2 * trackMargin);

        // Fondo del riel
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.fillRect(trackMargin, trackY, trackW, trackH);
        ctx.strokeRect(trackMargin, trackY, trackW, trackH);

        // Zona Objetivo (Sweet Spot verde táctico)
        const targetX1 = trackMargin + (this.targetStart * trackW);
        const targetW_px = this.targetWidth * trackW;
        ctx.fillStyle = "rgba(46, 204, 113, 0.35)";
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = 1.5;
        ctx.fillRect(targetX1, trackY + 1, targetW_px, trackH - 2);
        ctx.strokeRect(targetX1, trackY + 1, targetW_px, trackH - 2);

        // Marcador móvil (Aguja dorada / cian)
        const markerX = trackMargin + (this.markerPos * trackW);
        const isCurrentlyInside = (this.markerPos >= this.targetStart && this.markerPos <= this.targetEnd);
        ctx.fillStyle = isCurrentlyInside ? "#2ecc71" : "#e2b938";
        ctx.fillRect(markerX - 3, trackY - 6, 6, trackH + 12);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(markerX - 3, trackY - 6, 6, trackH + 12);

        // ==================== 2. CÍRCULO SUTIL TÁCTICO DE PULSACIÓN ====================
        const centerX = w / 2;
        const centerY = h * 0.64;
        const circleRadius = 36;

        // Pulso sutil de atención
        const pulse = (Math.sin(this.pulseTime * 3.5) + 1) * 0.12;
        let strokeCol = isCurrentlyInside ? `rgba(46, 204, 113, ${0.5 + pulse})` : `rgba(255, 51, 68, ${0.3 + pulse})`;
        let fillCol = isCurrentlyInside ? "rgba(46, 204, 113, 0.12)" : "rgba(0, 0, 0, 0.5)";

        // Círculo central base
        ctx.beginPath();
        ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
        ctx.fillStyle = fillCol;
        ctx.fill();
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Miras / Cruces en los 4 ejes
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1;
        const markLen = 6;
        ctx.beginPath(); ctx.moveTo(centerX, centerY - circleRadius - markLen); ctx.lineTo(centerX, centerY - circleRadius + 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(centerX, centerY + circleRadius - 2); ctx.lineTo(centerX, centerY + circleRadius + markLen); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(centerX + circleRadius - 2, centerY); ctx.lineTo(centerX + circleRadius + markLen, centerY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(centerX - circleRadius - markLen, centerY); ctx.lineTo(centerX - circleRadius + 2, centerY); ctx.stroke();

        // Onda táctica al pulsar
        if (this.tapRippleTime > 0) {
            const rippleR = circleRadius + ((0.35 - this.tapRippleTime) * 60);
            ctx.strokeStyle = this.lastTapSuccess ? "rgba(46, 204, 113, 0.8)" : "rgba(255, 51, 68, 0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, rippleR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Textos del botón táctico de pantalla
        ctx.textAlign = "center";
        ctx.fillStyle = isCurrentlyInside ? "#2ecc71" : "#fff";
        ctx.font = "bold 11px 'Orbitron', monospace";
        ctx.fillText("TOCAR AQUÍ", centerX, centerY - 2);

        ctx.fillStyle = isCurrentlyInside ? "#2ecc71" : "#888";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.fillText("PRESIÓN TÁCTICA", centerX, centerY + 12);

        // Feedback Text
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillText(this.feedbackText, centerX, h - 8);
    }
}

window.HemorrhageGame = HemorrhageGame;

