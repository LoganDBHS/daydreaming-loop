// src/dashboard/server.ts — Express server for the dashboard
import express from 'express';
import path from 'path';
import routes from './routes';

export function createServer(port = 3000) {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, 'views')));
  app.use(routes);

  const server = app.listen(port, () => {
    console.log(`Dashboard running at http://localhost:${port}`);
  });

  return server;
}
