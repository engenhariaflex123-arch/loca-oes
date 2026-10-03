import React, { useEffect, useRef, useState } from 'react';
import { X, Flashlight, Keyboard } from 'lucide-react';
import jsQR from 'jsqr';

// Leitor contínuo de etiquetas pela câmera traseira.
// - Usa o leitor nativo do navegador quando existe (BarcodeDetector, comum no Android: mais rápido)
// - Senão (iPhone), lê o QR da imagem da câmera com a biblioteca jsQR
// onCode(code) deve devolver { ok: boolean, message: string }: o leitor mostra, vibra e apita.

// Aceita o código puro ("BQ-012") ou um link que termine nele
export function normalizeCode(raw){
  let t = String(raw || '').trim();
  try{
    if(/^https?:\/\//i.test(t)){
      const u = new URL(t);
      t = u.searchParams.get('code') || u.searchParams.get('codigo') || u.pathname.split('/').filter(Boolean).pop() || '';
    }
  }catch(e){}
  return decodeURIComponent(t).trim().toUpperCase();
}

let audioCtx = null;
function beep(ok){
  try{
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 1250 : 330;
    o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (ok ? 0.12 : 0.35));
    o.connect(g).connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.13 : 0.36));
  }catch(e){}
}

export function Scanner({ title, progress, onCode, onClose }){
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const busy = useRef(false);
  const lastRead = useRef({ code: '', at: 0 });
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(null); // { ok, message }
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  useEffect(() => {
    let stopped = false, timer = null, detector = null;

    const start = async () => {
      if(!navigator.mediaDevices?.getUserMedia){
        setError('Este navegador não dá acesso à câmera. Digite o código.');
        return;
      }
      try{
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        });
        if(stopped){ stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        v.srcObject = stream;
        v.setAttribute('playsinline', 'true'); // iPhone: não abrir em tela cheia
        await v.play();
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.() || {};
        setTorchSupported(!!caps.torch);
      }catch(e){
        setError(e.name === 'NotAllowedError'
          ? 'A câmera foi bloqueada. Libere o acesso à câmera para este site nas configurações do navegador, ou digite o código.'
          : 'Não foi possível abrir a câmera. Digite o código.');
        return;
      }
      try{
        if('BarcodeDetector' in window){
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          if(!formats || formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      }catch(e){ detector = null; }
      timer = setInterval(scan, 180);
    };

    const scan = async () => {
      const v = videoRef.current;
      if(busy.current || !v || v.readyState < 2) return;
      busy.current = true;
      try{
        let text = null;
        if(detector){
          const found = await detector.detect(v);
          text = found[0]?.rawValue || null;
        }else{
          const c = canvasRef.current;
          const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
          c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data || null;
        }
        if(text){
          const code = normalizeCode(text);
          const now = Date.now();
          // Ignora a mesma etiqueta lida de novo nos próximos 3 s (a câmera continua vendo)
          if(code && !(code === lastRead.current.code && now - lastRead.current.at < 3000)){
            lastRead.current = { code, at: now };
            const r = await onCode(code);
            setFeedback({ ok: r.ok, message: r.message, at: now });
            beep(r.ok);
            navigator.vibrate?.(r.ok ? 80 : [80, 60, 80]);
          }
        }
      }catch(e){ /* quadro ruim, segue */ }
      busy.current = false;
    };

    start();
    return () => {
      stopped = true;
      clearInterval(timer);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Some com a mensagem depois de 2,5 s
  useEffect(() => {
    if(!feedback) return;
    const id = setTimeout(() => setFeedback(f => (f?.at === feedback.at ? null : f)), 2500);
    return () => clearTimeout(id);
  }, [feedback]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    try{ await track.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(t => !t); }catch(e){}
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col text-white" role="dialog" aria-label="Leitor de etiquetas">
      <div className="flex items-center justify-between px-3 py-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <div className="min-w-0">
          <p className="font-semibold truncate">{title}</p>
          {progress && <p className="text-sm text-white/80">{progress}</p>}
        </div>
        <div className="flex items-center gap-1">
          {torchSupported && (
            <button onClick={toggleTorch} aria-pressed={torch} aria-label={torch ? 'Desligar lanterna' : 'Ligar lanterna'}
              className={`w-12 h-12 rounded-full flex items-center justify-center ${torch ? 'bg-yellow-400 text-black' : 'bg-white/15'}`}>
              <Flashlight size={22}/>
            </button>
          )}
          <button onClick={onClose} aria-label="Fechar leitor" className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center"><X size={24}/></button>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {/* Mira */}
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-64 h-64 max-w-[75vw] max-h-[75vw] rounded-2xl border-4 transition-colors ${feedback ? (feedback.ok ? 'border-emerald-400' : 'border-red-500') : 'border-white/80'}`}
              style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,.45)' }} />
          </div>
        )}
        {!error && !feedback && (
          <p className="absolute bottom-6 inset-x-0 text-center text-white/90 px-6">Aponte para o QR code da etiqueta. A leitura é automática.</p>
        )}
        {feedback && (
          <div className={`absolute bottom-6 inset-x-4 rounded-xl px-4 py-3 text-lg font-semibold text-center ${feedback.ok ? 'bg-emerald-600' : 'bg-red-600'}`} role="status">
            {feedback.message}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="text-center text-lg">{error}</p>
          </div>
        )}
      </div>

      <div className="p-3 bg-black" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <button onClick={onClose} className="w-full min-h-[52px] rounded-xl bg-white text-black text-lg font-semibold flex items-center justify-center gap-2">
          {error ? <><Keyboard size={20}/> Digitar o código</> : 'Pronto, terminei de ler'}
        </button>
      </div>
    </div>
  );
}
