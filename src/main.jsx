import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App';
import { env } from '@/config/env';
import { AuthProvider } from '@/context/AuthProvider';
import './index.css';

// HashRouter: GitHub Pages can't rewrite unknown paths to index.html, so URLs look like /#/allocation.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={env.GOOGLE_CLIENT_ID}>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </GoogleOAuthProvider>
  </React.StrictMode>,
);
