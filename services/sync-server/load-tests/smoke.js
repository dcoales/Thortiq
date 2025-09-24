/* k6 runs JavaScript bundles, so this file intentionally uses JS instead of TS. */
import ws from 'k6/ws';
import {check, sleep} from 'k6';

export const options = {
  vus: Number(__ENV.SYNC_VUS || 5),
  duration: __ENV.SYNC_DURATION || '30s'
};

const buildWebsocketUrl = () => {
  const base = __ENV.SYNC_WS_URL;
  const token = __ENV.SYNC_JWT;
  const docId = __ENV.SYNC_DOC_ID || 'thortiq-outline';
  if (!base || !token) {
    throw new Error('SYNC_WS_URL and SYNC_JWT environment variables are required');
  }
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}/${docId}?token=${token}`;
};

export default function run() {
  const targetUrl = buildWebsocketUrl();
  const response = ws.connect(targetUrl, {}, (socket) => {
    socket.on('open', () => {
      socket.sendBinary(new Uint8Array());
    });
    socket.on('close', () => {
      // closed by server or client
    });
    socket.setTimeout(() => {
      socket.close();
    }, Number(__ENV.SYNC_ITERATION_TIMEOUT_MS || 2000));
  });

  check(response, {
    'handshake success': (res) => !!res && res.status === 101
  });

  sleep(Number(__ENV.SYNC_SLEEP_SECONDS || 1));
}
