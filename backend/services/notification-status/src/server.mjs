import { startServer } from "./lib/server.mjs";
import { startOutboxWorker } from "./worker.mjs";
startServer({ port: 3000, onStarted: startOutboxWorker });
