/**
 * Fase 2 - Variante D: Secuencia de Estabilización (Memoria Visual)
 * Mecánica táctica de memorización de secuencias luminosas (estilo Simon militar sin audio).
 * El sanitario observa la secuencia de nodos iluminados y la reproduce en orden exacto.
 */
class MemorySequenceGame {
    constructor(canvas, config, onProgressUpdate, onSuccess, onFail) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const raw = config || {};
        this.config = {
            rondas_totales: Number(raw.rondas_totales) || 5,
            longitud_inicial: Number(raw.longitud_inicial) || 3,
            penalizacion_por_error_pct: Number(raw.penalizacion_por_error_pct) || 16.0,
            tiempo_limite_segundos: Number(raw.tiempo_limite_segundos) || 65
        };

        this.onProgressUpdate = onProgressUpdate || (() => {});
        this.onSuccess = onSuccess || (() => {});
        this.onFail = onFail || (() => {});

        this.isRunning = false;
        this.progress = 0; // 0..100%
        this.animFrameId = null;
        this.lastTime = 0;
        this.elapsedTime = 0;

        // Estado del juego
        this.currentRound = 1;
        this.sequence = []; // Array de índices de nodos [0..3]
        this.playerInputIndex = 0;

        // Modos: 'SHOWING' (reproduciendo secuencia), 'INPUT' (turno del jugador), 'PAUSE'
        this.mode = 'SHOWING';
        this.showTimer = 0;
        this.showStepIndex = -1; // qué paso se está mostrando
        this.activeLitNode = -1; // nodo actualmente encendido

        // 4 Nodos tácticos: A, B, C, D
        this.nodes = [
            { id: 0, label: "ALFA", col: "#00f0ff" },
            { id: 1, label: "BRAVO", col: "#2ecc71" },
            { id: 2, label: "CHARLIE", col: "#e2b938" },
            { id: 3, label: "DELTA", col: "#ff3344" }
        ];

        this.tapRipple = null; // {x, y, timer, success}
        this.feedbackText = "MEMORIZA LA SECUENCIA DE NODOS VITALES";
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
            if (!this.isRunning || this.mode !== 'INPUT') return;
            if (e && e.cancelable) e.preventDefault();

            const rect = this.canvas.getBoundingClientRect();
            const touchX = e.clientX - rect.left;
            const touchY = e.clientY - rect.top;
            this.handleNodeTap(touchX, touchY);
        });

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

    generateSequence(length) {
        const seq = [];
        for (let i = 0; i < length; i++) {
            seq.push(Math.floor(Math.random() * 4));
        }
        return seq;
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.currentRound = 1;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.startRound(this.currentRound);
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    startRound(roundNum) {
        this.currentRound = roundNum;
        const seqLen = this.config.longitud_inicial + (roundNum - 1);
        this.sequence = this.generateSequence(seqLen);
        this.playerInputIndex = 0;
        this.mode = 'SHOWING';
        this.showStepIndex = -1;
        this.activeLitNode = -1;
        this.showTimer = 0.6; // Breve pausa antes de empezar a mostrar
        this.showFeedback(`RONDA [${this.currentRound}/${this.config.rondas_totales}]: MEMORIZA LA SECUENCIA`, "#00f0ff");
    }

    handleNodeTap(touchX, touchY) {
        const nodeIndex = this.getNodeAt(touchX, touchY);
        if (nodeIndex === -1) return;

        const expected = this.sequence[this.playerInputIndex];
        const isCorrect = (nodeIndex === expected);

        this.activeLitNode = nodeIndex;
        setTimeout(() => {
            if (this.activeLitNode === nodeIndex) this.activeLitNode = -1;
        }, 220);

        this.tapRipple = {
            x: touchX,
            y: touchY,
            timer: 0.35,
            success: isCorrect
        };

        if (isCorrect) {
            this.playerInputIndex++;
            if (this.playerInputIndex >= this.sequence.length) {
                // Ronda completada con éxito
                this.progress = Math.min(100, (this.currentRound / this.config.rondas_totales) * 100);
                this.showFeedback(`¡RONDA ${this.currentRound} COMPLETADA!`, "#2ecc71");
                this.onProgressUpdate(this.progress, { round: this.currentRound });

                if (this.currentRound >= this.config.rondas_totales || this.progress >= 100) {
                    this.stop();
                    this.onSuccess({ duration: this.elapsedTime });
                    return;
                }

                // Siguiente ronda tras pausa
                this.mode = 'PAUSE';
                setTimeout(() => {
                    if (this.isRunning) this.startRound(this.currentRound + 1);
                }, 700);
            } else {
                this.showFeedback(`Paso correcto [${this.playerInputIndex}/${this.sequence.length}]`, "#2ecc71");
            }
        } else {
            // Error en la secuencia: reiniciar la ronda actual
            this.progress = Math.max(0, this.progress - this.config.penalizacion_por_error_pct);
            this.showFeedback("¡SECUENCIA ERRÓNEA! REINTENTANDO RONDA...", "#ff3344");
            this.onProgressUpdate(this.progress, { error: true });
            this.mode = 'PAUSE';
            setTimeout(() => {
                if (this.isRunning) this.startRound(this.currentRound);
            }, 900);
        }
    }

    getNodeAt(x, y) {
        const w = this.w || 360;
        const h = this.h || 220;
        const midX = w / 2;
        const midY = (h * 0.52);

        // Nodos 2x2 con márgenes
        if (x < midX - 6 && y > 28 && y < midY - 6) return 0; // Top-Left: ALFA
        if (x > midX + 6 && y > 28 && y < midY - 6) return 1; // Top-Right: BRAVO
        if (x < midX - 6 && y > midY + 6 && y < h - 24) return 2; // Bottom-Left: CHARLIE
        if (x > midX + 6 && y > midY + 6 && y < h - 24) return 3; // Bottom-Right: DELTA

        return -1;
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

        if (this.tapRipple && this.tapRipple.timer > 0) this.tapRipple.timer -= delta;
        if (this.feedbackTimer > 0) this.feedbackTimer -= delta;

        // Lógica de reproducción secuencial visual
        if (this.mode === 'SHOWING') {
            this.showTimer -= delta;
            if (this.showTimer <= 0) {
                if (this.activeLitNode !== -1) {
                    // Apagar nodo y dar breve pausa entre pasos
                    this.activeLitNode = -1;
                    this.showTimer = 0.22;
                } else {
                    // Pasar al siguiente paso de la secuencia
                    this.showStepIndex++;
                    if (this.showStepIndex < this.sequence.length) {
                        this.activeLitNode = this.sequence[this.showStepIndex];
                        this.showTimer = 0.55; // Duración de encendido del nodo
                    } else {
                        // Terminó de mostrar la secuencia: turno del jugador
                        this.mode = 'INPUT';
                        this.activeLitNode = -1;
                        this.showFeedback("¡TU TURNO! REPITE LA SECUENCIA EXACTA", "#2ecc71");
                    }
                }
            }
        }

        this.draw();
        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    draw() {
        const w = this.w || this.canvas.clientWidth || 360;
        const h = this.h || 220;
        const ctx = this.ctx;

        ctx.clearRect(0, 0, w, h);

        // Fondo HUD táctico
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

        // Telemetría superior
        ctx.fillStyle = "#666";
        ctx.font = "9px 'Share Tech Mono', monospace";
        ctx.textAlign = "left";
        const statusLabel = this.mode === 'SHOWING' ? "● MODO OBSERVACIÓN (ATENTO)" : "▶ TU TURNO (PULSA)";
        ctx.fillText(`SECUENCIA VITAL // ${statusLabel}`, 12, 16);

        ctx.textAlign = "right";
        ctx.fillStyle = this.mode === 'INPUT' ? "#2ecc71" : "#00f0ff";
        ctx.fillText(`RONDA: ${this.currentRound}/${this.config.rondas_totales} (${this.playerInputIndex}/${this.sequence.length})`, w - 12, 16);

        // ==================== DIBUJAR LOS 4 CUADRANTES TÁCTICOS (2x2) ====================
        const midX = w / 2;
        const midY = Math.round(h * 0.52);
        const marginX = 14;
        const pad = 6;
        const btnW = (w - (2 * marginX) - (2 * pad)) / 2;
        const topH = (midY - pad) - 26;
        const bottomH = (h - 22) - (midY + pad);

        const rects = [
            { x: marginX, y: 26, w: btnW, h: topH, node: this.nodes[0] }, // ALFA (Top-Left)
            { x: midX + pad, y: 26, w: btnW, h: topH, node: this.nodes[1] }, // BRAVO (Top-Right)
            { x: marginX, y: midY + pad, w: btnW, h: bottomH, node: this.nodes[2] }, // CHARLIE (Bottom-Left)
            { x: midX + pad, y: midY + pad, w: btnW, h: bottomH, node: this.nodes[3] }  // DELTA (Bottom-Right)
        ];

        rects.forEach((r, idx) => {
            const isLit = (this.activeLitNode === idx);
            const col = r.node.col;

            ctx.beginPath();
            ctx.rect(r.x, r.y, r.w, r.h);

            if (isLit) {
                ctx.fillStyle = col;
                ctx.shadowColor = col;
                ctx.shadowBlur = 12;
            } else {
                ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
                ctx.shadowBlur = 0;
            }
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.strokeStyle = isLit ? "#fff" : col;
            ctx.lineWidth = isLit ? 2.5 : 1;
            ctx.stroke();

            // Etiqueta militar del nodo
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = isLit ? "#000" : "#fff";
            ctx.font = "bold 12px 'Orbitron', monospace";
            ctx.fillText(r.node.label, r.x + (r.w / 2), r.y + (r.h / 2) - 4);

            ctx.fillStyle = isLit ? "#111" : col;
            ctx.font = "9px 'Share Tech Mono', monospace";
            ctx.fillText(`NODO 0${idx + 1}`, r.x + (r.w / 2), r.y + (r.h / 2) + 12);
        });

        // Onda expansiva táctica al tocar
        if (this.tapRipple && this.tapRipple.timer > 0) {
            const rip = this.tapRipple;
            const ripProgress = 1 - (rip.timer / 0.35);
            const ripR = 15 + (ripProgress * 45);
            ctx.save();
            ctx.strokeStyle = rip.success ? "rgba(46, 204, 113, 0.85)" : "rgba(255, 51, 68, 0.85)";
            ctx.lineWidth = 2.5;
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
        ctx.fillText(this.feedbackText, w / 2, h - 6);
    }
}

window.MemorySequenceGame = MemorySequenceGame;
