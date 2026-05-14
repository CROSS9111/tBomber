/* eslint-disable @typescript-eslint/no-var-requires */
import { monitor } from '@colyseus/monitor';
import { LobbyRoom, Server } from 'colyseus';
import cors from 'cors';
import express from 'express';
import basicAuth from 'express-basic-auth';
import { createServer } from 'http';
import next from 'next';
import { parse } from 'url';

import * as Constants from './src/server/constants/constants';
import GameRoom from './src/server/rooms/GameRoom';

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';

// timesync server (CommonJS module)
const timesyncServer = require('timesync/server');

async function bootstrap() {
  const nextApp = next({ dev, hostname, port });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const gameServer = new Server({ server: httpServer });

  // Colyseus は HTTP サーバーの 'upgrade' イベントを全て掴むため、
  // Next.js の HMR (`/_next/webpack-hmr`) が落ちる。パスで分岐して再装着する。
  const colyseusUpgradeListeners = httpServer.listeners('upgrade').slice();
  const nextUpgradeHandler = nextApp.getUpgradeHandler();
  httpServer.removeAllListeners('upgrade');
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/_next')) {
      void nextUpgradeHandler(req, socket as never, head);
      return;
    }
    for (const listener of colyseusUpgradeListeners) {
      (listener as (...args: unknown[]) => void)(req, socket, head);
    }
  });

  const adminPassword = process.env.ADMIN_PASSWORD ?? Constants.DEBUG_ADMIN_PASSWORD;
  const basicAuthMiddleware = basicAuth({
    users: { admin: adminPassword },
    challenge: true,
  });

  // Colyseus monitor (auth-protected)
  app.use('/monitor', basicAuthMiddleware, monitor());

  // timesync endpoint
  app.options('/timesync', cors());
  app.use('/timesync', cors(), timesyncServer.requestHandler);

  // Define rooms
  gameServer.define(Constants.GAME_LOBBY_KEY, LobbyRoom);
  gameServer.define(Constants.GAME_CUSTOM_ROOM_KEY, GameRoom).enableRealtimeListing();

  // すべての未処理リクエストは Next.js に委譲
  app.all('*', (req, res) => {
    const parsedUrl = parse(req.url, true);
    void handle(req, res, parsedUrl);
  });

  await gameServer.listen(port, hostname);
  console.log(`> Ready on http://${hostname}:${port}`);
  console.log(`> Colyseus monitor: http://${hostname}:${port}/monitor`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
