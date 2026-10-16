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
            }
        }

        this.animId = requestAnimationFrame(() => this.scanFrame());
    }

    processRawQR(rawText) {
        // Formato carnet: "https://tvc-orbat.com/medic?token=UID", "UID" o "MED-XXX"
        let token = (rawText || '').trim();
        try {
            if (token.includes('token=')) {
                const url = new URL(token);
                token = url.searchParams.get('token') || token;
            }
        } catch (e) {}

        this.stop();
        this.onScanSuccess(token);
    }
}

window.MedicQRScanner = MedicQRScanner;
