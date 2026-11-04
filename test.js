// Self-test with a fake AI backend: node test.js
'use strict';
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert');

const calls = [];
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    calls.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/audio/transcriptions') {
      assert.ok(body.includes('RIFF'), 'audio should be converted to wav');
      return res.end(JSON.stringify({ text: '把这根风管接到这里' }));
    }
    const j = JSON.parse(body.toString());
    if (j.modalities) return res.end(JSON.stringify({ choices: [{ message: { audio: { data: Buffer.from('ID3fake').toString('base64') } } }] }));
    assert.ok(j.messages[0].content.includes(j.messages[0].content.includes('usted') ? 'usted' : 'tú'));
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ src: 'zh', zh: j.messages[1].content, es: 'Conecta este ducto aquí.', en: 'Connect this duct here.' }) } }] }));
  });
});

(async () => {
  await new Promise(r => fake.listen(5999, r));
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = 'http://127.0.0.1:5999/v1';
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = 'test';
  process.env.PORT = '5998';
  const { server } = require('./server.js');
  await new Promise(r => server.listen(5998, r));
  const B = 'http://127.0.0.1:5998';

  // static
  for (const p of ['/', '/app.js', '/style.css', '/phrases.js', '/sw.js', '/manifest.webmanifest', '/icon-192.png']) {
    const r = await fetch(B + p); assert.equal(r.status, 200, p);
  }
  assert.equal((await fetch(B + '/../server.js')).status, 404);

  // voice (iPhone records mp4/aac, Chrome records webm/opus)
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  for (const [fmt, args] of [['mp4', ['-c:a', 'aac']], ['webm', ['-c:a', 'libopus']]]) {
    // write a real file (moov atom at end for mp4 — the hard case), then send its bytes
    const f = path.join(os.tmpdir(), 'fixture.' + fmt);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...args, f]);
    const audio = fs.readFileSync(f);
    const r = await fetch(B + '/api/voice?lang=zh&formal=0', { method: 'POST', headers: { 'Content-Type': 'audio/' + fmt }, body: audio });
    const j = await r.json();
    assert.equal(r.status, 200, fmt + ' ' + JSON.stringify(j));
    assert.equal(j.src, 'zh'); assert.equal(j.es, 'Conecta este ducto aquí.');
    console.log('voice', fmt, 'ok');
  }

  // text
  let r = await fetch(B + '/api/text', { method: 'POST', body: JSON.stringify({ text: '先量再切', lang: 'auto' }) });
  let j = await r.json(); assert.equal(r.status, 200); assert.equal(j.zh, '先量再切'); console.log('text ok');
  r = await fetch(B + '/api/text', { method: 'POST', body: JSON.stringify({ text: '' }) }); assert.equal(r.status, 400);

  // tts
  r = await fetch(B + '/api/tts', { method: 'POST', body: JSON.stringify({ text: 'Hola', lang: 'es' }) });
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'audio/mpeg'); console.log('tts ok');

  // bad input
  r = await fetch(B + '/api/voice?lang=xx', { method: 'POST', body: 'x' }); assert.equal(r.status, 400);
  r = await fetch(B + '/api/voice?lang=es', { method: 'POST', body: Buffer.alloc(100) }); assert.equal(r.status, 400);
  r = await fetch(B + '/api/voice?lang=es', { method: 'POST', body: Buffer.alloc(5000, 7) });
  assert.equal(r.status, 502); console.log('garbage audio rejected:', (await r.json()).error);

  console.log('ALL OK');
  server.close(); fake.close();
})().catch(e => { console.error(e); process.exit(1); });
