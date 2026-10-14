/**
 * Fase 1: Minijuego de Control de Hemorragia
 * Mecánica de precisión temporal (marcador oscilante con zona objetivo configurable)
 */
class HemorrhageGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config || {
            velocidad_marcador_ms: 1600,
            ancho_zona_objetivo_pct: 22.0,
            aciertos_requeridos: 4,
            penalizacion_por_error_pct: 15.0,
            progreso_por_acierto_pct: 25.0,
            tiempo_limite_segundos: 60,
            decay_pasivo_por_segundo_pct: 1.0
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0 a 100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedGameTime = 0;

        // Marcador oscilante: 0% a 100%
        this.markerPos = 0; // 0..1
        this.markerDir = 1;

        // Zona objetivo (centro aleatorio o dinámico)
        this.targetWidth = this.config.ancho_zona_objetivo_pct / 100;
        this.targetStart = 0.5 - (this.targetWidth / 2);
        this.targetEnd = 0.5 + (this.targetWidth / 2);

        this.consecutiveErrors = 0;
        this.hitStreak = 0;
        this.feedbackText = "";
        this.feedbackColor = "#fff";
        this.feedbackTimer = 0;
    }

    start(initialProgress = 0) {
        this.progress = Math.max(0, Math.min(100, initialProgress));
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
        // Colocar la zona objetivo en una posición aleatoria segura (entre 0.15 y 0.85)
        const margin = 0.12;
        const available = 1 - (2 * margin) - this.targetWidth;
        this.targetStart = margin + (Math.random() * available);
        this.targetEnd = this.targetStart + this.targetWidth;
    }

    triggerTap() {
        if (!this.isRunning) return;

        // Verificar si el marcador está dentro de la zona objetivo
        const isHit = (this.markerPos >= this.targetStart && this.markerPos <= this.targetEnd);

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

            // Penalización proporcional
            const penalty = this.config.penalizacion_por_error_pct + (this.consecutiveErrors > 1 ? 5 : 0);
            this.progress = Math.max(0, this.progress - penalty);

            this.showFeedback("¡DESFASE! HEMORRAGIA ACTIVA", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false, errors: this.consecutiveErrors });
        }
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 0.8; // Segundos visible
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        this.elapsedGameTime += delta;

        // Decay pasivo leve si la hemorragia está desatendida
        if (this.config.decay_pasivo_por_segundo_pct > 0 && this.progress > 0) {
            this.progress = Math.max(0, this.progress - (this.config.decay_pasivo_por_segundo_pct * delta));
            this.onProgressUpdate(this.progress, { passive: true });
        }

        // Límite de tiempo opcional
        if (this.config.tiempo_limite_segundos && this.elapsedGameTime >= this.config.tiempo_limite_segundos) {
            this.stop();
            this.onFail("TIEMPO AGOTADO");
            return;
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
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo del riel
        const trackY = h * 0.45;
        const trackH = 26;
        ctx.fillStyle = "rgba(10, 15, 20, 0.9)";
        ctx.strokeStyle = "rgba(255, 50, 50, 0.4)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(10, trackY, w - 20, trackH, 6);
        ctx.fill();
        ctx.stroke();

        // Zona Objetivo (Sweet Spot verde / cian)
        const targetX1 = 10 + (this.targetStart * (w - 20));
        const targetW = this.targetWidth * (w - 20);
        ctx.fillStyle = "rgba(46, 204, 113, 0.35)";
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = 2;
        ctx.fillRect(targetX1, trackY + 2, targetW, trackH - 4);
        ctx.strokeRect(targetX1, trackY + 2, targetW, trackH - 4);

        // Marcador móvil (Aguja roja / dorada)
        const markerX = 10 + (this.markerPos * (w - 20));
        ctx.fillStyle = "#ffaa00";
        ctx.shadowColor = "#ffaa00";
        ctx.shadowBlur = 10;
        ctx.fillRect(markerX - 3, trackY - 8, 6, trackH + 16);
        ctx.shadowBlur = 0;

        // Feedback Text
        if (this.feedbackTimer > 0) {
            ctx.fillStyle = this.feedbackColor;
            ctx.font = "bold 13px 'Share Tech Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(this.feedbackText, w / 2, trackY + trackH + 24);
        }
    }
}

window.HemorrhageGame = HemorrhageGame;
