import { createInterface } from 'node:readline';

const mode = process.argv[2];
const lines = createInterface({ input: process.stdin });
let stage = 0;
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
lines.on('line', line => {
  if (mode === 'silent') return;
  if (mode === 'exit') process.exit(1);
  const message = JSON.parse(line);
  if (stage === 0 && message.method === 'initialize') {
    stage++;
    send({ id: message.id, result: { userAgent: 'fixture' } });
  } else if (stage === 1 && message.method === 'initialized') {
    stage++;
  } else if (stage === 2 && message.method === 'account/rateLimits/read') {
    stage++;
    if (mode === 'error') send({ id: message.id, error: { code: -1, message: 'private-token' } });
    else send({ id: message.id, result: { rateLimits: { limitId: 'codex', primary: { usedPercent: 42 } } } });
  } else process.exit(2);
});
