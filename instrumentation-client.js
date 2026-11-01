import { initBotId } from 'botid/client/core';

// Vercel BotID: pages prove they are a real browser before these calls reach
// the server, and lib/guard.js turns away anything that did not. Keep the
// list in step with the routes that call guard().
initBotId({
  protect: [
    { path: '/api/catalog', method: 'GET' },
    { path: '/api/catalog/*', method: 'GET' },
    { path: '/api/saves', method: 'POST' },
    { path: '/api/saves', method: 'DELETE' },
    { path: '/api/chat', method: 'POST' },
  ],
});
