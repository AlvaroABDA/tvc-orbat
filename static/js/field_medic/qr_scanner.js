/**
 * Escáner QR de Cámara HTML5 ligero para lectura de carnets de operador.
 * Compatible con la API nativa de BarcodeDetector.
 * Soporta alternancia de cámara frontal/trasera y linterna táctica si el dispositivo lo permite.
 */
class MedicQRScanner {
    constructor(videoElement, onScanSuccess, onScanError) {
        this.video = videoElement;
        this.onScanSuccess = onScanSuccess || (() => {});
        this.onScanError = onScanError || (() => {});
        this.stream = null;
        this.isScanning = false;
        this.barcodeDetector = null;
        this.animId = null;
        this.currentFacingMode = "environment"; // "environment" (trasera) o "user" (frontal)
        this.torchEnabled = false;

        if ('BarcodeDetector' in window) {
            try {
                this.barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {
                this.barcodeDetector = null;
            }
        }
    }

    async start() {
        this.stop();
        try {
            const constraints = {
                video: {
                    facingMode: { ideal: this.currentFacingMode },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            await this.video.play();
            this.isScanning = true;
            this.scanFrame();
        } catch (err) {
            console.error("Error iniciando cámara médica:", err);
            // Reintento con restricciones relajadas si falla
            try {
                this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                this.video.srcObject = this.stream;
                await this.video.play();
                this.isScanning = true;
                this.scanFrame();
            } catch (err2) {
                this.onScanError("No se pudo acceder a la cámara del dispositivo.");
            }
        }
    }

    stop() {
        this.isScanning = false;
        if (this.animId) {
            cancelAnimationFrame(this.animId);
            this.animId = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.torchEnabled = false;
    }

    async toggleCamera() {
        this.currentFacingMode = (this.currentFacingMode === "environment") ? "user" : "environment";
        await this.start();
        return this.currentFacingMode;
    }

    async toggleTorch() {
        if (!this.stream) return false;
        const track = this.stream.getVideoTracks()[0];
        if (!track) return false;

        const capabilities = track.getCapabilities ? track.getCapabilities() : {};
        if (!capabilities.torch) {
            return false;
        }

        try {
            this.torchEnabled = !this.torchEnabled;
            await track.applyConstraints({
                advanced: [{ torch: this.torchEnabled }]
            });
            return this.torchEnabled;
        } catch (e) {
            console.warn("No se pudo conmutar la linterna táctica:", e);
            return false;
        }
    }

    async scanFrame() {
        if (!this.isScanning) return;

        if (this.video.readyState === this.video.HAVE_ENOUGH_DATA) {
            if (this.barcodeDetector) {
                try {
                    const barcodes = await this.barcodeDetector.detect(this.video);
                    if (barcodes.length > 0) {
                        const raw = barcodes[0].rawValue;
                        this.processRawQR(raw);
                        return;
                    }
                } catch (e) {}
            } else if (window.jsQR) {
                try {
                    if (!this.canvas) {
                        this.canvas = document.createElement('canvas');
                        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
                    }
                    const w = this.video.videoWidth;
                    const h = this.video.videoHeight;
                    if (w > 0 && h > 0) {
                        this.canvas.width = w;
                        this.canvas.height = h;
                        this.ctx.drawImage(this.video, 0, 0, w, h);
                        const imgData = this.ctx.getImageData(0, 0, w, h);
                        const code = window.jsQR(imgData.data, imgData.width, imgData.height, {
                            inversionAttempts: "dontInvert"
                        });
                        if (code && code.data) {
                            this.processRawQR(code.data);
                            return;
                        }
                    }
                } catch (e) {}
            }
        }

        this.animId = requestAnimationFrame(() => this.scanFrame());
    }

    processRawQR(rawText) {
        // Formato carnet: "https://tvc-orbat.com/medic?token=UID", "UID", "MED-XXX", etc.
        let token = (rawText || '').trim();
        try {
            if (token.includes('token=')) {
                const match = token.match(/[?&]token=([a-zA-Z0-9_-]+)/i);
                if (match) {
                    token = match[1];
                } else {
                    const url = new URL(token.startsWith('http') ? token : 'http://dummy/' + token);
                    token = url.searchParams.get('token') || token;
                }
            } else if (token.includes('/')) {
                const parts = token.split(/[?#]/)[0].split('/');
                const last = parts[parts.length - 1];
                if (last && last.length >= 4) {
                    token = last;
                }
            }
        } catch (e) {}

        this.stop();
        this.onScanSuccess(token);
    }
}

window.MedicQRScanner = MedicQRScanner;
