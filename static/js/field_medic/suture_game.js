/**
 * Fase 1 - Variante C: Sutura Táctica (Unir Puntos)
 * Mecánica táctica de unión de puntos de sutura continua en orden numérico.
 * El sanitario arrastra el hilo quirúrgico (o pulsa) de un punto al siguiente
 * para aproximar los bordes de la herida y cerrar la laceración.
 */
class SutureGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            puntos_requeridos: Number(raw.puntos_requeridos) || 8,
            radio_objetivo_px: Number(raw.radio_objetivo_px) || 28,
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

        // Puntos de sutura en zigzag a lo largo de los labios de la herida
        this.points = []; // [{ id, num, x, y, isTop }]
        this.currentIndex = 0; // Índice del punto origen activo (0..N-2)
        this.completedStitches = []; // [{ from, to }]

        // Estado del trazo / arrastre del hilo quirúrgico
        this.isDragging = false;
        this.dragX = 0;
        this.dragY = 0;

        this.tapRipple = null; // { x, y, timer, success }
        this.feedbackText = "UNE LOS PUNTOS EN ORDEN: ARRASTRA EL HILO O TOCA EL SIGUIENTE NODO";
        this.feedbackColor = "#00f0ff";
        this.feedbackTimer = 0;

        this.attachEvents();
    }

    attachEvents() {
        if (this._eventsAttached) return;
        this._eventsAttached = true;

        this.canvas.style.touchAction = 'none';
        this.canvas.style.cursor = 'crosshair';

        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        this.canvas.addEventListener('pointerdown', (e) => {
            if (!this.isRunning) return;
            if (e && e.cancelable) e.preventDefault();
            this.canvas.setPointerCapture?.(e.pointerId);

            const pos = getPos(e);
            this.handlePointerDown(pos.x, pos.y);
        });

        this.canvas.addEventListener('pointermove', (e) => {
            if (!this.isRunning || !this.isDragging) return;
            if (e && e.cancelable) e.preventDefault();

            const pos = getPos(e);
            this.handlePointerMove(pos.x, pos.y);
        });

        const endDrag = (e) => {
            if (!this.isRunning || !this.isDragging) return;
            const pos = getPos(e);
            this.handlePointerUp(pos.x, pos.y);
            try { this.canvas.releasePointerCapture?.(e.pointerId); } catch(_) {}
        };

        this.canvas.addEventListener('pointerup', endDrag);
        this.canvas.addEventListener('pointercancel', endDrag);

        window.addEventListener('resize', () => {
            if (this.isRunning) {
                this.setupHiDPI();
                this.recalculatePoints();
            }
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

    recalculatePoints() {
        const w = this.w || 360;
        const h = this.h || 210;
        const count = Math.max(4, this.config.puntos_requeridos || 8);
        const midY = h * 0.48;

        const marginX = 36;
        const availW = w - (2 * marginX);
        const stepX = availW / (count - 1);

        const newPoints = [];
        for (let i = 0; i < count; i++) {
            const isTop = (i % 2 === 0);
            const x = marginX + (i * stepX);
            // Labio superior vs labio inferior de la herida
            const yOffset = isTop ? -32 : 32;
            const yWobble = Math.sin(i * 1.5) * 4;
            const y = midY + yOffset + yWobble;

            newPoints.push({
                id: i,
                num: i + 1,
                x: x,
                y: y,
                isTop: isTop
            });
        }
        this.points = newPoints;
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.recalculatePoints();

        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.completedStitches = [];
        this.currentIndex = 0;
        this.isDragging = false;
        this.tapRipple = null;

        // Si ya venía con progreso previo
        const totalStitches = Math.max(1, this.points.length - 1);
        const precompleted = Math.floor((this.progress / 100) * totalStitches);
        for (let i = 0; i < precompleted; i++) {
            this.completedStitches.push({
                from: this.points[i],
                to: this.points[i + 1]
            });
        }
        this.currentIndex = Math.min(precompleted, totalStitches - 1);

        this.isRunning = true;
        this.lastTime = performance.now();
        this.showFeedback(`UNE EL PUNTO [${this.currentIndex + 1}] AL [${this.currentIndex + 2}]`, "#00f0ff");
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        this.isDragging = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    handlePointerDown(x, y) {
        if (this.currentIndex >= this.points.length - 1) return;

        const curr = this.points[this.currentIndex];
        const next = this.points[this.currentIndex + 1];

        const distToCurr = Math.hypot(x - curr.x, y - curr.y);
        const distToNext = Math.hypot(x - next.x, y - next.y);

        // Tap directo al destino (fallback ultra-accesible)
        if (distToNext <= 38) {
            this.completeStitch();
            return;
        }

        // Iniciar arrastre del hilo desde el nodo activo o cualquier parte cercana
        this.isDragging = true;
        this.dragX = x;
        this.dragY = y;
    }

    handlePointerMove(x, y) {
        this.dragX = x;
        this.dragY = y;

        if (this.currentIndex >= this.points.length - 1) return;
        const next = this.points[this.currentIndex + 1];
        const distToNext = Math.hypot(x - next.x, y - next.y);

        // Si el dedo alcanza el nodo destino mientras arrastra: ¡Enganchar sutura!
        if (distToNext <= 32) {
            this.completeStitch();
            this.isDragging = false;
        }
    }

    handlePointerUp(x, y) {
        if (this.currentIndex >= this.points.length - 1) {
            this.isDragging = false;
            return;
        }
        const next = this.points[this.currentIndex + 1];
        const distToNext = Math.hypot(x - next.x, y - next.y);

        if (distToNext <= 38) {
            this.completeStitch();
        }
        this.isDragging = false;
    }

    completeStitch() {
        if (this.currentIndex >= this.points.length - 1) return;

        const from = this.points[this.currentIndex];
        const to = this.points[this.currentIndex + 1];

        this.completedStitches.push({ from, to });
        this.currentIndex++;

        const totalStitches = this.points.length - 1;
        this.progress = Math.min(100, (this.completedStitches.length / totalStitches) * 100);

        this.tapRipple = {
            x: to.x,
            y: to.y,
            timer: 0.35,
            success: true
        };

        this.onProgressUpdate(this.progress, {
            puntos_completados: this.currentIndex,
            total_puntos: this.points.length
        });

        if (this.completedStitches.length >= totalStitches || this.progress >= 100) {
            this.showFeedback("¡HERIDA SUTURADA CON ÉXITO!", "#2ecc71");
            this.stop();
            this.onSuccess({
                duration: this.elapsedTime,
                puntos: this.points.length
            });
            return;
        }

        this.showFeedback(`¡PUNTADA [${this.completedStitches.length}/${totalStitches}] FIJADA! AHORA UNE AL [${this.currentIndex + 2}]`, "#2ecc71");
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
        const w = this.w || 360;
        const h = this.h || 210;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo táctico militar
        ctx.fillStyle = "#101316";
        ctx.fillRect(0, 0, w, h);

        // Rejilla de fondo
        ctx.strokeStyle = "rgba(255, 255, 255, 0.025)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 22) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 22) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        const midY = h * 0.48;

        // ==================== DIBUJAR LA HERIDA LACERANTE DINÁMICA ====================
        // La herida se va cerrando gradualmente según las puntadas realizadas
        const totalSegments = Math.max(1, this.points.length - 1);
        const marginX = 24;

        // Relleno de tejido herido abierto
        ctx.save();
        ctx.beginPath();
        // Labio superior
        ctx.moveTo(marginX, midY);
        for (let i = 0; i <= 40; i++) {
            const t = i / 40;
            const x = marginX + t * (w - 2 * marginX);
            // Grado de cierre en esta posición X
            const stitchIndexAtX = (x - this.points[0].x) / (this.points[this.points.length - 1].x - this.points[0].x) * totalSegments;
            const isStitched = stitchIndexAtX < this.completedStitches.length;
            const gap = isStitched ? 2.5 : (14 * Math.sin(t * Math.PI));
            const y = midY - gap + (Math.sin(t * 12) * 1.5);
            ctx.lineTo(x, y);
        }
        // Labio inferior
        for (let i = 40; i >= 0; i--) {
            const t = i / 40;
            const x = marginX + t * (w - 2 * marginX);
            const stitchIndexAtX = (x - this.points[0].x) / (this.points[this.points.length - 1].x - this.points[0].x) * totalSegments;
            const isStitched = stitchIndexAtX < this.completedStitches.length;
            const gap = isStitched ? 2.5 : (14 * Math.sin(t * Math.PI));
            const y = midY + gap - (Math.sin(t * 12) * 1.5);
            ctx.lineTo(x, y);
        }
        ctx.closePath();

        const woundGrad = ctx.createLinearGradient(0, midY - 18, 0, midY + 18);
        woundGrad.addColorStop(0, "rgba(180, 20, 30, 0.4)");
        woundGrad.addColorStop(0.5, "rgba(90, 8, 15, 0.95)");
        woundGrad.addColorStop(1, "rgba(180, 20, 30, 0.4)");
        ctx.fillStyle = woundGrad;
        ctx.fill();

        ctx.strokeStyle = "rgba(255, 51, 68, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Línea central de corte
        ctx.strokeStyle = "rgba(40, 5, 8, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(marginX, midY);
        ctx.lineTo(w - marginX, midY);
        ctx.stroke();

        // ==================== DIBUJAR PUNTADAS YA CONSOLIDADAS ====================
        ctx.save();
        for (const st of this.completedStitches) {
            // Sombra del hilo
            ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(st.from.x, st.from.y + 2);
            ctx.lineTo(st.to.x, st.to.y + 2);
            ctx.stroke();

            // Hilo quirúrgico consolidado (Verde neón táctico)
            ctx.strokeStyle = "#2ecc71";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(st.from.x, st.from.y);
            ctx.lineTo(st.to.x, st.to.y);
            ctx.stroke();

            // Nudo quirúrgico central en la cruz
            const knotX = (st.from.x + st.to.x) / 2;
            const knotY = (st.from.y + st.to.y) / 2;
            ctx.fillStyle = "#2ecc71";
            ctx.beginPath();
            ctx.arc(knotX, knotY, 3, 0, Math.PI * 2);
            ctx.fill();

            // Puntos de entrada y salida perforados
            ctx.fillStyle = "#111";
            ctx.strokeStyle = "#2ecc71";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(st.from.x, st.from.y, 4, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            ctx.beginPath();
            ctx.arc(st.to.x, st.to.y, 4, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
        }
        ctx.restore();

        // ==================== GUÍA Y HILO ACTIVO EN ARRASTRE ====================
        const curr = this.points[this.currentIndex];
        const next = this.points[this.currentIndex + 1];

        if (curr && next) {
            // 1. Línea guía discontinua hacia el objetivo
            ctx.save();
            ctx.strokeStyle = "rgba(0, 240, 255, 0.3)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(curr.x, curr.y);
            ctx.lineTo(next.x, next.y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // 2. Si el usuario está arrastrando el hilo
            if (this.isDragging) {
                ctx.save();
                // Hilo elástico activo extendiéndose hacia el dedo
                ctx.strokeStyle = "#00f0ff";
                ctx.lineWidth = 2.5;
                ctx.shadowColor = "#00f0ff";
                ctx.shadowBlur = 8;

                // Curva de catenaria elástica suave
                const midDragX = (curr.x + this.dragX) / 2;
                const midDragY = ((curr.y + this.dragY) / 2) + 6;
                ctx.beginPath();
                ctx.moveTo(curr.x, curr.y);
                ctx.quadraticCurveTo(midDragX, midDragY, this.dragX, this.dragY);
                ctx.stroke();

                // Aguja quirúrgica en el extremo del dedo
                ctx.fillStyle = "#e2b938";
                ctx.beginPath();
                ctx.arc(this.dragX, this.dragY, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 1.5;
                ctx.stroke();

                ctx.restore();
            }
        }

        // ==================== DIBUJAR LOS NODOS NUMERADOS ====================
        const pulse = (Math.sin(this.pulseTime * 5) + 1) * 0.15;

        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const isCompleted = i < this.currentIndex;
            const isOrigin = i === this.currentIndex;
            const isTarget = i === this.currentIndex + 1;

            ctx.save();

            if (isCompleted) {
                // Nodo ya cosido
                ctx.fillStyle = "rgba(46, 204, 113, 0.25)";
                ctx.strokeStyle = "#2ecc71";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();

                ctx.fillStyle = "#2ecc71";
                ctx.font = "bold 9px 'Share Tech Mono', monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("✓", p.x, p.y);
            } else if (isOrigin) {
                // Nodo origen actual (Pulsante Cian)
                const rPulse = 14 + (pulse * 6);
                ctx.strokeStyle = `rgba(0, 240, 255, ${0.4 + pulse})`;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, rPulse, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = "rgba(0, 240, 255, 0.3)";
                ctx.strokeStyle = "#00f0ff";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();

                ctx.fillStyle = "#fff";
                ctx.font = "bold 10px 'Orbitron', monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.num, p.x, p.y);

                // Etiqueta flotante
                ctx.fillStyle = "#00f0ff";
                ctx.font = "8px 'Share Tech Mono', monospace";
                const labelY = p.isTop ? p.y - 20 : p.y + 20;
                ctx.fillText("TIRA AQUÍ", p.x, labelY);
            } else if (isTarget) {
                // Nodo destino actual (Pulsante Verde de destino)
                const rPulse = 14 + (pulse * 8);
                ctx.strokeStyle = `rgba(46, 204, 113, ${0.45 + pulse})`;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(p.x, p.y, rPulse, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = "rgba(46, 204, 113, 0.2)";
                ctx.strokeStyle = "#2ecc71";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();

                ctx.fillStyle = "#2ecc71";
                ctx.font = "bold 10px 'Orbitron', monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.num, p.x, p.y);

                // Etiqueta flotante
                ctx.fillStyle = "#2ecc71";
                ctx.font = "8px 'Share Tech Mono', monospace";
                const labelY = p.isTop ? p.y - 20 : p.y + 20;
                ctx.fillText("DESTINO", p.x, labelY);
            } else {
                // Nodo futuro en espera
                ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
                ctx.strokeStyle = "#444";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
                ctx.fill(); ctx.stroke();

                ctx.fillStyle = "#666";
                ctx.font = "9px 'Share Tech Mono', monospace";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.num, p.x, p.y);
            }

            ctx.restore();
        }

        // ==================== ONDA EXPANSIVA DE ACIERTO ====================
        if (this.tapRipple && this.tapRipple.timer > 0) {
            const rip = this.tapRipple;
            const ripProgress = 1 - (rip.timer / 0.35);
            const ripR = 12 + (ripProgress * 35);
            ctx.save();
            ctx.strokeStyle = "rgba(46, 204, 113, " + (1 - ripProgress) + ")";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(rip.x, rip.y, ripR, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // ==================== TELEMETRÍA SUPERIOR ====================
        ctx.fillStyle = "#888";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("SUTURA TÁCTICA // UNE LOS PUNTOS EN ORDEN", 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = "#00f0ff";
        const totalStitches = Math.max(1, this.points.length - 1);
        ctx.fillText(`PUNTADAS: ${this.completedStitches.length} / ${totalStitches}`, w - 12, 16);

        // Feedback inferior
        ctx.fillStyle = this.feedbackColor;
        ctx.font = "10px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(this.feedbackText, w / 2, h - 8);
    }
}

window.SutureGame = SutureGame;
