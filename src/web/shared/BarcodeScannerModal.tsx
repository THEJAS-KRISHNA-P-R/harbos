import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, AlertCircle, X } from 'lucide-react';

interface DetectedBarcode {
  readonly rawValue?: string;
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<ReadonlyArray<DetectedBarcode>>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
}

export interface BarcodeScannerModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onScanSuccess: (barcode: string) => void;
  readonly title?: string;
  readonly placeholder?: string;
}

/**
 * Dockside Barcode Scanner Modal with Native BarcodeDetector API frame-detection loop
 * and resilient manual keypad input fallback for wet/sunlit harbour conditions.
 */
export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  title = 'Scan Lot / Vessel QR',
  placeholder = 'e.g. LOT-20261112-001 or IND-KL-01',
}) => {
  const [hasCameraSupport, setHasCameraSupport] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [manualCode, setManualCode] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectTimerRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (detectTimerRef.current !== null) {
      window.clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
  }, []);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'BarcodeDetector' in window &&
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices && 'getUserMedia' in navigator.mediaDevices);
    setHasCameraSupport(Boolean(supported));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setErrorMessage(null);
      setManualCode('');
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, stopCamera]);

  const startCamera = async () => {
    try {
      setErrorMessage(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setIsScanning(true);

        const DetectorCtor = (
          window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }
        ).BarcodeDetector;
        if (DetectorCtor) {
          const detector = new DetectorCtor({
            formats: ['qr_code', 'code_128', 'ean_13'],
          });
          let inFlight = false;
          detectTimerRef.current = window.setInterval(() => {
            const videoEl = videoRef.current;
            if (!videoEl || videoEl.readyState < 2 || inFlight) return;
            inFlight = true;
            detector
              .detect(videoEl)
              .then((barcodes) => {
                const raw = barcodes[0]?.rawValue?.trim();
                if (raw) {
                  stopCamera();
                  onScanSuccess(raw.toUpperCase());
                  onClose();
                }
              })
              .catch((err: unknown) => {
                if (err instanceof Error) {
                  setErrorMessage(`Camera decode error: ${err.message}. Use manual entry.`);
                }
              })
              .finally(() => {
                inFlight = false;
              });
          }, 200);
        }
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'Camera access denied';
      setErrorMessage(`${reason}. Please use manual entry below.`);
      stopCamera();
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim().toUpperCase();
    if (!clean) return;
    stopCamera();
    onScanSuccess(clean);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-modal-title"
      data-testid="barcode-scanner-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="bg-[var(--bg-surface)] rounded-[var(--radius-card)] shadow-xl max-w-md w-full overflow-hidden border border-[var(--border-hair)]">
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--brand)] text-[var(--brand-fg)]">
          <h2 id="scanner-modal-title" className="text-sm font-semibold flex items-center gap-2">
            <Camera className="w-4 h-4 text-[var(--decor-aqua)]" />
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="text-[var(--brand-fg)]/80 hover:text-[var(--brand-fg)] cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {errorMessage && (
            <div className="p-2.5 text-xs bg-[var(--warning-bg)] text-[var(--warning)] border border-[var(--warning)]/40 rounded-[var(--radius-control)] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {hasCameraSupport ? (
            <div className="space-y-3">
              <div className="relative aspect-video bg-[var(--bg-sunken)] rounded-[var(--radius-control)] overflow-hidden flex items-center justify-center border border-[var(--border-hair)]">
                <video
                  ref={videoRef}
                  className={`w-full h-full object-cover ${isScanning ? 'block' : 'hidden'}`}
                  playsInline
                  muted
                />
                {!isScanning && (
                  <button
                    type="button"
                    onClick={startCamera}
                    className="bg-[var(--brand)] text-[var(--brand-fg)] px-4 py-2 rounded-[var(--radius-pill)] text-xs font-semibold hover:bg-[var(--brand-hover)] transition-colors cursor-pointer"
                  >
                    Activate Camera Scan
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-secondary)] bg-[var(--bg-sunken)] p-2.5 rounded-[var(--radius-control)] border border-[var(--border-hair)]">
              Native camera BarcodeDetector not available in this browser. Enter the QR code, vessel registration, or lot number below.
            </div>
          )}

          <form
            onSubmit={handleManualSubmit}
            className="space-y-2 pt-2 border-t border-[var(--border-hair)]"
          >
            <label
              htmlFor="manual-barcode-input"
              className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5"
            >
              <Keyboard className="w-3.5 h-3.5" /> Manual Identifier Entry
            </label>
            <div className="flex gap-2">
              <input
                id="manual-barcode-input"
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={placeholder}
                className="flex-1 px-3 py-1.5 text-xs bg-[var(--bg-sunken)] text-[var(--text-primary)] border border-[var(--border-strong)] rounded-[var(--radius-control)] font-mono-code uppercase focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
                autoFocus
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="bg-[var(--brand)] text-[var(--brand-fg)] px-3.5 py-1.5 text-xs font-semibold rounded-[var(--radius-pill)] disabled:opacity-50 hover:bg-[var(--brand-hover)] cursor-pointer"
              >
                Submit
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
