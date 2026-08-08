import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { I18nProvider } from './i18n.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastHost } from './components/ToastHost.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
      <ToastHost />
    </I18nProvider>
  </React.StrictMode>,
);
