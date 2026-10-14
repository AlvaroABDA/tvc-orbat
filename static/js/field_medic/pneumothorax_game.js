/**
 * Fase 1 Alternativa: Neumotórax a Tensión / Parche Oclusivo
 * Mecánica de descompresión pulmonar por sincronización de válvula torácica.
 * Manómetro de presión intratorácica con ciclo de respiración y ventana de descompresión.
 */
class PneumothoraxGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config || {
            velocidad_ciclo_ms: 1800,
            zona_descompresion_min_pct: 65.0,
            zona_descompresion_max_pct: 85.0,
            aciertos_requeridos: 4,
            penalizacion_por_error_pct: 15.0,
            progreso_por_acierto_pct: 25.0,
            tiempo_limite_segundos: 60
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0..100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedTime = 0;

        // Manómetro de presión: 0..100
        this.pressure = 20;
        this.pressureDir = 1;
        this.hitStreak = 0;

        this.feedbackText = "";
        this.feedbackColor = "#fff";
        this.feedbackTimer = 0;
    }

    start(initialProgress = 0) {
        this.progress = Math.max(0, Math.min(100, initialProgress));
        this.isRunning = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    triggerVentTap() {
        if (!this.isRunning) return;

        // La válvula debe abrirse en el pico de presión torácica (zona dulce: 65% a 85%)
        const inVentZone = (this.pressure >= this.config.zona_descompresion_min_pct && 
                            this.pressure <= this.config.zona_descompresion_max_pct);

        if (inVentZone) {
            this.hitStreak++;
            this.progress = Math.min(100, this.progress + this.config.progreso_por_acierto_pct);
            this.showFeedback("¡DESCOMPRESIÓN EFECTIVA!", "#2ecc71");
            this.onProgressUpdate(this.progress, { hit: true, streak: this.hitStreak });

            if (this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
            }
        } else {
            this.hitStreak = 0;
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.showFeedback("¡VENTEO PREMATURO / COLAPSO!", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false });
        }
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 0.8;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        this.elapsedTime += delta;

        // Oscilar presión intratorácica simulando ciclo respiratorio tenso
        const speed = 100 / (this.config.velocidad_ciclo_ms / 1000);
        this.pressure += this.pressureDir * speed * delta;

        if (this.pressure >= 100) {
            this.pressure = 100;
            this.pressureDir = -1;
        } else if (this.pressure <= 10) {
            this.pressure = 10;
            this.pressureDir = 1;
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

        // Fondo manómetro
        ctx.fillStyle = "#070b10";
        ctx.fillRect(0, 0, w, h);

        // Riel manómetro arqueado / barra de presión
        const barX = 20;
        const barY = h * 0.45;
        const barW = w - 40;
        const barH = 24;

        ctx.fillStyle = "rgba(20, 25, 35, 0.9)";
        ctx.strokeStyle = "rgba(0, 240, 255, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barX, barY, barW, barH);
        ctx.fillRect(barX, barY, barW, barH);

        // Zona segura de descompresión (Vent Window)
        const zMinX = barX + (this.config.zona_descompresion_min_pct / 100 * barW);
        const zMaxX = barX + (this.config.zona_descompresion_max_pct / 100 * barW);
        ctx.fillStyle = "rgba(46, 204, 113, 0.3)";
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = 2;
        ctx.fillRect(zMinX, barY + 2, (zMaxX - zMinX), barH - 4);
        ctx.strokeRect(zMinX, barY + 2, (zMaxX - zMinX), barH - 4);

        // Aguja / Nivel de presión
        const pX = barX + (this.pressure / 100 * barW);
        ctx.fillStyle = this.pressure > 85 ? "#ff3344" : "#ffaa00";
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillRect(pX - 4, barY - 6, 8, barH + 12);
        ctx.shadowBlur = 0;

        // Etiquetas
        ctx.fillStyle = "#888";
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("BAJA", barX, barY - 10);
        ctx.textAlign = "center";
        ctx.fillText("VENTEO ÓPTIMO (PSI)", barX + (barW * 0.75), barY - 10);
        ctx.textAlign = "right";
        ctx.fillText("SOBREPRESIÓN", barX + barW, barY - 10);

        // Feedback
        if (this.feedbackTimer > 0) {
            ctx.fillStyle = this.feedbackColor;
            ctx.font = "bold 13px 'Share Tech Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(this.feedbackText, w / 2, h - 8);
        }
    }
}

window.PneumothoraxGame = PneumothoraxGame;
