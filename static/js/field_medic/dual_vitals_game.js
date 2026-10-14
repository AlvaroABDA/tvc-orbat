/**
 * Fase 2 - Variante C: Equilibrar Dos Indicadores
 * Mecánica táctica de atención alterna con dos canales vitales independientes.
 * El sanitario equilibra simultáneamente el Canal Alfa y el Canal Bravo tocando la mitad correspondiente.
 */
class DualVitalsGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            velocidad_indicador_1_ms: Number(raw.velocidad_indicador_1_ms) || 1600,
            velocidad_indicador_2_ms: Number(raw.velocidad_indicador_2_ms) || 2200,
            ancho_zona_1_pct: Number(raw.ancho_zona_1_pct) || 24.0,
            ancho_zona_2_pct: Number(raw.ancho_zona_2_pct) || 24.0,
            aciertos_requeridos_por_barra: Number(raw.aciertos_requeridos_por_barra) || 4,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 15.0,
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
        this.pulseTime = 0;

        // Canal 1: Alfa (ej. Tensión Arterial)
        this.c1 = {
            pos: 0.2,
            dir: 1,
            speed: 1 / (this.config.velocidad_indicador_1_ms / 1000),
            targetWidth: this.config.ancho_zona_1_pct / 100,
            targetStart: 0.35,
            targetEnd: 0.35 + (this.config.ancho_zona_1_pct / 100),
            hits: 0,
            completed: false,
            rippleTime: 0,
            lastHit: false
        };

        // Canal 2: Bravo (ej. Saturación O2)
        this.c2 = {
            pos: 0.7,
            dir: -1,
            speed: 1 / (this.config.velocidad_indicador_2_ms / 1000),
            targetWidth: this.config.ancho_zona_2_pct / 100,
            targetStart: 0.55,
            targetEnd: 0.55 + (this.config.ancho_zona_2_pct / 100),
            hits: 0,
            completed: false,
            rippleTime: 0,
            lastHit: false
        };

        this.feedbackText = "EQUILIBRA AMBOS CANALES: TOCA LA MITAD SUPERIOR (ALFA) O INFERIOR (BRAVO)";
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

            const rect = this.canvas.getBoundingClientRect();
            const touchY = e.clientY - rect.top;
            const midY = (this.h || rect.height) / 2;

            if (touchY < midY) {
                this.triggerChannelTap(1);
            } else {
                this.triggerChannelTap(2);
            }
        });

        window.addEventListener('resize', () => {
            if (this.isRunning) this.setupHiDPI();
        });
    }

    setupHiDPI() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width > 0 ? rect.width : 360;
        const cssH = 220;

        this.w = cssW;
        this.h = cssH;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    repositionTarget(channel) {
        const c = channel === 1 ? this.c1 : this.c2;
        const margin = 0.12;
        const available = 1 - (2 * margin) - c.targetWidth;
        c.targetStart = margin + (Math.random() * available);
        c.targetEnd = c.targetStart + c.targetWidth;
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.isRunning = true;
        this.lastTime = performance.now();
        this.repositionTarget(1);
        this.repositionTarget(2);
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    triggerChannelTap(chNum) {
        const c = chNum === 1 ? this.c1 : this.c2;
        if (c.completed) return;

        c.rippleTime = 0.35;
        const inZone = (c.pos >= c.targetStart && c.pos <= c.targetEnd);
        c.lastHit = inZone;

        if (inZone) {
            c.hits++;
            if (c.hits >= this.config.aciertos_requeridos_por_barra) {
                c.completed = true;
            }
            this.showFeedback(`¡CANAL ${chNum === 1 ? "ALFA" : "BRAVO"} ESTABILIZADO! [${c.hits}/${this.config.aciertos_requeridos_por_barra}]`, "#2ecc71");
            this.repositionTarget(chNum);
        } else {
            c.hits = Math.max(0, c.hits - 1);
            this.showFeedback(`¡DESFASE EN CANAL ${chNum === 1 ? "ALFA" : "BRAVO"}!`, "#ff3344");
            this.repositionTarget(chNum);
        }

        // Calcular progreso ponderado de ambos canales
        const req = this.config.aciertos_requeridos_por_barra * 2;
        const currentHits = this.c1.hits + this.c2.hits;
        this.progress = Math.min(100, (currentHits / req) * 100);

        this.onProgressUpdate(this.progress, { c1_hits: this.c1.hits, c2_hits: this.c2.hits });

        if (this.c1.completed && this.c2.completed) {
            this.progress = 100;
            this.stop();
            this.onSuccess({ duration: this.elapsedTime });
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

        if (this.c1.rippleTime > 0) this.c1.rippleTime -= delta;
        if (this.c2.rippleTime > 0) this.c2.rippleTime -= delta;
        if (this.feedbackTimer > 0) this.feedbackTimer -= delta;

        // Movimiento Canal 1
        if (!this.c1.completed) {
            this.c1.pos += this.c1.dir * this.c1.speed * delta;
            if (this.c1.pos >= 1) { this.c1.pos = 1; this.c1.dir = -1; }
            else if (this.c1.pos <= 0) { this.c1.pos = 0; this.c1.dir = 1; }
        }

        // Movimiento Canal 2
        if (!this.c2.completed) {
            this.c2.pos += this.c2.dir * this.c2.speed * delta;
            if (this.c2.pos >= 1) { this.c2.pos = 1; this.c2.dir = -1; }
            else if (this.c2.pos <= 0) { this.c2.pos = 0; this.c2.dir = 1; }
        }

        this.draw();
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    draw() {
        const w = this.w || this.canvas.clientWidth || 360;
        const h = this.h || 220;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo HUD
        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, w, h);

        // Rejilla técnica
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Línea divisoria central entre ambos canales
        const midY = Math.round(h * 0.48);
        ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(10, midY); ctx.lineTo(w - 10, midY);
        ctx.stroke();
        ctx.setLineDash([]);

        // ==================== CANAL 1: ALFA (SUPERIOR) ====================
        this.drawChannel(1, 8, 20, w - 16, midY - 26, this.c1, "CANAL ALFA // TENSIÓN");

        // ==================== CANAL 2: BRAVO (INFERIOR) ====================
        this.drawChannel(2, 8, midY + 12, w - 16, h - midY - 32, this.c2, "CANAL BRAVO // OXÍGENO");

        // Feedback Text inferior
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(this.feedbackText, w / 2, h - 6);
    }

    drawChannel(num, x, y, width, height, c, label) {
        const ctx = this.ctx;
        const inZone = (c.pos >= c.targetStart && c.pos <= c.targetEnd);

        // Cabecera canal
        ctx.fillStyle = "#777";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(label, x + 4, y);

        ctx.textAlign = "right";
        ctx.fillStyle = c.completed ? "#2ecc71" : (inZone ? "#2ecc71" : "#e2b938");
        ctx.fillText(c.completed ? "✓ COMPLETO" : `[${c.hits}/${this.config.aciertos_requeridos_por_barra}]`, x + width - 4, y);

        // Barra del riel
        const trackY = y + 8;
        const trackH = 18;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        ctx.fillRect(x + 4, trackY, width - 8, trackH);
        ctx.strokeRect(x + 4, trackY, width - 8, trackH);

        // Zona Objetivo
        const tX = x + 4 + (c.targetStart * (width - 8));
        const tW = c.targetWidth * (width - 8);
        ctx.fillStyle = "rgba(46, 204, 113, 0.35)";
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = 1.5;
        ctx.fillRect(tX, trackY + 1, tW, trackH - 2);
        ctx.strokeRect(tX, trackY + 1, tW, trackH - 2);

        // Aguja indicadora
        const mX = x + 4 + (c.pos * (width - 8));
        ctx.fillStyle = c.completed ? "#2ecc71" : (inZone ? "#2ecc71" : "#00f0ff");
        ctx.fillRect(mX - 3, trackY - 3, 6, trackH + 6);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(mX - 3, trackY - 3, 6, trackH + 6);

        // Botón/sensor táctil sutil del canal
        const btnY = trackY + trackH + 14;
        const btnX = x + (width / 2);
        const btnR = 16;

        if (c.rippleTime > 0) {
            const ripR = btnR + ((0.35 - c.rippleTime) * 30);
            ctx.strokeStyle = c.lastHit ? "rgba(46, 204, 113, 0.8)" : "rgba(255, 51, 68, 0.8)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(btnX, btnY, ripR, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.arc(btnX, btnY, btnR, 0, Math.PI * 2);
        ctx.fillStyle = c.completed ? "rgba(46, 204, 113, 0.2)" : (inZone ? "rgba(46, 204, 113, 0.25)" : "rgba(0, 0, 0, 0.5)");
        ctx.fill();
        ctx.strokeStyle = c.completed ? "#2ecc71" : (inZone ? "#2ecc71" : "rgba(0, 240, 255, 0.4)");
        ctx.lineWidth = inZone ? 2 : 1;
        ctx.stroke();

        ctx.fillStyle = c.completed ? "#2ecc71" : (inZone ? "#2ecc71" : "#fff");
        ctx.font = "bold 9px 'Orbitron', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(c.completed ? "OK" : (inZone ? "¡PULSAR!" : `TOCAR`), btnX, btnY);
        ctx.textBaseline = "alphabetic";
    }
}

window.DualVitalsGame = DualVitalsGame;
