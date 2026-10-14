/**
 * Fase 1 Alternativa: Neumotórax a Tensión / Punción Torácica (Needle Decompression)
 * Mecánica de "Mantener y Soltar" (Hold to Charge & Release in Target) en Dial Circular.
 * El sanitario mantiene pulsado para presurizar el catéter y suelta exactamente dentro del sector verde.
 */
class PneumothoraxGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config || {
            velocidad_carga: 75.0, // % por segundo al mantener pulsado
            zona_valvula_min: 68.0,
            zona_valvula_max: 88.0,
            aciertos_requeridos: 3,
            penalizacion_por_error_pct: 20.0,
            progreso_por_acierto_pct: 34.0,
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

        // Estado del catéter / Válvula: Carga de 0 a 100
        this.charge = 0;
        this.isHolding = false;
        this.holdStartTime = 0;

        this.feedbackText = "MANTÉN PULSADO PARA CARGAR CATÉTER Y SUELTA EN EL SECTOR VERDE";
        this.feedbackColor = "#aaa";
        this.feedbackTimer = 0;
    }

    start(initialProgress = 0) {
        this.progress = Math.max(0, Math.min(100, initialProgress));
        this.charge = 0;
        this.isHolding = false;
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

    startHold() {
        if (!this.isRunning) return;
        this.isHolding = true;
        this.charge = 0;
        this.feedbackText = "CARGANDO PRESIÓN DEL CATÉTER...";
        this.feedbackColor = "#ffaa00";
    }

    releaseHold() {
        if (!this.isRunning || !this.isHolding) return;
        this.isHolding = false;

        const inTarget = (this.charge >= this.config.zona_valvula_min && this.charge <= this.config.zona_valvula_max);

        if (inTarget) {
            this.progress = Math.min(100, this.progress + this.config.progreso_por_acierto_pct);
            this.showFeedback("¡PUNCIÓN EXITOSA! AIRE LIBERADO", "#2ecc71");
            this.onProgressUpdate(this.progress, { hit: true, charge: this.charge });

            if (this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
                return;
            }
        } else {
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            if (this.charge < this.config.zona_valvula_min) {
                this.showFeedback("¡PRESIÓN INSUFICIENTE (SOLTADO PRONTO)!", "#ff3344");
            } else {
                this.showFeedback("¡SOBREPRESIÓN / DAÑO TISULAR!", "#ff3344");
            }
            this.onProgressUpdate(this.progress, { hit: false, charge: this.charge });
        }

        this.charge = 0;
    }

    showFeedback(text, color) {
        this.feedbackText = text;
        this.feedbackColor = color;
        this.feedbackTimer = 1.2;
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;
        this.elapsedTime += delta;

        if (this.isHolding) {
            this.charge += this.config.velocidad_carga * delta;
            if (this.charge > 105) {
                // Se pasó de rosca por mantener demasiado
                this.releaseHold();
            }
        } else if (this.charge > 0) {
            this.charge = Math.max(0, this.charge - (150 * delta));
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

        // Fondo HUD táctico circular
        ctx.fillStyle = "#06090d";
        ctx.fillRect(0, 0, w, h);

        const centerX = w / 2;
        const centerY = h * 0.52;
        const radius = Math.min(centerX - 30, h * 0.42);

        // Arco base de manómetro (210 grados)
        const startAngle = Math.PI * 0.8;
        const endAngle = Math.PI * 2.2;
        const totalAngle = endAngle - startAngle;

        ctx.lineWidth = 14;
        ctx.lineCap = "round";

        // Fondo del arco
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.stroke();

        // Sector Verde Objetivo (Ventana de Punción)
        const t1 = startAngle + (this.config.zona_valvula_min / 100 * totalAngle);
        const t2 = startAngle + (this.config.zona_valvula_max / 100 * totalAngle);
        ctx.strokeStyle = "rgba(46, 204, 113, 0.5)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, t1, t2);
        ctx.stroke();

        // Arco de Carga (Dinámico al mantener pulsado)
        if (this.charge > 0) {
            const currentAngle = startAngle + (Math.min(100, this.charge) / 100 * totalAngle);
            ctx.strokeStyle = this.charge > this.config.zona_valvula_max ? "#ff3344" : 
                              (this.charge >= this.config.zona_valvula_min ? "#2ecc71" : "#00f0ff");
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, currentAngle);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Centro: Indicador numérico de presión y catéter
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 20px 'Orbitron', sans-serif";
        ctx.fillText(`${Math.min(100, Math.round(this.charge))}%`, centerX, centerY - 2);

        ctx.fillStyle = "#888";
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillText("PRESIÓN CATÉTER (PSI)", centerX, centerY + 16);

        // Feedback Text
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "11px 'Share Tech Mono', monospace";
        ctx.fillText(this.feedbackText, centerX, h - 8);
    }
}

window.PneumothoraxGame = PneumothoraxGame;
