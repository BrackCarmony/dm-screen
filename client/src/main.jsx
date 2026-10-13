import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Players from './pages/Players.jsx';
import './styles.css';

const playerSlug = window.location.pathname.match(/^\/p\/([^/]+)/)?.[1];
createRoot(document.getElementById('root')).render(playerSlug ? <Players slug={decodeURIComponent(playerSlug)} /> : <App />);
