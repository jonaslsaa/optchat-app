import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { app } from './store.ts';

// The page follows the system's light or dark setting.
const dark = matchMedia('(prefers-color-scheme: dark)'), paint = () => document.documentElement.classList.toggle('dark', dark.matches);
paint();
dark.addEventListener('change', paint);

void app.start(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
