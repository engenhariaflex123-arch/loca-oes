import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import CampoApp from './campo/CampoApp.jsx';
import './index.css';

// /campo → app das equipes de campo; qualquer outro endereço → painel do escritório
const isCampo = window.location.pathname.replace(/\/+$/, '') === '/campo';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isCampo ? <CampoApp /> : <App />}
  </React.StrictMode>
);
