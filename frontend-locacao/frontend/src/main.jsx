import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import CampoApp from './campo/CampoApp.jsx';
import './index.css';

// /campo → app das equipes de campo; qualquer outro endereço → painel do escritório
const isCampo = window.location.pathname.replace(/\/+$/, '') === '/campo';

// O app de campo é instalável no celular (PWA): manifesto, ícones e service worker só nesta página,
// para o painel do escritório não virar "app" junto.
if(isCampo){
  const head = document.head;
  const add = (tag, attrs) => { const el = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)); head.appendChild(el); };
  add('link', { rel: 'manifest', href: '/campo.webmanifest' });
  head.querySelectorAll('link[rel="apple-touch-icon"]').forEach(el => el.remove());
  add('link', { rel: 'apple-touch-icon', href: '/campo-apple-touch-icon.png' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Flex Campo' });
  add('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'default' });
  // Android/Chrome: guarda o convite de instalação para o botão "Instalar app" usar na hora certa
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__flexInstall = e;
    window.dispatchEvent(new Event('flex-install-ready'));
  });
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/campo-sw.js', { scope: '/campo' }).catch(() => {});
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isCampo ? <CampoApp /> : <App />}
  </React.StrictMode>
);
