import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { app } from './store.ts';
import { followTheme } from './theme.ts';

followTheme(app);

// The socket's token comes with the address that opened the page, after its # (which is never sent to the server): no GET
// answers it, so a program on this machine that is not the page cannot learn it.
// The address it printed, opened in this tab once refused, changes only what is after the #: the page starts again with it.
addEventListener('hashchange', () => { if (app.state.connection === 'refused') location.reload(); });
void app.start(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${new URLSearchParams({ token: location.hash.slice(1) })}`);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
