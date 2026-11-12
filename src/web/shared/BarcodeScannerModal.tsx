import React, { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, AlertCircle, X } from 'lucide-react';

export interface BarcodeScannerModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onScanSuccess: (barcode: string) => void;
  readonly title?: string;
}

/**
 * Dockside Barcode Scanner Modal with Native BarcodeDetector API feature detection
 * and resilient manual keypad input fallback for wet/sunlit harbour conditions.
 */
export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  title = 'Scan Lot / Paddle Barcode',
}) => {
  const [hasCameraSupport, setHasCameraSupport] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [manualCode, setManualCode] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    // Check if BarcodeDetector is supported in browser
    const supported =
      typeof window !== 'undefined' &&
      'BarcodeDetector' in window &&
      navigator.mediaDevices &&
      'getUserMedia' in navigator.mediaDevices;
    setHasCameraSupport(Boolean(supported));
  }, []);

  useEffect(() => {
    if (!isOpen) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setIsScanning(false);
      setErrorMessage(null);
      setManualCode('');
    }
  }, [isOpen]);

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
      }
    } catch {
      setErrorMessage('Camera access denied or unavailable. Please use manual entry.');
      setIsScanning(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = manualCode.trim().toUpperCase();
    if (!clean) return;
    onScanSuccess(clean);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanner-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden border border-neutral-200">
        <div className="flex items-center justify-between px-4 py-3 bg-[var(--brand)] text-white">
          <h2 id="scanner-modal-title" className="text-sm font-semibold flex items-center gap-2">
            <Camera className="w-4 h-4 text-[var(--decor-aqua)]" />
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="text-neutral-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {errorMessage && (
            <div className="p-2 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {hasCameraSupport ? (
            <div className="space-y-3">
              <div className="relative aspect-video bg-neutral-900 rounded overflow-hidden flex items-center justify-center">
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
                    className="bg-[var(--decor-aqua)] text-white px-4 py-2 rounded text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    Activate Camera Scan
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-neutral-500 bg-neutral-50 p-2.5 rounded border border-neutral-200">
              Camera detector not available in this browser. Enter the barcode or lot number below.
            </div>
          )}

          {/* Fallback Manual Keypad Entry */}
          <form onSubmit={handleManualSubmit} className="space-y-2 pt-2 border-t border-neutral-200">
            <label htmlFor="manual-barcode-input" className="block text-xs font-medium text-neutral-700 flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5" /> Manual Identifier Entry
            </label>
            <div className="flex gap-2">
              <input
                id="manual-barcode-input"
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="e.g. LOT-20261112-001"
                className="flex-1 px-3 py-1.5 text-xs border border-neutral-300 rounded font-mono uppercase focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
                autoFocus
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="bg-[var(--brand)] text-white px-3 py-1.5 text-xs font-semibold rounded disabled:opacity-50 hover:bg-[var(--brand-hover)]"
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
