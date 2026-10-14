/**
 * Fase 1 - Variante C: Sutura Ficticia con Cursor Móvil
 * Mecánica táctica de precisión y sincronización temporal sobre pantalla táctil móvil.
 * Un cursor/retícula móvil oscila constantemente sobre cada punto de sutura de la herida;
 * el sanitario debe tocar la pantalla en el instante en que el cursor coincide con el punto.
 */
class SutureGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            puntos_requeridos: Number(raw.puntos_requeridos) || 8,
            radio_objetivo_px: Number(raw.radio_objetivo_px) || 28,
            velocidad_cursor_ms: Number(raw.velocidad_cursor_ms) || 1300,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 8.0,
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
        
        // Objetivo activo actual {x, y, r, angle, sweep}
        this.currentPoint = null;
        this.cursorPhase = 0;
        this.cursorX = 0;
        this.cursorY = 0;
        this.isCursorAligned = false;

        this.tapRipple = null; // {x, y, timer, success}

        this.feedbackText = "TOCA CUANDO EL CURSOR MÓVIL COINCIDA CON EL PUNTO DE SUTURA";
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

        // Margen seguro para ergonomía táctil en móviles
        const marginX = r + 30;
        const minY = 40 + r;
        const maxY = h - 35 - r;

        let bestX = 0, bestY = 0;
        let attempts = 0;
        const minDistance = r * 2.0;

        do {
            bestX = marginX + Math.random() * (w - (2 * marginX));
            bestY = minY + Math.random() * (maxY - minY);
            attempts++;

            // Separación de puntos ya completados
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

        // Ángulo de barrido del cursor (horizontal, vertical o diagonales)
        const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
        const chosenAngle = angles[Math.floor(Math.random() * angles.length)];

        this.cursorPhase = -Math.PI / 2; // Inicia en un extremo del barrido
        this.currentPoint = {
            x: bestX,
            y: bestY,
            r: r,
            angle: chosenAngle,
            sweep: Math.max(48, r * 2.0)
        };

        this.cursorX = bestX;
        this.cursorY = bestY;
        this.isCursorAligned = false;
    }

    handleTapAt(x, y) {
        if (!this.currentPoint) return;

        // Tolerancia: acierta si el cursor móvil coincide con el área del punto activo
        const isHit = this.isCursorAligned;

        this.tapRipple = {
            x: this.cursorX,
            y: this.cursorY,
            timer: 0.35,
            success: isHit
        };

        if (isHit) {
            // Acierto: consolidar punto de sutura
            this.completedPoints.push({ x: this.currentPoint.x, y: this.currentPoint.y });
            const totalDone = this.completedPoints.length;
            this.progress = Math.min(100, (totalDone / this.config.puntos_requeridos) * 100);

            this.showFeedback(`¡PUNTO CONSOLIDADO! (${totalDone}/${this.config.puntos_requeridos})`, "#2ecc71");
            this.onProgressUpdate(this.progress, { hit: true, puntos_completados: totalDone });

            if (totalDone >= this.config.puntos_requeridos || this.progress >= 100) {
                this.currentPoint = null;
                this.stop();
                this.onSuccess({ duration: this.elapsedTime, puntos: totalDone });
                return;
            }

            this.spawnNextPoint();
        } else {
            // Fallo de sincronización
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.showFeedback("¡DESFASE! ESPERA A QUE EL CURSOR CRUCE EL PUNTO", "#ff3344");
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

        // Actualizar posición del cursor oscilante sobre el punto activo
        if (this.currentPoint) {
            const cp = this.currentPoint;
            const cycleSpeed = (Math.PI * 2) / ((this.config.velocidad_cursor_ms || 1300) / 1000);
            this.cursorPhase += cycleSpeed * delta;

            const offset = Math.sin(this.cursorPhase) * cp.sweep;
            this.cursorX = cp.x + (Math.cos(cp.angle) * offset);
            this.cursorY = cp.y + (Math.sin(cp.angle) * offset);

            const dist = Math.hypot(this.cursorX - cp.x, this.cursorY - cp.y);
            this.isCursorAligned = (dist <= cp.r);
        }

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
        ctx.fillText("SUTURA TÁCTICA // CURSOR DE PRECISIÓN", 12, 16);

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

        // ==================== DIBUJAR OBJETIVO ACTIVO Y PISTA ====================
        if (this.currentPoint) {
            const cp = this.currentPoint;
            const cosA = Math.cos(cp.angle);
            const sinA = Math.sin(cp.angle);
            const x1 = cp.x - cosA * cp.sweep;
            const y1 = cp.y - sinA * cp.sweep;
            const x2 = cp.x + cosA * cp.sweep;
            const y2 = cp.y + sinA * cp.sweep;

            // 1. Pista guía del cursor
            ctx.strokeStyle = "rgba(0, 240, 255, 0.25)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.setLineDash([]);

            // Topes tácticos de la pista
            const capLen = 5;
            const pCos = -sinA * capLen;
            const pSin = cosA * capLen;
            ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
            ctx.beginPath();
            ctx.moveTo(x1 - pCos, y1 - pSin); ctx.lineTo(x1 + pCos, y1 + pSin);
            ctx.moveTo(x2 - pCos, y2 - pSin); ctx.lineTo(x2 + pCos, y2 + pSin);
            ctx.stroke();

            // 2. Círculo objetivo del punto
            const isAligned = this.isCursorAligned;
            const pulse = (Math.sin(this.pulseTime * 4) + 1) * 0.15;
            const pointColor = isAligned ? "#2ecc71" : "#00f0ff";

            // Halo pulsante
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, cp.r + (pulse * 6), 0, Math.PI * 2);
            ctx.strokeStyle = isAligned ? `rgba(46, 204, 113, ${0.45 + pulse})` : `rgba(0, 240, 255, ${0.3 + pulse})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Círculo base del punto
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, cp.r, 0, Math.PI * 2);
            ctx.fillStyle = isAligned ? "rgba(46, 204, 113, 0.25)" : "rgba(0, 240, 255, 0.1)";
            ctx.fill();
            ctx.strokeStyle = pointColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Miras de cuadrante
            const markLen = 6;
            ctx.beginPath();
            ctx.moveTo(cp.x, cp.y - cp.r - markLen); ctx.lineTo(cp.x, cp.y - cp.r + 2);
            ctx.moveTo(cp.x, cp.y + cp.r - 2); ctx.lineTo(cp.x, cp.y + cp.r + markLen);
            ctx.moveTo(cp.x + cp.r - 2, cp.y); ctx.lineTo(cp.x + cp.r + markLen, cp.y);
            ctx.moveTo(cp.x - cp.r - markLen, cp.y); ctx.lineTo(cp.x - cp.r + 2, cp.y);
            ctx.stroke();

            // Etiqueta del punto
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = isAligned ? "#2ecc71" : "#888";
            ctx.font = "8px 'Share Tech Mono', monospace";
            ctx.fillText(`PUNTO #${this.completedPoints.length + 1}`, cp.x, cp.y);

            // 3. CURSOR MÓVIL (Aguja/Retícula táctica oscilante)
            const curCol = isAligned ? "#2ecc71" : "#e2b938";
            ctx.save();
            ctx.translate(this.cursorX, this.cursorY);

            const cursorSize = 10;
            ctx.strokeStyle = curCol;
            ctx.fillStyle = isAligned ? "rgba(46, 204, 113, 0.45)" : "rgba(226, 185, 56, 0.25)";
            ctx.lineWidth = 2;

            // Rombo táctico
            ctx.beginPath();
            ctx.moveTo(0, -cursorSize);
            ctx.lineTo(cursorSize, 0);
            ctx.lineTo(0, cursorSize);
            ctx.lineTo(-cursorSize, 0);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Cruz interna
            ctx.beginPath();
            ctx.moveTo(-cursorSize - 4, 0); ctx.lineTo(cursorSize + 4, 0);
            ctx.moveTo(0, -cursorSize - 4); ctx.lineTo(0, cursorSize + 4);
            ctx.stroke();

            ctx.restore();
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
