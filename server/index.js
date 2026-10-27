import { startServer } from './app.js';

const port = Number(process.env.PORT) || 3000;

let app;
try {
  app = await startServer(port);
} catch (err) {
  console.error(`Could not listen on port ${port}`, err);
  process.exit(1);
}
console.log(`Bum Voyage listening on http://localhost:${app.port}`);

// One bad request or message must not end every game in progress, so stray errors are
// logged and the process carries on. If they pile up the process state can no longer be
// trusted, and it exits so the host restarts it cleanly.
const recent = [];
function survive(kind, err) {
  console.error(kind, err);
  const now = Date.now();
  recent.push(now);
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length > 25) {
    console.error('Too many unexpected errors in a minute, exiting for a clean restart');
    process.exit(1);
  }
}
process.on('uncaughtException', (err) => survive('uncaughtException', err));
process.on('unhandledRejection', (err) => survive('unhandledRejection', err));

// A deploy sends SIGTERM: tell the players, close the sockets and the HTTP server, then exit.
let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await app.shutdown();
  } catch (err) {
    console.error('Shutdown failed', err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
