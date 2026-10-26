// Local dev server: the same Hono app that runs on Lambda, served by Node, against DynamoDB Local.
import './env-local';
import { serve } from '@hono/node-server';
import { app } from './app';
import { ensureTable } from './db';

const port = Number(process.env.PORT ?? 3001);
await ensureTable();
serve({ fetch: app.fetch, port }, () => console.log(`API on http://localhost:${port}  (DynamoDB ${process.env.DYNAMODB_ENDPOINT})`));
