/**
 * Fase 2 - Variante E: Corregir la Línea de Vida
 * Mecánica táctica de control continuo (Hold & Release).
 * La señal vital tiende a desviarse por inestabilidad; el sanitario mantiene pulsado para aplicar contrafuerza y mantenerla en el pasillo verde.
 */
class LineCorrectionGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            velocidad_desviacion: Number(raw.velocidad_desviacion) || 35.0,
            fuerza_correccion: Number(raw.fuerza_correccion) || 65.0,
            margen_tolerancia_pct: Number(raw.margen_tolerancia_pct) || 25.0,
            segundos_en_rango_requeridos: Number(raw.segundos_en_rango_requeridos) || 6.0,
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

        // Estado del indicador vertical: 0 (arriba) a 100 (abajo), centro = 50
        this.signalY = 80; // Inicia desestabilizado
        this.driftDirection = 1; // 1: hacia abajo, -1: hacia arriba
        this.isHolding = false;
        this.timeInZone = 0; // Segundos acumulados dentro de la franja segura

        // Pasillo de seguridad central (ej: 50 +- 12.5% = 37.5 a 62.5)
        const halfMargin = this.config.margen_tolerancia_pct / 2;
        this.zoneMin = 50 - halfMargin;
        this.zoneMax = 50 + halfMargin;

        // Historial de la línea de onda
        this.waveHistory = [];

        this.feedbackText = "MANTÉN PULSADO PARA CORREGIR LA DERIVA HACIA LA FRANJA VERDE";
        this.feedbackColor = "#888";
        this.feedbackTimer = 0;

        this.attachEvents();
    }

    attachEvents() {
        if (this._eventsAttached) return;
        this._eventsAttached = true;

        this.canvas.style.touchAction = 'none';
        this.canvas.style.cursor = 'pointer';

        const onStart = (e) => {
            if (!this.isRunning) return;
            if (e && e.cancelable) e.preventDefault();
            this.isHolding = true;
        };

        const onEnd = (e) => {
            if (!this.isRunning) return;
            if (e && e.cancelable) e.preventDefault();
            this.isHolding = false;
        };

        this.canvas.addEventListener('pointerdown', onStart);
        this.canvas.addEventListener('pointerup', onEnd);
        this.canvas.addEventListener('pointercancel', onEnd);
        this.canvas.addEventListener('pointerleave', onEnd);

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

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.timeInZone = (this.progress / 100) * this.config.segundos_en_rango_requeridos;
        this.signalY = 75; // Arranca con desvío
        this.isHolding = false;
        this.waveHistory = [];
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        this.isHolding = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 0.8;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
        this.lastTime = timestamp;
        this.elapsedTime += delta;
        this.pulseTime += delta;

        if (this.feedbackTimer > 0) this.feedbackTimer -= delta;

        // FÍSICA DE DERIVA Y CONTRAFUERZA VECTORIAL
        if (this.isHolding) {
            // Mantener pulsado empuja la señal hacia arriba
            this.signalY -= this.config.fuerza_correccion * delta;
        } else {
            // Soltar deja que la señal caiga/derive hacia abajo
            this.signalY += this.config.velocidad_desviacion * delta;
        }

        // Límites de pantalla (0 a 100)
        this.signalY = Math.max(5, Math.min(95, this.signalY));

        // Registro de historial para traza de ECG continua
        this.waveHistory.push(this.signalY);
        if (this.waveHistory.length > 70) this.waveHistory.shift();

        // Evaluación de permanencia en zona segura
        const inZone = (this.signalY >= this.zoneMin && this.signalY <= this.zoneMax);

        if (inZone) {
            this.timeInZone += delta;
            this.progress = Math.min(100, (this.timeInZone / this.config.segundos_en_rango_requeridos) * 100);
            this.showFeedback("¡TRAYECTORIA ESTABILIZADA! MANTÉN EL RANGO", "#2ecc71");
            this.onProgressUpdate(this.progress, { inZone: true, timeInZone: this.timeInZone });

            if (this.timeInZone >= this.config.segundos_en_rango_requeridos || this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
                return;
            }
        } else {
            // Decaimiento suave si se desestabiliza fuera de la zona
            this.timeInZone = Math.max(0, this.timeInZone - (delta * 0.35));
            this.progress = (this.timeInZone / this.config.segundos_en_rango_requeridos) * 100;
            this.showFeedback(this.signalY < this.zoneMin ? "¡SOBRECORRECCIÓN! SUELTA UN POCO" : "¡DESVIACIÓN! MANTÉN PULSADO", "#ff3344");
            this.onProgressUpdate(this.progress, { inZone: false });
        }

        this.draw();
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    draw() {
        const w = this.w || this.canvas.clientWidth || 360;
        const h = this.h || 220;
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

        // ==================== ZONA DE FRANJA SEGURA (PASILLO VERDE) ====================
        const areaY1 = 28;
        const areaH = h - 68; // Área de oscilación
        const zoneTop = areaY1 + ((this.zoneMin / 100) * areaH);
        const zoneHeight = ((this.zoneMax - this.zoneMin) / 100) * areaH;

        ctx.fillStyle = "rgba(46, 204, 113, 0.12)";
        ctx.fillRect(10, zoneTop, w - 20, zoneHeight);

        ctx.strokeStyle = "rgba(46, 204, 113, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(10, zoneTop, w - 20, zoneHeight);
        ctx.setLineDash([]);

        // Línea central de referencia ideal
        const centerRefY = areaY1 + (0.5 * areaH);
        ctx.strokeStyle = "rgba(46, 204, 113, 0.25)";
        ctx.beginPath();
        ctx.moveTo(10, centerRefY); ctx.lineTo(w - 10, centerRefY);
        ctx.stroke();

        // ==================== TRAZADO DE LA LÍNEA DE ONDA CONTINUA ====================
        const inZone = (this.signalY >= this.zoneMin && this.signalY <= this.zoneMax);
        ctx.strokeStyle = inZone ? "#2ecc71" : "#ff3344";
        ctx.shadowColor = inZone ? "#2ecc71" : "#ff3344";
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        const histLen = this.waveHistory.length;
        for (let i = 0; i < histLen; i++) {
            const px = 10 + (i / Math.max(1, histLen - 1)) * (w - 70);
            const py = areaY1 + ((this.waveHistory[i] / 100) * areaH);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Marcador activo actual en el extremo derecho
        const curPx = w - 50;
        const curPy = areaY1 + ((this.signalY / 100) * areaH);

        ctx.beginPath();
        ctx.arc(curPx, curPy, 7, 0, Math.PI * 2);
        ctx.fillStyle = inZone ? "#2ecc71" : "#ff3344";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // ==================== CÍRCULO SUTIL TÁCTICO DE PULSACIÓN ====================
        const padX = curPx;
        const padY = Math.round(h * 0.72);
        const padR = 26;

        const pulse = (Math.sin(this.pulseTime * 4) + 1) * 0.15;
        let strokeCol = this.isHolding ? (inZone ? "#2ecc71" : "#00f0ff") : `rgba(0, 240, 255, ${0.3 + pulse})`;
        let fillCol = this.isHolding ? "rgba(0, 240, 255, 0.25)" : "rgba(0, 0, 0, 0.6)";

        ctx.beginPath();
        ctx.arc(padX, padY, padR, 0, Math.PI * 2);
        ctx.fillStyle = fillCol;
        ctx.fill();
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = this.isHolding ? 2.5 : 1.5;
        ctx.stroke();

        // Miras tácticas
        const markLen = 5;
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, padY - padR - markLen); ctx.lineTo(padX, padY - padR + 2);
        ctx.moveTo(padX, padY + padR - 2); ctx.lineTo(padX, padY + padR + markLen);
        ctx.moveTo(padX + padR - 2, padY); ctx.lineTo(padX + padR + markLen, padY);
        ctx.moveTo(padX - padR - markLen, padY); ctx.lineTo(padX - padR + 2, padY);
        ctx.stroke();

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = this.isHolding ? "#00f0ff" : "#fff";
        ctx.font = "bold 9px 'Orbitron', monospace";
        ctx.fillText(this.isHolding ? "APLICANDO" : "MANTÉN", padX, padY - 3);
        ctx.fillStyle = "#888";
        ctx.font = "7px 'Share Tech Mono', monospace";
        ctx.fillText(this.isHolding ? "EMPUJE" : "PULSADO", padX, padY + 8);
        ctx.textBaseline = "alphabetic";

        // Telemetría superior
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("CORRECCIÓN VECTORIAL // VECTOR ESTABILIZADOR", 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = inZone ? "#2ecc71" : "#e2b938";
        ctx.fillText(`TIEMPO ESTABLE: ${this.timeInZone.toFixed(1)}s / ${this.config.segundos_en_rango_requeridos}s`, w - 12, 16);

        // Feedback Text inferior
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(this.feedbackText, (w - 70) / 2, h - 8);
    }
}

window.LineCorrectionGame = LineCorrectionGame;
