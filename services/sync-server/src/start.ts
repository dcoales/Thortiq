import {createSyncServer} from './server';

const secret = process.env.THORTIQ_JWT_SECRET;

if (!secret) {
  // eslint-disable-next-line no-console
  console.error('THORTIQ_JWT_SECRET is required to start the sync server');
  process.exit(1);
}

const port = process.env.THORTIQ_SYNC_PORT
  ? Number.parseInt(process.env.THORTIQ_SYNC_PORT, 10)
  : undefined;

const server = createSyncServer({jwtSecret: secret, port});

server
  .start(port)
  .then((listeningPort) => {
    // eslint-disable-next-line no-console
    console.log(`Sync server listening on port ${listeningPort}`);
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start sync server', error);
    process.exit(1);
  });

const handleShutdown = () => {
  server
    .stop()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Error while stopping sync server', error);
      process.exit(1);
    });
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

