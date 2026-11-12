import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { app } from './store.ts';
import { followTheme } from './theme.ts';

followTheme(app);

void app.start(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
