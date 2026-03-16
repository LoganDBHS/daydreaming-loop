// src/dashboard/server.ts — Express server for the dashboard
import express from 'express';
import path from 'path';
import routes, { setPipelineRunner, PipelineRunner } from './routes';

export interface ServerOptions {
  runPipeline?: PipelineRunner;
}

// Resolve views directory relative to this source file, not cwd.
// tsx sets __dirname to '.' so we fall back to a known path from project root.
const viewsDir = __dirname !== '.'
  ? path.join(__dirname, 'views')
  : path.join(process.cwd(), 'src', 'dashboard', 'views');

export function createServer(port = 3000, options?: ServerOptions) {
  const app = express();

  if (options?.runPipeline) {
    setPipelineRunner(options.runPipeline);
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(viewsDir));
  app.use(routes);

  const server = app.listen(port, () => {
    console.log(`Dashboard running at http://localhost:${port}`);
  });

  return server;
}
