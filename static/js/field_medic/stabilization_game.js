/**
 * Fase 2: Minijuego Común de Estabilización Rítmica
 * Totalmente desacoplado y reutilizable para cualquier lesión o atención médica.
 * Gráfica de pulso ficticio y ventanas de precisión rítmica por latidos (BPM).
 */
class StabilizationGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config || {
            bpm_ritmo: 60,
            tolerancia_ms: 180,
            pulsaciones_requeridas: 8,
            penalizacion_por_desfase_pct: 10.0,
            progreso_por_latido_pct: 12.5,
            tiempo_limite_segundos: 45
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

        // Historial de trazado ECG ficticio
        this.ecgPoints = [];
        this.ecgPhase = 0;

        this.feedbackText = "";
        this.feedbackColor = "#fff";
        this.feedbackTimer = 0;
    }

    start(initialProgress = 0) {
        this.progress = Math.max(0, Math.min(100, initialProgress));
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

        if (minOffset <= this.config.tolerancia_ms) {
            // Acierto rítmico
            this.progress = Math.min(100, this.progress + this.config.progreso_por_latido_pct);
            this.showFeedback("¡RITMO SINCRONIZADO!", "#2ecc71");
            this.onProgressUpdate(this.progress, { hit: true, offsetMs: minOffset });

            if (this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
            }
        } else {
            // Desfase rítmico
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_desfase_pct);
            this.showFeedback("¡ARRITMIA / DESFASE!", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false, offsetMs: minOffset });
        }
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 0.7;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = (timestamp - this.lastTime) / 1000;
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

        this.drawECG(timestamp);
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    drawECG(timestamp) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo CRT con cuadrícula médica
        ctx.fillStyle = "#060a0e";
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = "rgba(0, 240, 255, 0.08)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Simular onda de pulso rítmica
        const midY = h * 0.5;
        const timeToNext = (this.nextBeatTime - timestamp) / this.beatIntervalMs; // 0..1
        
        ctx.strokeStyle = "#00f0ff";
        ctx.shadowColor = "#00f0ff";
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2.5;
        ctx.beginPath();

        const points = 60;
        for (let i = 0; i <= points; i++) {
            const px = (i / points) * w;
            const wavePhase = (i / points + (1 - timeToNext)) % 1;
            let py = midY;

            // Picos ficticios simulados de complejo QRS
            if (wavePhase > 0.45 && wavePhase < 0.48) py = midY + 8;
            else if (wavePhase >= 0.48 && wavePhase < 0.52) py = midY - 38; // R spike
            else if (wavePhase >= 0.52 && wavePhase < 0.55) py = midY + 16; // S dip
            else if (wavePhase >= 0.65 && wavePhase < 0.75) py = midY - 10; // T wave

            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Anillo / Indicador del pulso objetivo en el centro
        const isPulseZone = Math.abs(timeToNext - 0.5) < (this.config.tolerancia_ms / this.beatIntervalMs);
        ctx.fillStyle = isPulseZone ? "rgba(46, 204, 113, 0.25)" : "rgba(218, 165, 32, 0.1)";
        ctx.strokeStyle = isPulseZone ? "#2ecc71" : "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = isPulseZone ? 2 : 1;
        ctx.strokeRect(w * 0.4, midY - 45, w * 0.2, 90);

        // Feedback Text
        if (this.feedbackTimer > 0) {
            ctx.fillStyle = this.feedbackColor;
            ctx.font = "bold 13px 'Share Tech Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(this.feedbackText, w / 2, h - 12);
        }
    }
}

window.StabilizationGame = StabilizationGame;
