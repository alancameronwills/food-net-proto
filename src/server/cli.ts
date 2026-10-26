import './env-local';
import { resetSession } from './store';

const [cmd, sessionId = 'default'] = process.argv.slice(2);
if (cmd === 'seed' || cmd === 'reset') {
  await resetSession(sessionId);
  console.log(`Session "${sessionId}" ${cmd === 'seed' ? 'seeded' : 'reset'}.`);
} else {
  console.error('Usage: tsx src/server/cli.ts seed|reset [sessionId]');
  process.exit(1);
}
