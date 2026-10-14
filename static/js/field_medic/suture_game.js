/**
 * Fase 1 - Variante C: Sutura Ficticia Mediante Objetivos Consecutivos
 * Mecánica táctica de precisión espacial sobre pantalla táctil móvil.
 * El sanitario debe pulsar secuencialmente puntos de sutura sobre la herida esquemática.
 */
class SutureGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            puntos_requeridos: Number(raw.puntos_requeridos) || 6,
            radio_objetivo_px: Number(raw.radio_objetivo_px) || 30,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 10.0,
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

        // Historial de puntos consolidados (suturas ya dadas)
        this.completedPoints = []; // [{x, y}]
        
        // Objetivo activo actual {x, y, r}
        this.currentPoint = null;
        this.tapRipple = null; // {x, y, time, success}

        this.feedbackText = "TOCA EL PUNTO DE SUTURA DESTACADO EN LA HERIDA";
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
            // Coordenadas relativas al CSS del canvas
            const touchX = e.clientX - rect.left;
            const touchY = e.clientY - rect.top;
            this.handleTapAt(touchX, touchY);
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
        this.completedPoints = [];
        this.tapRipple = null;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.spawnNextPoint();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    spawnNextPoint() {
        const w = this.w || 360;
        const h = this.h || 210;
        const r = this.config.radio_objetivo_px;

        // Margen seguro (Safe zone) para ergonomía táctil en móviles
        const marginX = r + 24;
        const minY = 38 + r;
        const maxY = h - 28 - r;

        let bestX = 0, bestY = 0;
        let attempts = 0;
        const minDistance = r * 2.2;

        do {
            bestX = marginX + Math.random() * (w - (2 * marginX));
            bestY = minY + Math.random() * (maxY - minY);
            attempts++;

            // Verificar separación de los puntos anteriores
            let farEnough = true;
            for (const p of this.completedPoints) {
                const dist = Math.hypot(bestX - p.x, bestY - p.y);
                if (dist < minDistance) {
                    farEnough = false;
                    break;
                }
            }
            if (farEnough || attempts > 15) break;
        } while (attempts < 20);

        this.currentPoint = { x: bestX, y: bestY, r: r };
    }

    handleTapAt(x, y) {
        if (!this.currentPoint) return;

        const dist = Math.hypot(x - this.currentPoint.x, y - this.currentPoint.y);
        // Margen de tolerancia táctil generoso (radio + 6px) para pantallas móviles
        const isHit = dist <= (this.currentPoint.r + 6);

        this.tapRipple = {
            x: x,
            y: y,
            timer: 0.35,
            success: isHit
        };

        if (isHit) {
            // Acierto: fijar punto de sutura
            this.completedPoints.push({ x: this.currentPoint.x, y: this.currentPoint.y });
            const totalDone = this.completedPoints.length;
            this.progress = Math.min(100, (totalDone / this.config.puntos_requeridos) * 100);

            this.showFeedback(`¡PUNTO APLICADO! (${totalDone}/${this.config.puntos_requeridos})`, "#2ecc71");
            this.onProgressUpdate(this.progress, { hit: true, puntos_completados: totalDone });

            if (totalDone >= this.config.puntos_requeridos || this.progress >= 100) {
                this.currentPoint = null;
                this.stop();
                this.onSuccess({ duration: this.elapsedTime, puntos: totalDone });
                return;
            }

            this.spawnNextPoint();
        } else {
            // Fallo de precisión espacial
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.showFeedback("¡DESVÍO DE AGUJA! TOCA DENTRO DE LA RETÍCULA", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false });
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

        if (this.tapRipple && this.tapRipple.timer > 0) {
            this.tapRipple.timer -= delta;
        }
        if (this.feedbackTimer > 0) {
            this.feedbackTimer -= delta;
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

        // ==================== REPRESENTACIÓN ESQUEMÁTICA DE LA HERIDA ====================
        const midY = h * 0.48;
        ctx.strokeStyle = "rgba(255, 51, 68, 0.35)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(35, midY - 6);
        ctx.bezierCurveTo(w * 0.35, midY + 12, w * 0.65, midY - 14, w - 35, midY + 6);
        ctx.stroke();

        ctx.strokeStyle = "rgba(255, 51, 68, 0.15)";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.moveTo(35, midY - 6);
        ctx.bezierCurveTo(w * 0.35, midY + 12, w * 0.65, midY - 14, w - 35, midY + 6);
        ctx.stroke();

        // Telemetría superior
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("SUTURA TÁCTICA // APROXIMACIÓN DE BORDES", 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = "#2ecc71";
        ctx.fillText(`PUNTOS: ${this.completedPoints.length} / ${this.config.puntos_requeridos}`, w - 12, 16);

        // ==================== DIBUJAR PUNTOS COMPLETADOS ====================
        for (const p of this.completedPoints) {
            // Cruz de sutura verde consolidada
            ctx.strokeStyle = "#2ecc71";
            ctx.lineWidth = 2;
            const crossLen = 8;
            ctx.beginPath();
            ctx.moveTo(p.x - crossLen, p.y - crossLen); ctx.lineTo(p.x + crossLen, p.y + crossLen);
            ctx.moveTo(p.x - crossLen, p.y + crossLen); ctx.lineTo(p.x + crossLen, p.y - crossLen);
            ctx.stroke();

            // Círculo pequeño consolidado
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = "#2ecc71";
            ctx.fill();
        }

        // ==================== DIBUJAR OBJETIVO ACTIVO ====================
        if (this.currentPoint) {
            const cp = this.currentPoint;
            const pulse = (Math.sin(this.pulseTime * 4) + 1) * 0.15;

            // Halo exterior pulsante
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, cp.r + (pulse * 8), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.35 + pulse})`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Círculo táctil principal
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, cp.r, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(0, 240, 255, 0.12)";
            ctx.fill();
            ctx.strokeStyle = "#00f0ff";
            ctx.lineWidth = 2;
            ctx.stroke();

            // Miras tácticas en los 4 ejes
            const markLen = 7;
            ctx.beginPath();
            ctx.moveTo(cp.x, cp.y - cp.r - markLen); ctx.lineTo(cp.x, cp.y - cp.r + 2);
            ctx.moveTo(cp.x, cp.y + cp.r - 2); ctx.lineTo(cp.x, cp.y + cp.r + markLen);
            ctx.moveTo(cp.x + cp.r - 2, cp.y); ctx.lineTo(cp.x + cp.r + markLen, cp.y);
            ctx.moveTo(cp.x - cp.r - markLen, cp.y); ctx.lineTo(cp.x - cp.r + 2, cp.y);
            ctx.stroke();

            // Texto central de acción
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#fff";
            ctx.font = "bold 9px 'Orbitron', monospace";
            ctx.fillText("PULSAR", cp.x, cp.y - 2);
            ctx.fillStyle = "#00f0ff";
            ctx.font = "8px 'Share Tech Mono', monospace";
            ctx.fillText(`[#${this.completedPoints.length + 1}]`, cp.x, cp.y + 8);
        }

        // Onda expansiva táctica al pulsar
        if (this.tapRipple && this.tapRipple.timer > 0) {
            const rip = this.tapRipple;
            const ripProgress = 1 - (rip.timer / 0.35);
            const ripR = 15 + (ripProgress * 40);
            ctx.save();
            ctx.strokeStyle = rip.success ? "rgba(46, 204, 113, 0.85)" : "rgba(255, 51, 68, 0.85)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(rip.x, rip.y, ripR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Feedback Text inferior
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(this.feedbackText, w / 2, h - 8);
    }
}

window.SutureGame = SutureGame;
