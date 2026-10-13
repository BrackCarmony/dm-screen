import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Players from './pages/Players.jsx';
import './styles.css';

const isPlayers = window.location.pathname.startsWith('/players');
createRoot(document.getElementById('root')).render(isPlayers ? <Players /> : <App />);
