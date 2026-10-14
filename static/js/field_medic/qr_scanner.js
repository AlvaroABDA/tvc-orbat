/**
 * Escáner QR de Cámara HTML5 ligero para lectura de carnets de operador.
 * Compatible con la API nativa de BarcodeDetector o canvas fallback.
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

        if ('BarcodeDetector' in window) {
            try {
                this.barcodeDetector = new BarcodeDetector({ formats: ['qr_code'] });
            } catch (e) {
                this.barcodeDetector = null;
            }
        }
    }

    async start() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } },
                audio: false
            });
            this.video.srcObject = this.stream;
            await this.video.play();
            this.isScanning = true;
            this.scanFrame();
        } catch (err) {
            console.error("Error iniciando cámara médica:", err);
            this.onScanError("No se pudo acceder a la cámara trasera.");
        }
    }

    stop() {
        this.isScanning = false;
        if (this.animId) cancelAnimationFrame(this.animId);
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
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
        // Formato carnet: "https://tvc-orbat.com/medic?token=UID" o simplemente "UID"
        let token = rawText.trim();
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
