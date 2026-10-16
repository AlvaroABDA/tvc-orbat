/**
 * TacticalLifeline - Monitor de Telemetría Cardiopulmonar Dinámica
 * Representa el estado hemodinámico y de hemostasia del operador herido en Fase 1.
 * Inicia en rojo con ritmo acelerado / shock crítico y se normaliza
 * progresivamente hacia amarillo, verde y azul a medida que se logran aciertos,
 * frenando el ritmo y la frecuencia de las pulsaciones.
 */
class TacticalLifeline {
    constructor(canvas, labelEl, pctBadgeEl, barFillEl) {
        this.canvas = canvas;
        this.ctx = canvas ? canvas.getContext('2d') : null;
        this.labelEl = labelEl;
        this.pctBadgeEl = pctBadgeEl;
        this.barFillEl = barFillEl;

        this.isRunning = false;
        this.progress = 0; // 0..100 interpolado suavemente
        this.targetProgress = 0;
        this.phase = 0;
        this.lastTime = 0;
        this.animFrameId = null;

        this.w = 360;
        this.h = 48;

        this.setupHiDPI();
    }

    setupHiDPI() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const cssW = rect.width > 0 ? rect.width : 360;
        const cssH = 48;

        this.w = cssW;
        this.h = cssH;
        this.canvas.width = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        if (this.ctx) {
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    start(initialProgress = 0) {
        this.setupHiDPI();
        this.progress = Math.max(0, Math.min(100, Number(initialProgress) || 0));
        this.targetProgress = this.progress;
        this.isRunning = true;
        this.lastTime = performance.now();
        this.updateDOM(this.progress);
        this.loop(this.lastTime);
    }

    stop() {
        this.isRunning = false;
        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
    }

    setProgress(pct) {
        this.targetProgress = Math.max(0, Math.min(100, Number(pct) || 0));
    }

    getColorInfo(pct) {
        // Rojo (0%) -> Amarillo (30%) -> Verde (70%) -> Azul/Cian (100%)
        let r, g, b, hex;
        if (pct < 30) {
            const f = pct / 30; // 0..1
            r = Math.round(255 + (226 - 255) * f);
            g = Math.round(51 + (185 - 51) * f);
            b = Math.round(68 + (56 - 68) * f);
        } else if (pct < 70) {
            const f = (pct - 30) / 40; // 0..1
            r = Math.round(226 + (46 - 226) * f);
            g = Math.round(185 + (204 - 185) * f);
            b = Math.round(56 + (113 - 56) * f);
        } else {
            const f = (pct - 70) / 30; // 0..1
            r = Math.round(46 + (0 - 46) * f);
            g = Math.round(204 + (240 - 204) * f);
            b = Math.round(113 + (255 - 113) * f);
        }
        hex = `rgb(${r}, ${g}, ${b})`;

        // BPM dinámico que decrece con el control de la hemorragia (de 168 a 65 BPM)
        const bpm = Math.round(168 - (pct / 100) * 103);
        let stateText = "SHOCK CRÍTICO";
        if (pct >= 85) {
            stateText = "HEMOSTASIA OK";
        } else if (pct >= 60) {
            stateText = "ESTABILIZADO";
        } else if (pct >= 25) {
            stateText = "TAQUICARDIA";
        }

        return { r, g, b, hex, bpm, stateText };
    }

    updateDOM(pct) {
        const info = this.getColorInfo(pct);

        if (this.labelEl) {
            this.labelEl.textContent = `${info.bpm} BPM • ${info.stateText}`;
            this.labelEl.style.color = info.hex;
        }
        if (this.pctBadgeEl) {
            this.pctBadgeEl.textContent = `${Math.round(this.targetProgress)}%`;
            this.pctBadgeEl.style.color = info.hex;
            this.pctBadgeEl.style.borderColor = info.hex;
        }
        if (this.barFillEl) {
            this.barFillEl.style.width = `${pct}%`;
            this.barFillEl.style.backgroundColor = info.hex;
            this.barFillEl.style.boxShadow = `0 0 6px ${info.hex}`;
        }
    }

    getECGWave(t_cycle, pct) {
        // Posición dentro del ciclo cardíaco [0..1)
        const t = ((t_cycle % 1) + 1) % 1;

        // Ruido/temblor ventricular: alto cuando está crítico, nulo cuando está controlado
        const noiseFactor = Math.max(0, 1 - (pct / 100));
        const noise = (Math.sin(t_cycle * 65) * 0.08 + Math.cos(t_cycle * 113) * 0.06) * noiseFactor;

        if (t < 0.12) {
            return noise;
        } else if (t < 0.22) {
            // Onda P (despolarización auricular)
            const pT = (t - 0.12) / 0.10;
            return Math.sin(pT * Math.PI) * 0.18 + noise;
        } else if (t < 0.28) {
            return noise;
        } else if (t < 0.32) {
            // Onda Q (deflexión negativa inicial)
            const qT = (t - 0.28) / 0.04;
            return -Math.sin(qT * Math.PI) * 0.24 + noise;
        } else if (t < 0.38) {
            // Espiga R (despolarización ventricular masiva)
            const rT = (t - 0.32) / 0.06;
            const rHeight = 1.05 + (noiseFactor * 0.35);
            return Math.sin(rT * Math.PI) * rHeight + noise;
        } else if (t < 0.43) {
            // Onda S (deflexión negativa posterior)
            const sT = (t - 0.38) / 0.05;
            return -Math.sin(sT * Math.PI) * 0.38 + noise;
        } else if (t < 0.52) {
            return noise;
        } else if (t < 0.68) {
            // Onda T (repolarización ventricular)
            const tT = (t - 0.52) / 0.16;
            return Math.sin(tT * Math.PI) * 0.34 + noise;
        } else {
            return noise;
        }
    }

    loop(timestamp) {
        if (!this.isRunning) return;

        const delta = Math.min(0.1, (timestamp - this.lastTime) / 1000);
        this.lastTime = timestamp;

        // Interpolación suave del progreso
        this.progress += (this.targetProgress - this.progress) * Math.min(1.0, delta * 8.0);

        // Frecuencia y ritmo de paso de pulsaciones:
        // A 0%: speedFactor = 2.6 (pasan muy rápido, alto riesgo)
        // A 100%: speedFactor = 0.85 (ritmo frenado, calmado y estable)
        const speedFactor = 2.6 - (this.progress / 100) * 1.75;
        this.phase += delta * speedFactor * 3.8;

        this.updateDOM(this.progress);
        this.draw();

        this.animFrameId = requestAnimationFrame((t) => this.loop(t));
    }

    draw() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const w = this.w || 360;
        const h = this.h || 48;

        ctx.clearRect(0, 0, w, h);

        // Fondo monitor de telemetría CRT
        ctx.fillStyle = "#06090d";
        ctx.fillRect(0, 0, w, h);

        // Rejilla de osciloscopio médica
        ctx.save();
        ctx.strokeStyle = "rgba(0, 240, 255, 0.04)";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 16) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += 12) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // Línea de base cero isoeléctrica
        const midY = h * 0.52;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(0, midY); ctx.lineTo(w, midY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        // Color actual interpolado
        const colorInfo = this.getColorInfo(this.progress);

        // Trazo de la línea de vida ECG
        ctx.save();
        ctx.strokeStyle = colorInfo.hex;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.shadowColor = colorInfo.hex;
        ctx.shadowBlur = 8;

        ctx.beginPath();
        const wavelength = 130; // Ancho en píxeles de un ciclo cardíaco
        let lastY = midY;

        for (let x = 0; x <= w; x += 2) {
            // El tiempo relativo retrocede a medida que nos alejamos del borde derecho
            const t_cycle = this.phase - ((w - x) / wavelength);
            const val = this.getECGWave(t_cycle, this.progress);
            const y = midY - (val * (h * 0.38));
            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            lastY = y;
        }
        ctx.stroke();

        // Perla de barrido / cabezal luminoso en el borde derecho
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = colorInfo.hex;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(w - 2, lastY, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

window.TacticalLifeline = TacticalLifeline;
