import { WebSocket } from 'ws';
import { ANIMAL_IDS } from '../public/shared/animals.js';

const [code, countArg = '1', base = 'ws://localhost:3000/ws'] = process.argv.slice(2);
if (!code) {
  console.error('usage: node scripts/bots.mjs ROOMCODE [bots=1] [ws-url]');
  process.exit(1);
}

const count = Math.min(3, Math.max(1, Number(countArg)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runBot(index) {
  const ws = new WebSocket(base);
  const send = (obj) => ws.readyState === 1 && ws.send(JSON.stringify(obj));
  let racing = false;
  ws.on('open', () => send({ t: 'join', code, name: `Bot${index + 1}`, animal: ANIMAL_IDS[(index * 3 + 1) % ANIMAL_IDS.length] }));
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.t === 'go') racing = true;
    if (msg.t === 'lobby' && msg.phase === 'lobby') racing = false;
  });
  (async () => {
    while (ws.readyState !== 2 && ws.readyState !== 3) {
      await sleep(900 + Math.random() * 900);
      if (!racing) continue;
      send({ t: 'stick', a: Math.PI / 2 + (Math.random() - 0.5) * 2.4 + Math.PI * (index % 2), m: 1 });
      await sleep(400);
      send({ t: 'charge', on: true });
      await sleep(250 + Math.random() * 800);
      send({ t: 'charge', on: false });
    }
  })();
}

for (let i = 0; i < count; i++) runBot(i);
console.log(`${count} bot(s) joining ${code}`);
