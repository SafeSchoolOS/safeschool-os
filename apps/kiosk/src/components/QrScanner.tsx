import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';

interface QrScannerProps {
  onScan: (qrToken: string) => void;
  onCancel: () => void;
}

export function QrScanner({ onScan, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const foundRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const extractToken = (value: string): string => {
    // If the value looks like a URL, extract the last path segment
    try {
      const url = new URL(value);
      const segments = url.pathname.split('/').filter(Boolean);
      if (segments.length > 0) return segments[segments.length - 1];
    } catch {
      // Not a URL, use raw value
    }
    return value;
  };

  const scanFrame = useCallback(() => {
    if (foundRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'dontInvert',
    });

    if (code && code.data) {
      foundRef.current = true;
      stopStream();
      const token = extractToken(code.data);
      onScan(token);
      return;
    }

    rafRef.current = requestAnimationFrame(scanFrame);
  }, [onScan, stopStream]);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
          rafRef.current = requestAnimationFrame(scanFrame);
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof DOMException && err.name === 'NotAllowedError'
              ? 'Camera permission denied. Please allow camera access and try again.'
              : err instanceof DOMException && err.name === 'NotFoundError'
                ? 'No camera found on this device.'
                : 'Unable to access camera. Please try again.';
          setError(msg);
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [scanFrame, stopStream]);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col items-center justify-center text-white p-8">
        <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
        <p className="text-xl text-gray-300 mb-8 text-center max-w-md">{error}</p>
        <button
          onClick={onCancel}
          className="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-lg transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex flex-col items-center justify-center text-white p-8">
      <h2 className="text-3xl font-bold mb-6">Scan QR Code</h2>

      <div className="relative w-full max-w-lg aspect-square bg-gray-800 rounded-2xl overflow-hidden mb-6">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />

        {/* Scanning overlay with cutout corners */}
        {ready && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {/* Semi-transparent overlay */}
            <div className="absolute inset-0 bg-black/40" />
            {/* Cutout area */}
            <div className="relative w-3/5 aspect-square">
              {/* Clear center */}
              <div className="absolute inset-0 bg-transparent" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }} />
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-blue-400 rounded-tl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-blue-400 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-blue-400 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-blue-400 rounded-br" />
              {/* Scanning line animation */}
              <div className="absolute left-2 right-2 h-0.5 bg-blue-400/80 animate-[scan_2s_ease-in-out_infinite]" />
            </div>
          </div>
        )}

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <p className="text-gray-400 mb-6">Hold the QR code in front of the camera</p>

      <button
        onClick={() => {
          stopStream();
          onCancel();
        }}
        className="px-8 py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-lg transition-colors"
      >
        Cancel
      </button>

      {/* Keyframe for scan line animation */}
      <style>{`
        @keyframes scan {
          0%, 100% { top: 10%; }
          50% { top: 90%; }
        }
      `}</style>
    </div>
  );
}
