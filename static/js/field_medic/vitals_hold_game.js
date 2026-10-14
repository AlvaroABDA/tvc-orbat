/**
 * Fase 2 - Variante B: Mantener Constantes en Rango
 * Control de estabilidad hemodinámica con indicador oscilante continuo.
 * El sanitario debe pulsar cuando el indicador entra en la zona verde para encadenar aciertos consecutivos.
 */
class VitalsHoldGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            velocidad_marcador_ms: Number(raw.velocidad_marcador_ms) || 1500,
            ancho_zona_pct: Number(raw.ancho_zona_pct) || 25.0,
            aciertos_consecutivos_requeridos: Number(raw.aciertos_consecutivos_requeridos) || 5,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 20.0,
            tiempo_limite_segundos: Number(raw.tiempo_limite_segundos) || 50
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0..100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedTime = 0;
        this.pulseTime = 0;

        // Estado del oscilador continuo
        this.markerPos = 0.5; // 0..1
        this.markerSpeed = 1 / (this.config.velocidad_marcador_ms / 1000);
        this.markerDir = 1;

        // Zona objetivo verde
        this.targetWidth = this.config.ancho_zona_pct / 100;
        this.targetStart = 0.5 - (this.targetWidth / 2);
        this.targetEnd = 0.5 + (this.targetWidth / 2);

        this.streak = 0;
        this.tapRippleTime = 0;
        this.lastTapSuccess = false;

        this.feedbackText = "TOCA CUANDO EL INDICADOR OSCILANTE CRUCE LA ZONA VERDE";
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
        const cssH = 210;

        this.w = cssW;
        this.h = cssH;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    repositionTarget() {
        const margin = 0.12;
        const available = 1 - (2 * margin) - this.targetWidth;
        this.targetStart = margin + (Math.random() * available);
        this.targetEnd = this.targetStart + this.targetWidth;
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.streak = Math.round((this.progress / 100) * this.config.aciertos_consecutivos_requeridos);
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

    triggerTap() {
        if (!this.isRunning) return;

        this.tapRippleTime = 0.4;
        const inZone = (this.markerPos >= this.targetStart && this.markerPos <= this.targetEnd);
        this.lastTapSuccess = inZone;

        if (inZone) {
            this.streak++;
            this.progress = Math.min(100, (this.streak / this.config.aciertos_consecutivos_requeridos) * 100);
            this.showFeedback(`¡CONSTANTE ESTABILIZADA! RACHA: [${this.streak}/${this.config.aciertos_consecutivos_requeridos}]`, "#2ecc71");
            this.repositionTarget(); // Cambiar zona tras acierto para dinámica continua

            this.onProgressUpdate(this.progress, { hit: true, streak: this.streak });

            if (this.streak >= this.config.aciertos_consecutivos_requeridos || this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
            }
        } else {
            this.streak = 0;
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.showFeedback("¡DESESTABILIZACIÓN! RACHA INTERRUMPIDA", "#ff3344");
            this.repositionTarget();
            this.onProgressUpdate(this.progress, { hit: false, streak: 0 });
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
        this.elapsedTime += delta;
        this.pulseTime += delta;

        if (this.tapRippleTime > 0) this.tapRippleTime -= delta;
        if (this.feedbackTimer > 0) this.feedbackTimer -= delta;

        // Desplazamiento continuo del oscilador
        this.markerPos += this.markerDir * this.markerSpeed * delta;
        if (this.markerPos >= 1) {
            this.markerPos = 1;
            this.markerDir = -1;
        } else if (this.markerPos <= 0) {
            this.markerPos = 0;
            this.markerDir = 1;
        }

        this.draw();
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    draw() {
        const w = this.w || this.canvas.clientWidth || 360;
        const h = this.h || 210;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo HUD táctico ORBAT
        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, w, h);

        // Rejilla técnica de fondo
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Telemetría superior
        const inZone = (this.markerPos >= this.targetStart && this.markerPos <= this.targetEnd);
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(`PRESIÓN ARTERIAL MEDIA // ESTABILIDAD`, 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = inZone ? "#2ecc71" : "#e2b938";
        ctx.fillText(`RACHA: ${this.streak} / ${this.config.aciertos_consecutivos_requeridos}`, w - 12, 16);

        // ==================== 1. BARRA HORIZONTAL DEL OSCILADOR ====================
        const trackY = 28;
        const trackH = 24;
        const trackMargin = 16;
        const trackW = w - (2 * trackMargin);

        // Fondo del riel
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.fillRect(trackMargin, trackY, trackW, trackH);
        ctx.strokeRect(trackMargin, trackY, trackW, trackH);

        // Zona Objetivo Verde
        const targetX1 = trackMargin + (this.targetStart * trackW);
        const targetW_px = this.targetWidth * trackW;
        ctx.fillStyle = "rgba(46, 204, 113, 0.35)";
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = 1.5;
        ctx.fillRect(targetX1, trackY + 1, targetW_px, trackH - 2);
        ctx.strokeRect(targetX1, trackY + 1, targetW_px, trackH - 2);

        // Marcador móvil
        const markerX = trackMargin + (this.markerPos * trackW);
        ctx.fillStyle = inZone ? "#2ecc71" : "#e2b938";
        ctx.fillRect(markerX - 3, trackY - 5, 6, trackH + 10);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(markerX - 3, trackY - 5, 6, trackH + 10);

        // ==================== 2. CÍRCULO SUTIL TÁCTICO DE PULSACIÓN ====================
        const centerX = w / 2;
        const centerY = Math.round(h * 0.65);
        const circleRadius = 36;

        const pulse = (Math.sin(this.pulseTime * 3.5) + 1) * 0.12;
        let strokeCol = inZone ? `rgba(46, 204, 113, ${0.5 + pulse})` : `rgba(0, 240, 255, ${0.3 + pulse})`;
        let fillCol = inZone ? "rgba(46, 204, 113, 0.15)" : "rgba(0, 0, 0, 0.5)";

        // Onda expansiva táctica al tocar
        if (this.tapRippleTime > 0) {
            const ripProgress = 1 - (this.tapRippleTime / 0.4);
            const ripR = circleRadius + (ripProgress * 40);
            ctx.save();
            ctx.strokeStyle = this.lastTapSuccess ? "rgba(46, 204, 113, 0.8)" : "rgba(255, 51, 68, 0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ripR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, circleRadius, 0, Math.PI * 2);
        ctx.fillStyle = fillCol;
        ctx.fill();
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Miras en los 4 ejes
        const markLen = 6;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - circleRadius - markLen); ctx.lineTo(centerX, centerY - circleRadius + 2);
        ctx.moveTo(centerX, centerY + circleRadius - 2); ctx.lineTo(centerX, centerY + circleRadius + markLen);
        ctx.moveTo(centerX + circleRadius - 2, centerY); ctx.lineTo(centerX + circleRadius + markLen, centerY);
        ctx.moveTo(centerX - circleRadius - markLen, centerY); ctx.lineTo(centerX - circleRadius + 2, centerY);
        ctx.stroke();

        // Textos del centro
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = inZone ? "#2ecc71" : "#fff";
        ctx.font = "bold 11px 'Orbitron', monospace";
        ctx.fillText(inZone ? "¡ESTABILIZAR!" : "FIJAR RANGO", centerX, centerY - 4);

        ctx.fillStyle = inZone ? "#a8f5c4" : "#888";
        ctx.font = "8px 'Share Tech Mono', monospace";
        ctx.fillText(inZone ? "TOCA AHORA" : "ESPERANDO", centerX, centerY + 9);

        // Feedback Text inferior
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillText(this.feedbackText, centerX, h - 8);
    }
}

window.VitalsHoldGame = VitalsHoldGame;
