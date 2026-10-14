/**
 * Fase 1 Alternativa: Neumotórax a Tensión / Punción Torácica (Needle Decompression)
 * Mecánica táctica de "Mantener y Soltar" directamente sobre la pantalla táctil.
 * La ventana objetivo de descompresión (sector verde) es variable y cambia de posición en cada intento.
 */
class PneumothoraxGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        
        const raw = config || {};
        this.config = {
            velocidad_carga: Number(raw.velocidad_carga) || 75.0,
            zona_valvula_min: Number(raw.zona_valvula_min !== undefined ? raw.zona_valvula_min : raw.zona_descompresion_min_pct) || 60.0,
            zona_valvula_max: Number(raw.zona_valvula_max !== undefined ? raw.zona_valvula_max : raw.zona_descompresion_max_pct) || 82.0,
            aciertos_requeridos: Number(raw.aciertos_requeridos) || 4,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 15.0,
            progreso_por_acierto_pct: Number(raw.progreso_por_acierto_pct) || 25.0,
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

        // Estado del catéter / Válvula: Carga de 0 a 100 PSI
        this.charge = 0;
        this.isHolding = false;
        this.pulseTime = 0;

        // Ventana objetivo dinámica y variable
        this.targetMin = this.config.zona_valvula_min;
        this.targetMax = this.config.zona_valvula_max;

        this.feedbackText = "MANTÉN PULSADO EL CÍRCULO CENTRAL Y SUELTA EN EL SECTOR VERDE";
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
            this.startHold();
        };

        const onEnd = (e) => {
            if (!this.isRunning) return;
            if (e && e.cancelable) e.preventDefault();
            this.releaseHold();
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
        const cssH = 220; // Proporción calibrada para pantalla móvil vertical
        
        this.w = cssW;
        this.h = cssH;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    repositionTarget() {
        // Ventana de presión variable: ancho base configurado (~18-22%)
        const baseWidth = (this.config.zona_valvula_max - this.config.zona_valvula_min) || 20;
        // Variación sutil de +-3% en el ancho de la ventana
        const widthVariation = (Math.random() * 6) - 3;
        const targetWidth = Math.max(14, Math.min(26, baseWidth + widthVariation));

        // Rango disponible en el manómetro: entre 30% y 88%
        const minPossible = 30;
        const maxPossible = 90 - targetWidth;
        
        let newMin;
        let attempts = 0;
        do {
            newMin = Math.round(minPossible + (Math.random() * (maxPossible - minPossible)));
            attempts++;
        } while (attempts < 6 && this.targetMin !== undefined && Math.abs(newMin - this.targetMin) < 14);

        this.targetMin = newMin;
        this.targetMax = Math.round(newMin + targetWidth);
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.charge = 0;
        this.isHolding = false;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.repositionTarget(); // Posición y margen dinámico inicial
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
        this.feedbackColor = "#e2b938";
    }

    releaseHold() {
        if (!this.isRunning || !this.isHolding) return;
        this.isHolding = false;

        const currentCharge = Number(this.charge) || 0;
        const inTarget = (currentCharge >= this.targetMin && currentCharge <= this.targetMax);

        if (inTarget) {
            this.progress = Math.min(100, this.progress + this.config.progreso_por_acierto_pct);
            this.showFeedback("¡DESCOMPRESIÓN EXITOSA! AIRE LIBERADO", "#2ecc71");
            this.repositionTarget(); // Cambiar sector y margen dinámicamente al acertar
            this.onProgressUpdate(this.progress, { hit: true, charge: currentCharge });

            if (this.progress >= 100) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
                return;
            }
        } else {
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            if (currentCharge < this.targetMin) {
                this.showFeedback("¡PRESIÓN INSUFICIENTE (SOLTADO PRONTO)!", "#ff3344");
            } else {
                this.showFeedback("¡SOBREPRESIÓN / DAÑO TISULAR!", "#ff3344");
            }
            this.repositionTarget(); // Reubicar la ventana también al fallar
            this.onProgressUpdate(this.progress, { hit: false, charge: currentCharge });
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

        const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
        this.lastTime = timestamp;
        this.elapsedTime += delta;
        this.pulseTime += delta;

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
        const w = this.w || this.canvas.clientWidth || 360;
        const h = this.h || 220;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo HUD táctico ORBAT
        ctx.fillStyle = "#121212";
        ctx.fillRect(0, 0, w, h);

        // Rejilla técnica sutil de fondo
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
        ctx.fillText(`VENTANA PLEURAL: ${this.targetMin}-${this.targetMax} PSI`, 12, 16);

        const currentCharge = Math.min(100, Math.max(0, this.charge || 0));
        const inZone = (currentCharge >= this.targetMin && currentCharge <= this.targetMax);
        const overZone = currentCharge > this.targetMax;

        ctx.textAlign = "right";
        ctx.fillStyle = inZone ? "#2ecc71" : (overZone ? "#ff3344" : "#888");
        ctx.fillText(this.isHolding ? `PRESIÓN: ${Math.round(currentCharge)} PSI` : "CATÉTER LISTO", w - 12, 16);

        const centerX = w / 2;
        const centerY = h * 0.49;
        const radius = Math.min(centerX - 35, h * 0.38);

        // Arco base de manómetro (210 grados)
        const startAngle = Math.PI * 0.8;
        const endAngle = Math.PI * 2.2;
        const totalAngle = endAngle - startAngle;

        ctx.lineWidth = 10;
        ctx.lineCap = "butt"; // Estilo militar recto

        // Fondo del arco
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.stroke();

        // Sector Verde Objetivo Variable (Ventana de Punción dinámica)
        const t1 = startAngle + (this.targetMin / 100 * totalAngle);
        const t2 = startAngle + (this.targetMax / 100 * totalAngle);
        ctx.strokeStyle = "rgba(46, 204, 113, 0.45)";
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, t1, t2);
        ctx.stroke();

        // Marcas de límites del sector verde
        ctx.strokeStyle = "#2ecc71";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, t1, t2);
        ctx.stroke();

        // Arco de Carga (Dinámico al mantener pulsado)
        if (currentCharge > 0) {
            const currentAngle = startAngle + (currentCharge / 100 * totalAngle);
            ctx.strokeStyle = overZone ? "#ff3344" : (inZone ? "#2ecc71" : "#00f0ff");
            ctx.lineWidth = 12;
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, startAngle, currentAngle);
            ctx.stroke();
        }

        // ==================== CÍRCULO SUTIL TÁCTICO DE PULSACIÓN ====================
        const innerRadius = Math.min(radius * 0.55, 48);

        let circleStroke = "rgba(0, 240, 255, 0.25)";
        let circleFill = "rgba(0, 0, 0, 0.5)";

        if (this.isHolding) {
            if (overZone) {
                circleStroke = "#ff3344";
                circleFill = "rgba(255, 51, 68, 0.15)";
            } else if (inZone) {
                circleStroke = "#2ecc71";
                circleFill = "rgba(46, 204, 113, 0.2)";
            } else {
                circleStroke = "#e2b938";
                circleFill = "rgba(226, 185, 56, 0.15)";
            }
        } else {
            // Pulso sutil para llamar la atención del dedo
            const pulse = (Math.sin(this.pulseTime * 3) + 1) * 0.15;
            circleStroke = `rgba(0, 240, 255, ${0.2 + pulse})`;
        }

        // Círculo central base
        ctx.beginPath();
        ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
        ctx.fillStyle = circleFill;
        ctx.fill();
        ctx.strokeStyle = circleStroke;
        ctx.lineWidth = this.isHolding ? 2 : 1;
        ctx.stroke();

        // Miras / Cruces sutiles en los 4 ejes
        ctx.strokeStyle = circleStroke;
        ctx.lineWidth = 1;
        const markLen = 6;
        // Norte
        ctx.beginPath(); ctx.moveTo(centerX, centerY - innerRadius - markLen); ctx.lineTo(centerX, centerY - innerRadius + 2); ctx.stroke();
        // Sur
        ctx.beginPath(); ctx.moveTo(centerX, centerY + innerRadius - 2); ctx.lineTo(centerX, centerY + innerRadius + markLen); ctx.stroke();
        // Este
        ctx.beginPath(); ctx.moveTo(centerX + innerRadius - 2, centerY); ctx.lineTo(centerX + innerRadius + markLen, centerY); ctx.stroke();
        // Oeste
        ctx.beginPath(); ctx.moveTo(centerX - innerRadius - markLen, centerY); ctx.lineTo(centerX - innerRadius + 2, centerY); ctx.stroke();

        // Anillo de expansión sutil al mantener pulsado
        if (this.isHolding) {
            const rippleR = innerRadius + (currentCharge % 15);
            ctx.strokeStyle = circleStroke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(centerX, centerY, rippleR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Textos del centro táctico
        ctx.textAlign = "center";
        if (this.isHolding) {
            ctx.fillStyle = inZone ? "#2ecc71" : (overZone ? "#ff3344" : "#fff");
            ctx.font = "bold 18px 'Orbitron', monospace";
            ctx.fillText(`${Math.round(currentCharge)} PSI`, centerX, centerY - 2);

            ctx.fillStyle = inZone ? "#2ecc71" : "#aaa";
            ctx.font = "9px 'Share Tech Mono', monospace";
            ctx.fillText(inZone ? "¡SUELTA AHORA!" : "CARGANDO...", centerX, centerY + 14);
        } else {
            ctx.fillStyle = "#fff";
            ctx.font = "bold 11px 'Orbitron', monospace";
            ctx.fillText("MANTÉN", centerX, centerY - 5);

            ctx.fillStyle = "#888";
            ctx.font = "9px 'Share Tech Mono', monospace";
            ctx.fillText("PULSADO", centerX, centerY + 8);

            ctx.fillStyle = "rgba(0, 240, 255, 0.6)";
            ctx.font = "8px 'Share Tech Mono', monospace";
            ctx.fillText("VÁLVULA", centerX, centerY + 19);
        }

        // Línea de feedback inferior
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillText(this.feedbackText, centerX, h - 8);
    }
}

window.PneumothoraxGame = PneumothoraxGame;
