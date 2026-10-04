import React, { useEffect, useState } from 'react';
import { Download, X, Share, PlusSquare, MoreVertical } from 'lucide-react';

// Cartão "Instalar o app": aparece só quando o app ainda está aberto no navegador.
const DISMISS_KEY = 'campo-instalar-depois';
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function InstallCard({ compact = false }){
  const [installed, setInstalled] = useState(isStandalone);
  const [prompt, setPrompt] = useState(() => window.__flexInstall || null);
  const [showHelp, setShowHelp] = useState(false);
  const [later, setLater] = useState(() => {
    try{ return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now(); }catch(e){ return false; }
  });

  useEffect(() => {
    const ready = () => setPrompt(window.__flexInstall);
    const done = () => { setInstalled(true); window.__flexInstall = null; };
    window.addEventListener('flex-install-ready', ready);
    window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('flex-install-ready', ready); window.removeEventListener('appinstalled', done); };
  }, []);

  if(installed || (compact && later)) return null;

  const install = async () => {
    if(prompt){
      prompt.prompt();
      const r = await prompt.userChoice.catch(() => null);
      if(r?.outcome === 'accepted') setInstalled(true);
      window.__flexInstall = null; setPrompt(null);
    }else{
      setShowHelp(true);
    }
  };
  const dismiss = () => {
    try{ localStorage.setItem(DISMISS_KEY, String(Date.now() + 7 * 86400000)); }catch(e){}
    setLater(true);
  };

  return (
    <>
      <section className="rounded-xl bg-white p-4 shadow-sm border-2 border-brand-100">
        <div className="flex items-center gap-3">
          <img src="/campo-icon-192.png" alt="" className="w-12 h-12 rounded-xl border border-neutral-200 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold leading-tight">Instale o app no celular</p>
            <p className="text-sm text-neutral-600 leading-snug">Fica na tela inicial, abre em tela cheia e se atualiza sozinho.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3">
          <button onClick={install} className="flex-1 min-h-[48px] rounded-xl bg-brand-600 active:bg-brand-700 text-white font-semibold flex items-center justify-center gap-2">
            <Download size={18}/> Instalar app
          </button>
          {compact && <button onClick={dismiss} className="min-h-[48px] px-3 text-sm text-neutral-500 underline">Agora não</button>}
        </div>
      </section>

      {showHelp && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" onClick={() => setShowHelp(false)} role="dialog" aria-label="Como instalar o app">
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-8" onClick={e => e.stopPropagation()} style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-lg font-bold">Como instalar</p>
              <button onClick={() => setShowHelp(false)} aria-label="Fechar" className="w-10 h-10 flex items-center justify-center text-neutral-500"><X size={22}/></button>
            </div>
            {isIOS() ? (
              <ol className="flex flex-col gap-3 text-base">
                <li className="flex gap-3 items-start"><span className="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center shrink-0">1</span>
                  <span>Toque no botão <b>Compartilhar</b> <Share size={18} className="inline -mt-1 text-brand-600"/> na barra do Safari (embaixo ou em cima da tela).</span></li>
                <li className="flex gap-3 items-start"><span className="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center shrink-0">2</span>
                  <span>Role a lista e toque em <b>Adicionar à Tela de Início</b> <PlusSquare size={18} className="inline -mt-1 text-brand-600"/>.</span></li>
                <li className="flex gap-3 items-start"><span className="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center shrink-0">3</span>
                  <span>Toque em <b>Adicionar</b>. O ícone <b>Flex Locações</b> aparece na tela inicial.</span></li>
                <li className="text-sm text-neutral-500">No iPhone, abra este link pelo <b>Safari</b> para ter essa opção.</li>
              </ol>
            ) : (
              <ol className="flex flex-col gap-3 text-base">
                <li className="flex gap-3 items-start"><span className="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center shrink-0">1</span>
                  <span>Toque no menu <MoreVertical size={18} className="inline -mt-1 text-brand-600"/> do Chrome, no canto de cima.</span></li>
                <li className="flex gap-3 items-start"><span className="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center shrink-0">2</span>
                  <span>Toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</span></li>
                <li className="flex gap-3 items-start"><span className="w-7 h-7 rounded-full bg-brand-600 text-white font-bold flex items-center justify-center shrink-0">3</span>
                  <span>Confirme. O ícone <b>Flex Locações</b> aparece na tela inicial.</span></li>
                <li className="text-sm text-neutral-500">Se a opção não aparecer, abra o link pelo <b>Google Chrome</b>.</li>
              </ol>
            )}
          </div>
        </div>
      )}
    </>
  );
}
