import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/app.css';
import './styles/motion.css';

// motion.css keeps the hero copy and 3D canvas hidden until body has zw-ready.
document.body.classList.add('zw-ready');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
