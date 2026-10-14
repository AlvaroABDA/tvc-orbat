/**
 * Fase 1 - Variante B: Torniquete con Objetivo Circular Táctico
 * Mecánica táctica de precisión angular y sincronización.
 * Permite pulsar en cualquier parte de la pantalla cuando el haz de barrido coincide con el sector objetivo,
 * o pulsar directamente sobre el sector verde del torniquete.
 */
class TourniquetGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            segmentos_totales: Number(raw.segmentos_totales) || 8,
            aciertos_requeridos: Number(raw.aciertos_requeridos) || 4,
            velocidad_rotacion_segundos: Number(raw.velocidad_rotacion_segundos) || 2.4,
            tolerancia_grados: Number(raw.tolerancia_grados) || 12.0,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 8.0,
            progreso_por_acierto_pct: Number(raw.progreso_por_acierto_pct) || 25.0,
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

        // Estado cinemático angular continuo
        this.sweepAngle = -Math.PI / 2; // Inicia en la cúspide (arriba)
        this.rotSpeed = (Math.PI * 2) / Math.max(0.8, this.config.velocidad_rotacion_segundos);

        this.activeSegment = 0;
        this.targetSegment = 0;

        this.hitStreak = 0;
        this.hitsCount = 0;
        this.lastTapTime = 0;

        this.windlassAngle = 0;
        this.targetWindlassAngle = 0;

        this.pulseTime = 0;
        this.tapRippleTime = 0;
        this.lastTapSuccess = false;

        this.feedbackText = "TOCA CUANDO EL HAZ COINCIDA CON EL SECTOR VERDE";
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
            this.triggerTap(e);
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
        this.hitsCount = Math.round((this.progress / 100) * this.config.aciertos_requeridos);
        this.hitStreak = 0;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.sweepAngle = -Math.PI / 2;
        this.targetSegment = Math.floor(Math.random() * this.config.segmentos_totales);
        this.windlassAngle = (this.hitsCount * (Math.PI / 2));
        this.targetWindlassAngle = this.windlassAngle;
        this.lastTapTime = 0;
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    getTargetCenterAngle() {
        const total = this.config.segmentos_totales;
        const segAngle = (Math.PI * 2) / total;
        return (this.targetSegment * segAngle) - (Math.PI / 2) + (segAngle / 2);
    }

    isSweepInTargetZone() {
        const total = this.config.segmentos_totales;
        const segHalf = ((Math.PI * 2) / total) / 2;
        const tolRad = (this.config.tolerancia_grados * Math.PI) / 180;
        const targetA = this.getTargetCenterAngle();

        // Diferencia angular normalizada [-PI, PI]
        const diff = Math.atan2(Math.sin(this.sweepAngle - targetA), Math.cos(this.sweepAngle - targetA));
        return Math.abs(diff) <= (segHalf + tolRad);
    }

    triggerTap(e) {
        if (!this.isRunning) return;

        const now = performance.now();
        if (now - this.lastTapTime < 160) return; // Debounce anti-rebote táctil
        this.lastTapTime = now;

        this.tapRippleTime = 0.35;

        // Comprobación 1: El haz continuo está dentro del sector objetivo (+ margen de tolerancia generoso)
        let isHit = this.isSweepInTargetZone();

        // Comprobación 2: El índice discreto activo coincide directamente
        if (!isHit && this.activeSegment === this.targetSegment) {
            isHit = true;
        }

        // Comprobación 3: Pulsación directa con el dedo sobre el área física del sector verde en el canvas
        if (!isHit && e && e.clientX !== undefined) {
            const rect = this.canvas.getBoundingClientRect();
            const tx = e.clientX - rect.left;
            const ty = e.clientY - rect.top;
            const centerX = (this.w || 360) / 2;
            const centerY = Math.round((this.h || 210) * 0.49);
            const dx = tx - centerX;
            const dy = ty - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const outerR = Math.min(centerX - 40, (this.h || 210) * 0.36);
            const innerR = outerR * 0.52;

            if (dist >= innerR * 0.6 && dist <= outerR * 1.4) {
                const tapAngle = Math.atan2(dy, dx);
                const targetA = this.getTargetCenterAngle();
                const total = this.config.segmentos_totales;
                const segHalf = ((Math.PI * 2) / total) / 2;
                const tolRad = (this.config.tolerancia_grados * Math.PI) / 180;
                const tapDiff = Math.abs(Math.atan2(Math.sin(tapAngle - targetA), Math.cos(tapAngle - targetA)));

                // Si tocó el sector verde o el haz estaba a menos de 65° del objetivo
                if (tapDiff <= segHalf + tolRad) {
                    const sweepDiff = Math.abs(Math.atan2(Math.sin(this.sweepAngle - targetA), Math.cos(this.sweepAngle - targetA)));
                    if (sweepDiff <= 1.2) {
                        isHit = true;
                    }
                }
            }
        }

        this.lastTapSuccess = isHit;

        if (isHit) {
            this.hitStreak++;
            this.hitsCount++;
            this.progress = Math.min(100, (this.hitsCount / this.config.aciertos_requeridos) * 100);
            this.targetWindlassAngle += Math.PI / 2; // Giro de 90° de la barra de molinete táctico
            this.showFeedback(`¡APRIETE VÁLIDO! (${this.hitsCount}/${this.config.aciertos_requeridos})`, "#2ecc71");

            // Reubicar sector objetivo al menos 2 sectores adelante
            const advance = 2 + Math.floor(Math.random() * Math.max(1, this.config.segmentos_totales - 3));
            this.targetSegment = (this.targetSegment + advance) % this.config.segmentos_totales;

            this.onProgressUpdate(this.progress, { hit: true, streak: this.hitStreak, hits: this.hitsCount });

            if (this.progress >= 100 || this.hitsCount >= this.config.aciertos_requeridos) {
                this.stop();
                this.onSuccess({ duration: this.elapsedTime });
            }
        } else {
            this.hitStreak = 0;
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.hitsCount = Math.max(0, Math.floor((this.progress / 100) * this.config.aciertos_requeridos));
            this.showFeedback("¡DESFASE! SINCRONICE CON EL SECTOR VERDE", "#ff3344");
            this.onProgressUpdate(this.progress, { hit: false, errors: 1 });
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

        // Giro cinético del haz de barrido continuo
        this.sweepAngle = (this.sweepAngle + this.rotSpeed * delta);
        if (this.sweepAngle > Math.PI) {
            this.sweepAngle -= Math.PI * 2;
        }

        // Determinar qué segmento cubre el haz actualmente
        const total = this.config.segmentos_totales;
        const normalized = (this.sweepAngle - (-Math.PI / 2) + Math.PI * 4) % (Math.PI * 2);
        this.activeSegment = Math.floor((normalized / (Math.PI * 2)) * total) % total;

        // Suavizar giro de la barra del molinete
        this.windlassAngle += (this.targetWindlassAngle - this.windlassAngle) * 0.25;

        if (this.tapRippleTime > 0) this.tapRippleTime -= delta;
        if (this.feedbackTimer > 0) this.feedbackTimer -= delta;

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

        // Rejilla CRT militar
        ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 20) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        const isMatchNow = this.isSweepInTargetZone();

        // Telemetría superior
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(`TORNIQUETE TÁCTICO // SECTOR OBJ: [${this.targetSegment + 1}/${this.config.segmentos_totales}]`, 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = isMatchNow ? "#2ecc71" : "#e2b938";
        ctx.fillText(`MOLINETE: ${this.hitsCount} / ${this.config.aciertos_requeridos}`, w - 12, 16);

        // ==================== CÍRCULO CON SEGMENTOS ANGULARES ====================
        const centerX = w / 2;
        const centerY = Math.round(h * 0.49);
        const outerR = Math.min(centerX - 40, h * 0.36);
        const innerR = outerR * 0.52;
        const totalSegs = this.config.segmentos_totales;
        const segAngle = (Math.PI * 2) / totalSegs;
        const gap = 0.06; // Separación angular entre sectores tácticos

        for (let i = 0; i < totalSegs; i++) {
            const startA = (i * segAngle) - (Math.PI / 2) + (gap / 2);
            const endA = ((i + 1) * segAngle) - (Math.PI / 2) - (gap / 2);

            const isCurrentActive = (this.activeSegment === i);
            const isTarget = (this.targetSegment === i);

            ctx.beginPath();
            ctx.arc(centerX, centerY, outerR, startA, endA);
            ctx.arc(centerX, centerY, innerR, endA, startA, true);
            ctx.closePath();

            if (isTarget && isMatchNow) {
                // Coincidencia óptima instantánea -> Verde brillante destacado
                ctx.fillStyle = "rgba(46, 204, 113, 0.85)";
                ctx.strokeStyle = "#2ecc71";
                ctx.lineWidth = 2.5;
            } else if (isTarget) {
                // Sector objetivo en espera con halo verde táctico
                const pulse = (Math.sin(this.pulseTime * 4) + 1) * 0.15;
                ctx.fillStyle = `rgba(46, 204, 113, ${0.28 + pulse})`;
                ctx.strokeStyle = `rgba(46, 204, 113, ${0.6 + pulse})`;
                ctx.lineWidth = 2.0;
            } else if (isCurrentActive) {
                // Haz pasando por sector no objetivo -> Cian militar
                ctx.fillStyle = "rgba(0, 240, 255, 0.45)";
                ctx.strokeStyle = "#00f0ff";
                ctx.lineWidth = 1.5;
            } else {
                // Sector pasivo en reposo
                ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
                ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
                ctx.lineWidth = 1;
            }

            ctx.fill();
            ctx.stroke();
        }

        // ==================== LÍNEA DE BARRIDO RADAR CONTINUA ====================
        ctx.save();
        ctx.strokeStyle = isMatchNow ? "#2ecc71" : "#00f0ff";
        ctx.lineWidth = isMatchNow ? 3.0 : 2.0;
        ctx.shadowColor = isMatchNow ? "#2ecc71" : "#00f0ff";
        ctx.shadowBlur = isMatchNow ? 10 : 6;

        ctx.beginPath();
        const beamStartX = centerX + Math.cos(this.sweepAngle) * (innerR - 2);
        const beamStartY = centerY + Math.sin(this.sweepAngle) * (innerR - 2);
        const beamEndX = centerX + Math.cos(this.sweepAngle) * (outerR + 5);
        const beamEndY = centerY + Math.sin(this.sweepAngle) * (outerR + 5);
        ctx.moveTo(beamStartX, beamStartY);
        ctx.lineTo(beamEndX, beamEndY);
        ctx.stroke();
        ctx.restore();

        // ==================== CÍRCULO CENTRAL DE PULSACIÓN ====================
        const centerR = innerR * 0.85;

        // Onda expansiva táctica al tocar
        if (this.tapRippleTime > 0) {
            const ripProgress = 1 - (this.tapRippleTime / 0.35);
            const ripR = centerR + (ripProgress * 40);
            ctx.save();
            ctx.strokeStyle = this.lastTapSuccess ? "rgba(46, 204, 113, 0.85)" : "rgba(255, 51, 68, 0.85)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, ripR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.beginPath();
        ctx.arc(centerX, centerY, centerR, 0, Math.PI * 2);
        ctx.fillStyle = isMatchNow ? "rgba(46, 204, 113, 0.28)" : "rgba(0, 0, 0, 0.65)";
        ctx.fill();
        ctx.strokeStyle = isMatchNow ? "#2ecc71" : "rgba(0, 240, 255, 0.4)";
        ctx.lineWidth = isMatchNow ? 2.5 : 1.5;
        ctx.stroke();

        // Barra del Molinete Táctico Giratorio
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(this.windlassAngle);
        const rodLen = centerR * 1.35;
        const rodH = 6;
        ctx.fillStyle = isMatchNow ? "#2ecc71" : "#555555";
        ctx.strokeStyle = isMatchNow ? "#a8f5c4" : "#222222";
        ctx.lineWidth = 1;
        ctx.fillRect(-rodLen / 2, -rodH / 2, rodLen, rodH);
        ctx.strokeRect(-rodLen / 2, -rodH / 2, rodLen, rodH);

        // Empuñaduras moleteadas
        ctx.fillStyle = isMatchNow ? "#ffffff" : "#888888";
        ctx.fillRect(-rodLen / 2 - 2, -rodH, 4, rodH * 2);
        ctx.fillRect(rodLen / 2 - 2, -rodH, 4, rodH * 2);
        ctx.restore();

        // Miras en cruz táctica
        const markLen = 5;
        ctx.strokeStyle = isMatchNow ? "#2ecc71" : "rgba(0, 240, 255, 0.6)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - centerR - markLen); ctx.lineTo(centerX, centerY - centerR + 2);
        ctx.moveTo(centerX, centerY + centerR - 2); ctx.lineTo(centerX, centerY + centerR + markLen);
        ctx.moveTo(centerX + centerR - 2, centerY); ctx.lineTo(centerX + centerR + markLen, centerY);
        ctx.moveTo(centerX - centerR - markLen, centerY); ctx.lineTo(centerX - centerR + 2, centerY);
        ctx.stroke();

        // Textos dentro del círculo central
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isMatchNow ? "#2ecc71" : "#ffffff";
        ctx.font = "bold 10px 'Orbitron', monospace";
        ctx.fillText(isMatchNow ? "¡APRIETA!" : "MOLINETE", centerX, centerY - 6);

        ctx.fillStyle = isMatchNow ? "#a8f5c4" : "#aaaaaa";
        ctx.font = "8px 'Share Tech Mono', monospace";
        ctx.fillText(isMatchNow ? "TOCA AHORA" : "SINCRONIZANDO", centerX, centerY + 8);

        // Feedback Text inferior
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.fillText(this.feedbackText, centerX, h - 8);
    }
}

window.TourniquetGame = TourniquetGame;
