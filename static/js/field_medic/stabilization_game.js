/**
 * Fase 2: Minijuego Común de Estabilización Rítmica
 * Totalmente desacoplado y táctico con pulsación directa en pantalla.
 * Gráfica de pulso ECG y sensor táctico circular con retroalimentación rítmica (BPM).
 */
class StabilizationGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        const raw = config || {};
        this.config = {
            bpm_ritmo: Number(raw.bpm_ritmo) || 60,
            tolerancia_ms: Number(raw.tolerancia_ms) || 180,
            pulsaciones_requeridas: Number(raw.pulsaciones_requeridas) || 8,
            penalizacion_por_desfase_pct: Number(raw.penalizacion_por_desfase_pct) || 10.0,
            progreso_por_latido_pct: Number(raw.progreso_por_latido_pct) || 12.5,
            tiempo_limite_segundos: Number(raw.tiempo_limite_segundos) || 45
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0..100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedTime = 0;

        // Intervalo entre latidos en milisegundos (ej: 60 BPM = 1000ms)
        this.beatIntervalMs = (60 / this.config.bpm_ritmo) * 1000;
        this.lastBeatTime = 0;
        this.nextBeatTime = 0;

        this.tapRippleTime = 0;
        this.lastTapSuccess = false;

        this.feedbackText = "TOCA LA PANTALLA EN EL MOMENTO DEL LATIDO CARDÍACO";
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
            this.triggerBeatTap();
        });

        window.addEventListener('resize', () => {
            if (this.isRunning) this.setupHiDPI();
        });
    }

    setupHiDPI() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width > 0 ? rect.width : 360;
        const cssH = 210; // Altura adaptada para pantalla móvil vertical

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
        this.lastBeatTime = this.lastTime;
        this.nextBeatTime = this.lastTime + this.beatIntervalMs;
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    triggerBeatTap() {
        if (!this.isRunning) return;

        const now = performance.now();
        // Diferencia absoluta con el latido más cercano (pasado o futuro)
        const distToNext = Math.abs(now - this.nextBeatTime);
        const distToPrev = Math.abs(now - this.lastBeatTime);
        const minOffset = Math.min(distToNext, distToPrev);

        this.tapRippleTime = 0.45; // Iniciar onda expansiva

        if (minOffset <= this.config.tolerancia_ms) {
            // Acierto rítmico
            this.lastTapSuccess = true;
            this.progress = Math.min(100, this.progress + this.config.progreso_por_latido_pct);
            this.showFeedback("¡RITMO SINCRONIZADO! (-" + Math.round(minOffset) + "ms)", "#2ecc71");
            this.onProgressUpdate(this.progress, { hit: true, offsetMs: minOffset });

            if (this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
            }
        } else {
            // Desfase rítmico
            this.lastTapSuccess = false;
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_desfase_pct);
            this.showFeedback("¡DESFASE / ARRITMIA! (Δ " + Math.round(minOffset) + "ms)", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false, offsetMs: minOffset });
        }
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 0.85;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = Math.min((timestamp - this.lastTime) / 1000, 0.1);
        this.lastTime = timestamp;
        this.elapsedTime += delta;

        // Actualizar tiempos de latido cíclico
        if (timestamp >= this.nextBeatTime) {
            this.lastBeatTime = this.nextBeatTime;
            this.nextBeatTime += this.beatIntervalMs;
        }

        if (this.feedbackTimer > 0) {
            this.feedbackTimer -= delta;
        }
        if (this.tapRippleTime > 0) {
            this.tapRippleTime -= delta;
        }

        this.drawECG(timestamp);
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    drawECG(timestamp) {
        const w = this.w || this.canvas.width;
        const h = this.h || this.canvas.height;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // 1. Fondo CRT táctico oscuro con rejilla
        ctx.fillStyle = "#060a0e";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "rgba(0, 240, 255, 0.05)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // 2. Traza ECG superior (h * 0.28)
        const ecgCenterY = Math.round(h * 0.26);
        const ecgHeight = Math.round(h * 0.22);
        
        // Línea base atenuada
        ctx.strokeStyle = "rgba(0, 240, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, ecgCenterY);
        ctx.lineTo(w, ecgCenterY);
        ctx.stroke();

        // Calcular fase del latido (0..1)
        const timeToNext = Math.max(0, this.nextBeatTime - timestamp) / this.beatIntervalMs; // 1 -> 0
        const isPulseZone = Math.min(
            Math.abs(timestamp - this.lastBeatTime),
            Math.abs(timestamp - this.nextBeatTime)
        ) <= this.config.tolerancia_ms;

        // Trazado de la onda ECG en tiempo real
        ctx.save();
        ctx.strokeStyle = isPulseZone ? "#2ecc71" : "#00f0ff";
        ctx.shadowColor = isPulseZone ? "#2ecc71" : "#00f0ff";
        ctx.shadowBlur = 6;
        ctx.lineWidth = 2.2;
        ctx.beginPath();

        const points = 70;
        for (let i = 0; i <= points; i++) {
            const px = (i / points) * w;
            const wavePhase = (i / points + (1 - timeToNext)) % 1;
            let py = ecgCenterY;

            // Complejo QRS simulado
            if (wavePhase > 0.44 && wavePhase <= 0.47) {
                py = ecgCenterY + (ecgHeight * 0.2); // Q dip
            } else if (wavePhase > 0.47 && wavePhase <= 0.52) {
                py = ecgCenterY - (ecgHeight * 0.95); // R spike
            } else if (wavePhase > 0.52 && wavePhase <= 0.55) {
                py = ecgCenterY + (ecgHeight * 0.4); // S dip
            } else if (wavePhase > 0.65 && wavePhase <= 0.75) {
                py = ecgCenterY - (ecgHeight * 0.25); // T wave
            }

            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();

        // Separador táctico fino entre ECG y zona táctil
        const sepY = Math.round(h * 0.45);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.moveTo(10, sepY);
        ctx.lineTo(w - 10, sepY);
        ctx.stroke();

        // 3. Zona Táctil Inferior: Círculo Táctico Reticular de Latido
        const sensorX = w * 0.5;
        const sensorY = Math.round(h * 0.68);
        const sensorR = 34;

        // Fase de expansión rítmica concéntrica (avanza conforme se aproxima el latido)
        const beatProgress = 1 - timeToNext; // 0 -> 1
        const rippleR = sensorR + (beatProgress * 22);
        const ringAlpha = Math.max(0, 0.45 - (beatProgress * 0.4));

        // Anillo exterior que se contrae o expande según el ritmo
        ctx.save();
        ctx.strokeStyle = isPulseZone ? "rgba(46, 204, 113, 0.6)" : `rgba(0, 240, 255, ${ringAlpha})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sensorX, sensorY, rippleR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Efecto Ripple táctil cuando el usuario pulsa
        if (this.tapRippleTime > 0) {
            const shockProgress = 1 - (this.tapRippleTime / 0.45);
            const shockR = sensorR + (shockProgress * 38);
            const shockAlpha = (1 - shockProgress) * 0.8;
            ctx.save();
            ctx.strokeStyle = this.lastTapSuccess 
                ? `rgba(46, 204, 113, ${shockAlpha})` 
                : `rgba(255, 51, 68, ${shockAlpha})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(sensorX, sensorY, shockR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Círculo principal del sensor táctil
        ctx.beginPath();
        ctx.arc(sensorX, sensorY, sensorR, 0, Math.PI * 2);
        ctx.fillStyle = isPulseZone 
            ? "rgba(46, 204, 113, 0.18)" 
            : "rgba(0, 240, 255, 0.04)";
        ctx.fill();

        ctx.strokeStyle = isPulseZone ? "#2ecc71" : "rgba(0, 240, 255, 0.4)";
        ctx.lineWidth = isPulseZone ? 2.5 : 1.5;
        ctx.stroke();

        // Marcas tácticas reticulares (Crosshair ticks N, S, E, O)
        const tickLen = 7;
        const tickGap = 5;
        ctx.strokeStyle = isPulseZone ? "#2ecc71" : "rgba(0, 240, 255, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        // Norte
        ctx.moveTo(sensorX, sensorY - sensorR - tickGap - tickLen);
        ctx.lineTo(sensorX, sensorY - sensorR - tickGap);
        // Sur
        ctx.moveTo(sensorX, sensorY + sensorR + tickGap);
        ctx.lineTo(sensorX, sensorY + sensorR + tickGap + tickLen);
        // Este
        ctx.moveTo(sensorX + sensorR + tickGap, sensorY);
        ctx.lineTo(sensorX + sensorR + tickGap + tickLen, sensorY);
        // Oeste
        ctx.moveTo(sensorX - sensorR - tickGap - tickLen, sensorY);
        ctx.lineTo(sensorX - sensorR - tickGap, sensorY);
        ctx.stroke();

        // Icono / Texto central dentro del círculo
        ctx.fillStyle = isPulseZone ? "#2ecc71" : "#fff";
        ctx.font = "bold 11px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(isPulseZone ? "¡PULSA!" : "LATIDO", sensorX, sensorY - 5);

        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.fillStyle = isPulseZone ? "#a8f5c4" : "var(--accent-cyan, #00f0ff)";
        ctx.fillText(`${this.config.bpm_ritmo} BPM`, sensorX, sensorY + 9);

        // 4. Etiqueta superior izquierda de estado / telemetría
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("ECG RITMO VITAL // CADENCIA CONSTANTE", 10, 16);

        // Indicador de tolerancia / objetivo
        ctx.fillStyle = isPulseZone ? "#2ecc71" : "#555";
        ctx.textAlign = "right";
        ctx.fillText(isPulseZone ? "● VENTANA ÓPTIMA" : "○ ESPERANDO ONDA", w - 10, 16);

        // 5. Feedback o Instrucción inferior
        ctx.textAlign = "center";
        if (this.feedbackTimer > 0) {
            ctx.fillStyle = this.feedbackColor;
            ctx.font = "bold 11px 'Share Tech Mono', monospace";
            ctx.fillText(this.feedbackText, w / 2, h - 8);
        } else {
            ctx.fillStyle = "#888";
            ctx.font = "10px 'Share Tech Mono', monospace";
            ctx.fillText("TOCA LA PANTALLA EN EL MOMENTO DEL LATIDO", w / 2, h - 8);
        }
    }
}

window.StabilizationGame = StabilizationGame;
