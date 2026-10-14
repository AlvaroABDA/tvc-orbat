/**
 * Fase 1 - Variante B: Torniquete con Objetivo Circular
 * Mecánica táctica de reacción y precisión temporal por sectores angulares.
 * El sanitario debe pulsar sobre la pantalla en el intervalo exacto en que se activa el sector objetivo.
 */
class TourniquetGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            segmentos_totales: Number(raw.segmentos_totales) || 8,
            aciertos_requeridos: Number(raw.aciertos_requeridos) || 5,
            duracion_activacion_ms: Number(raw.duracion_activacion_ms) || 850,
            intervalo_entre_activaciones_ms: Number(raw.intervalo_entre_activaciones_ms) || 500,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 15.0,
            progreso_por_acierto_pct: Number(raw.progreso_por_acierto_pct) || 20.0,
            tiempo_limite_segundos: Number(raw.tiempo_limite_segundos) || 60
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0..100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedTime = 0;

        // Estado de activación secuencial
        this.activeSegment = 0; // índice del segmento actualmente encendido
        this.targetSegment = 0; // índice del segmento objetivo marcado en verde
        this.isLit = false;
        this.stateTimer = 0;
        this.hitStreak = 0;
        this.hitsCount = 0;
        this.hasTappedCurrentCycle = false;

        this.pulseTime = 0;
        this.tapRippleTime = 0;
        this.lastTapSuccess = false;

        this.feedbackText = "PULSA CUANDO EL SECTOR ACTIVO COINCIDA CON LA MARCA OBJETIVO";
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

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.hitsCount = Math.round((this.progress / 100) * this.config.aciertos_requeridos);
        this.hitStreak = 0;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.activeSegment = 0;
        this.targetSegment = Math.floor(Math.random() * this.config.segmentos_totales);
        this.isLit = true;
        this.stateTimer = this.config.duracion_activacion_ms / 1000;
        this.hasTappedCurrentCycle = false;
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
        if (this.hasTappedCurrentCycle) return; // Evitar spam de toques en un mismo ciclo

        this.hasTappedCurrentCycle = true;
        this.tapRippleTime = 0.4;

        // Éxito si está iluminado y coincide con el segmento objetivo
        const isHit = (this.isLit && this.activeSegment === this.targetSegment);
        this.lastTapSuccess = isHit;

        if (isHit) {
            this.hitStreak++;
            this.hitsCount++;
            this.progress = Math.min(100, (this.hitsCount / this.config.aciertos_requeridos) * 100);
            this.showFeedback(`¡TORNIQUETE AJUSTADO! (${this.hitsCount}/${this.config.aciertos_requeridos})`, "#2ecc71");
            
            // Reubicar segmento objetivo aleatoriamente
            let newTarget;
            do {
                newTarget = Math.floor(Math.random() * this.config.segmentos_totales);
            } while (newTarget === this.targetSegment && this.config.segmentos_totales > 2);
            this.targetSegment = newTarget;

            this.onProgressUpdate(this.progress, { hit: true, streak: this.hitStreak, hits: this.hitsCount });

            if (this.progress >= 100 || this.hitsCount >= this.config.aciertos_requeridos) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
            }
        } else {
            this.hitStreak = 0;
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.hitsCount = Math.max(0, Math.floor((this.progress / 100) * this.config.aciertos_requeridos));
            this.showFeedback("¡DESFASE! PRESIÓN DE TORNIQUETE INSUFICIENTE", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false, errors: 1 });
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

        // Máquina de estados cíclica de encendido de segmentos
        this.stateTimer -= delta;
        if (this.stateTimer <= 0) {
            if (this.isLit) {
                // Se apaga e inicia intervalo de transición
                this.isLit = false;
                this.stateTimer = this.config.intervalo_entre_activaciones_ms / 1000;
            } else {
                // Pasa al siguiente segmento y se enciende
                this.isLit = true;
                this.hasTappedCurrentCycle = false;
                this.activeSegment = (this.activeSegment + 1) % this.config.segmentos_totales;
                this.stateTimer = this.config.duracion_activacion_ms / 1000;
            }
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

        // Rejilla CRT militar
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Telemetría superior
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(`TORNIQUETE TÁCTICO // SECTOR OBJ: [${this.targetSegment + 1}/${this.config.segmentos_totales}]`, 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = (this.isLit && this.activeSegment === this.targetSegment) ? "#2ecc71" : "#e2b938";
        ctx.fillText(`ACIERTOS: ${this.hitsCount} / ${this.config.aciertos_requeridos}`, w - 12, 16);

        // ==================== CÍRCULO CON SEGMENTOS ANGULARES ====================
        const centerX = w / 2;
        const centerY = Math.round(h * 0.49);
        const outerR = Math.min(centerX - 40, h * 0.36);
        const innerR = outerR * 0.52;
        const totalSegs = this.config.segmentos_totales;
        const segAngle = (Math.PI * 2) / totalSegs;
        const gap = 0.06; // Separación angular entre sectores tácticos

        for (let i = 0; i < totalSegs; i++) {
            const startA = (i * segAngle) - (Math.PI / 2) + (gap / 2);
            const endA = ((i + 1) * segAngle) - (Math.PI / 2) - (gap / 2);

            const isCurrentActive = (this.isLit && this.activeSegment === i);
            const isTarget = (this.targetSegment === i);

            ctx.beginPath();
            ctx.arc(centerX, centerY, outerR, startA, endA);
            ctx.arc(centerX, centerY, innerR, endA, startA, true);
            ctx.closePath();

            if (isCurrentActive && isTarget) {
                // Coincidencia óptima -> Verde brillante
                ctx.fillStyle = "rgba(46, 204, 113, 0.75)";
                ctx.strokeStyle = "#2ecc71";
                ctx.lineWidth = 2.5;
            } else if (isCurrentActive) {
                // Segmento activo pero no objetivo -> Cian / Ámbar
                ctx.fillStyle = "rgba(0, 240, 255, 0.55)";
                ctx.strokeStyle = "#00f0ff";
                ctx.lineWidth = 1.5;
            } else if (isTarget) {
                // Segmento objetivo en espera -> Verde atenuado con reborde parpadeante
                const pulse = (Math.sin(this.pulseTime * 4) + 1) * 0.15;
                ctx.fillStyle = `rgba(46, 204, 113, ${0.15 + pulse})`;
                ctx.strokeStyle = `rgba(46, 204, 113, ${0.4 + pulse})`;
                ctx.lineWidth = 1.5;
            } else {
                // Segmento inactivo
                ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
                ctx.lineWidth = 1;
            }

            ctx.fill();
            ctx.stroke();
        }

        // ==================== CÍRCULO CENTRAL DE PULSACIÓN ====================
        const centerR = innerR * 0.85;
        const isMatchNow = (this.isLit && this.activeSegment === this.targetSegment);

        // Onda expansiva táctica al tocar
        if (this.tapRippleTime > 0) {
            const ripProgress = 1 - (this.tapRippleTime / 0.4);
            const ripR = centerR + (ripProgress * 40);
            ctx.save();
            ctx.strokeStyle = this.lastTapSuccess ? "rgba(46, 204, 113, 0.8)" : "rgba(255, 51, 68, 0.8)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ripR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, centerR, 0, Math.PI * 2);
        ctx.fillStyle = isMatchNow ? "rgba(46, 204, 113, 0.25)" : "rgba(0, 0, 0, 0.6)";
        ctx.fill();
        ctx.strokeStyle = isMatchNow ? "#2ecc71" : "rgba(0, 240, 255, 0.4)";
        ctx.lineWidth = isMatchNow ? 2.5 : 1.5;
        ctx.stroke();

        // Miras en cruz táctica
        const markLen = 5;
        ctx.strokeStyle = isMatchNow ? "#2ecc71" : "rgba(0, 240, 255, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - centerR - markLen); ctx.lineTo(centerX, centerY - centerR + 2);
        ctx.moveTo(centerX, centerY + centerR - 2); ctx.lineTo(centerX, centerY + centerR + markLen);
        ctx.moveTo(centerX + centerR - 2, centerY); ctx.lineTo(centerX + centerR + markLen, centerY);
        ctx.moveTo(centerX - centerR - markLen, centerY); ctx.lineTo(centerX - centerR + 2, centerY);
        ctx.stroke();

        // Textos dentro del círculo central
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isMatchNow ? "#2ecc71" : "#fff";
        ctx.font = "bold 11px 'Orbitron', monospace";
        ctx.fillText(isMatchNow ? "¡AJUSTAR!" : "TORNIQUETE", centerX, centerY - 4);

        ctx.fillStyle = isMatchNow ? "#a8f5c4" : "#888";
        ctx.font = "8px 'Share Tech Mono', monospace";
        ctx.fillText(isMatchNow ? "TOCA AQUÍ" : "ESPERANDO", centerX, centerY + 9);

        // Feedback Text inferior
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillText(this.feedbackText, centerX, h - 8);
    }
}

window.TourniquetGame = TourniquetGame;
