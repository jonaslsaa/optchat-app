import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { token } from './safe.ts';
import { app } from './store.ts';
import { followTheme } from './theme.ts';

followTheme(app);

// The socket's token comes with the address that opened the page, after its # (which is never sent to the server): no GET
// answers it, so a program on this machine that is not the page cannot learn it.
// The address the server printed, opened in this tab while it has no connection, changes only what is after the #: the page
// starts again with it. Not while connected, where a link to a heading changes it too.
addEventListener('hashchange', () => { if (app.state.connection !== 'open') location.reload(); });
void app.start(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${new URLSearchParams({ token })}`);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
