(function () {
'use strict';
var $ = function (id) { return document.getElementById(id); };
var NAME = { zh: '中文', es: 'Español', en: 'English' };
var BCP = { zh: 'zh-CN', es: 'es-US', en: 'en-US' };
// who listens to whom: Chinese speaker → read Spanish; Spanish/English speaker → read Chinese
var LISTEN = { zh: 'es', es: 'zh', en: 'zh' };

// ---------- storage (best effort) ----------
function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

var state = { formal: load('formal', false), auto: load('auto', true), log: load('log', []) };

// ---------- audio playback (one element, unlocked on first tap for iOS) ----------
var player = new Audio();
player.preload = 'auto';
var unlocked = false;
var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
function unlock() {
  if (unlocked) return;
  unlocked = true;
  try { player.src = SILENT; var p = player.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  try { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) {}
}
var ttsCache = {};
var speakToken = 0;
function speak(text, lang) {
  if (!text) return;
  var token = ++speakToken;
  try { player.pause(); } catch (e) {}
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
  var key = lang + '|' + text;
  var cached = ttsCache[key];
  var got = cached ? Promise.resolve(cached) :
    fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, lang: lang }) })
      .then(function (r) { if (!r.ok) throw new Error('tts'); return r.blob(); })
      .then(function (b) { var u = URL.createObjectURL(b); ttsCache[key] = u; return u; });
  got.then(function (url) {
    if (token !== speakToken) return;
    player.src = url;
    var p = player.play();
    if (p && p.catch) p.catch(function () { deviceSpeak(text, lang); });
  }).catch(function () { if (token === speakToken) deviceSpeak(text, lang); });
}
function deviceSpeak(text, lang) {
  if (!window.speechSynthesis) return;
  var u = new SpeechSynthesisUtterance(text);
  u.lang = BCP[lang]; u.rate = 0.92;
  var vs = speechSynthesis.getVoices().filter(function (v) { return v.lang && v.lang.replace('_', '-').toLowerCase().indexOf(lang) === 0; });
  if (vs.length) u.voice = vs[0];
  speechSynthesis.speak(u);
}

// ---------- status line ----------
var statusTimer;
function status(msg, isErr, ms) {
  var el = $('status');
  clearTimeout(statusTimer);
  if (!msg) { el.hidden = true; return; }
  el.hidden = false; el.textContent = msg; el.className = 'status' + (isErr ? ' err' : '');
  if (ms) statusTimer = setTimeout(function () { el.hidden = true; }, ms);
}

// ---------- conversation log ----------
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function others(src) { var l = LISTEN[src]; return [l].concat(['zh', 'es', 'en'].filter(function (x) { return x !== src && x !== l; })); }

function msgEl(m) {
  var d = document.createElement('div');
  d.className = 'msg from-' + m.src;
  var o = others(m.src);
  d.innerHTML =
    '<div class="orig"><span class="tag ' + m.src + '">' + NAME[m.src] + '</span>' + esc(m[m.src]) + '</div>' +
    '<div class="main"><span class="tag ' + o[0] + '">' + NAME[o[0]] + '</span>' + esc(m[o[0]]) + '</div>' +
    '<div class="sub"><span class="tag ' + o[1] + '">' + NAME[o[1]] + '</span>' + esc(m[o[1]]) + '</div>' +
    '<div class="acts">' +
      '<button data-a="say" data-l="' + o[0] + '">🔊 ' + NAME[o[0]] + '</button>' +
      '<button data-a="say" data-l="' + m.src + '">🔊 ' + NAME[m.src] + '</button>' +
      '<button data-a="show">⛶ 给他看 / Mostrar</button>' +
    '</div>';
  d.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    unlock();
    if (b.dataset.a === 'say') speak(m[b.dataset.l], b.dataset.l);
    else showBig(m[o[0]], o[0], m[m.src], m[o[1]]);
  });
  return d;
}
function render() {
  var log = $('log');
  log.querySelectorAll('.msg').forEach(function (n) { n.remove(); });
  $('empty').hidden = state.log.length > 0;
  state.log.forEach(function (m) { log.appendChild(msgEl(m)); });
  scrollEnd();
}
function scrollEnd() { var t = $('talk'); requestAnimationFrame(function () { t.scrollTop = t.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }); }
function addResult(r) {
  var m = { src: r.src, zh: r.zh, es: r.es, en: r.en, t: Date.now() };
  state.log.push(m);
  if (state.log.length > 100) state.log = state.log.slice(-100);
  save('log', state.log);
  $('empty').hidden = true;
  $('log').appendChild(msgEl(m));
  scrollEnd();
  if (state.auto) speak(m[LISTEN[m.src]], LISTEN[m.src]);
}

// ---------- full screen ----------
var showing = null;
function showBig(big, lang, top, bottom) {
  showing = { text: big, lang: lang };
  $('showBig').textContent = big; $('showTop').textContent = top || ''; $('showBottom').textContent = bottom || '';
  $('show').hidden = false;
}
$('showClose').onclick = function () { $('show').hidden = true; };
$('showSay').onclick = function () { unlock(); if (showing) speak(showing.text, showing.lang); };

// ---------- recording ----------
var rec = null, chunks = [], recLang = null, recBtn = null, recTimer = null, recStart = 0, stream = null, busy = false;
function pickType() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
  for (var i = 0; i < types.length; i++) if (MediaRecorder.isTypeSupported(types[i])) return types[i];
  return '';
}
function micHelp(err) {
  var n = err && err.name;
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return '麦克风被拒绝了。iPhone：设置 → Safari → 麦克风 → 允许；或点地址栏左边“大小”→网站设置→麦克风→允许。安卓：点地址栏锁头 → 权限 → 麦克风 → 允许。';
  if (n === 'NotFoundError') return '没找到麦克风。';
  return '打不开麦克风，可以先用打字。';
}
function setBtnsDisabled(dis, except) {
  document.querySelectorAll('.mic').forEach(function (b) { if (b !== except) b.disabled = dis; });
  $('send').disabled = dis;
}
function startRec(btn) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    status('这个浏览器不支持录音，请用 Safari 或 Chrome 打开，或者先打字。', true); return;
  }
  recLang = btn.dataset.lang; recBtn = btn;
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    .then(function (s) {
      stream = s; chunks = [];
      var type = pickType();
      rec = type ? new MediaRecorder(s, { mimeType: type }) : new MediaRecorder(s);
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = onRecStop;
      rec.start(250);
      recStart = Date.now();
      btn.classList.add('rec');
      setBtnsDisabled(true, btn);
      var label = btn.querySelector('span') || btn.querySelector('b');
      btn._label = label.textContent;
      var stopWord = recLang === 'zh' ? '说完点这里' : recLang === 'es' ? 'Toca para terminar' : 'Tap to stop';
      var tick = function () {
        var s = Math.floor((Date.now() - recStart) / 1000);
        label.textContent = stopWord + ' ' + s + 's';
        if (s >= 115) stopRec();
      };
      tick(); recTimer = setInterval(tick, 500);
      status(recLang === 'es' ? 'Escuchando… habla ahora' : recLang === 'en' ? 'Listening… speak now' : '正在听，请说话…');
    })
    .catch(function (e) { status(micHelp(e), true); recBtn = null; });
}
function stopRec() {
  if (!rec) return;
  clearInterval(recTimer);
  try { rec.stop(); } catch (e) { onRecStop(); }
}
function resetRecUI() {
  if (recBtn) { recBtn.classList.remove('rec'); var l = recBtn.querySelector('span') || recBtn.querySelector('b'); if (recBtn._label) l.textContent = recBtn._label; }
  if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  stream = null; rec = null; recBtn = null;
}
function onRecStop() {
  var lang = recLang, type = (rec && rec.mimeType) || 'audio/webm', dur = Date.now() - recStart;
  var blob = new Blob(chunks, { type: type });
  resetRecUI();
  if (dur < 700 || blob.size < 1000) { setBtnsDisabled(false); status('太短了，点一下，说完再点一下。', true, 4000); return; }
  busy = true;
  status(lang === 'es' ? 'Traduciendo…' : '正在翻译…');
  fetch('/api/voice?lang=' + lang + '&formal=' + (state.formal ? 1 : 0), { method: 'POST', headers: { 'Content-Type': type }, body: blob })
    .then(handle)
    .then(function (r) { status(''); addResult(r); })
    .catch(function (e) { status(e.message || '翻译没成功，再试一次。', true); })
    .then(function () { busy = false; setBtnsDisabled(false); });
}
function handle(r) {
  return r.json().catch(function () { return {}; }).then(function (j) {
    if (!r.ok) throw new Error(j.error || '翻译没成功，再试一次。');
    return j;
  });
}

document.querySelectorAll('.mic').forEach(function (btn) {
  btn.addEventListener('click', function () {
    unlock();
    if (busy) return;
    if (rec && recBtn === btn) stopRec();
    else if (!rec) startRec(btn);
  });
});

// ---------- typing ----------
function sendText() {
  var t = $('txt').value.trim();
  if (!t || busy) return;
  unlock();
  busy = true; setBtnsDisabled(true);
  status('正在翻译…');
  fetch('/api/text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, lang: 'auto', formal: state.formal }) })
    .then(handle)
    .then(function (r) { $('txt').value = ''; status(''); addResult(r); })
    .catch(function (e) { status(e.message, true); })
    .then(function () { busy = false; setBtnsDisabled(false); });
}
$('send').onclick = sendText;
$('txt').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendText(); } });

// ---------- options ----------
function paintOpts() {
  var f = $('formal'), a = $('auto');
  f.textContent = state.formal ? '对客户用 usted' : '对工人用 tú';
  f.classList.toggle('on', state.formal); f.setAttribute('aria-pressed', state.formal);
  a.textContent = '自动朗读：' + (state.auto ? '开' : '关');
  a.classList.toggle('on', state.auto); a.setAttribute('aria-pressed', state.auto);
}
$('formal').onclick = function () { state.formal = !state.formal; save('formal', state.formal); paintOpts(); };
$('auto').onclick = function () { unlock(); state.auto = !state.auto; save('auto', state.auto); paintOpts(); };
$('clear').onclick = function () {
  if (!state.log.length || !confirm('清空全部对话记录？')) return;
  state.log = []; save('log', []); render();
};

// ---------- tabs ----------
function tab(which) {
  $('talk').hidden = which !== 'talk'; $('book').hidden = which !== 'book';
  $('dock').hidden = which !== 'talk';
  $('tabTalk').classList.toggle('on', which === 'talk'); $('tabBook').classList.toggle('on', which === 'book');
}
$('tabTalk').onclick = function () { tab('talk'); };
$('tabBook').onclick = function () { tab('book'); };

// ---------- phrasebook ----------
var cat = '全部';
function paintCats() {
  var cats = ['全部'].concat(PHRASES.map(function (p) { return p[0]; }).filter(function (c, i, a) { return a.indexOf(c) === i; }));
  $('cats').innerHTML = cats.map(function (c) { return '<button class="' + (c === cat ? 'on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
}
function paintPhrases() {
  var q = $('q').value.trim().toLowerCase();
  var list = PHRASES.filter(function (p) {
    return (cat === '全部' || p[0] === cat) && (!q || (p[1] + ' ' + p[2] + ' ' + p[3]).toLowerCase().indexOf(q) >= 0);
  });
  $('plist').innerHTML = list.length ? list.map(function (p) {
    var i = PHRASES.indexOf(p);
    return '<div class="ph"><div class="t"><div class="es">' + esc(p[3]) + '</div><div class="zh">' + esc(p[1]) + '</div><div class="en">' + esc(p[2]) + '</div></div>' +
      '<button data-i="' + i + '" data-a="say" aria-label="朗读">🔊</button><button data-i="' + i + '" data-a="show" aria-label="全屏">⛶</button></div>';
  }).join('') : '<div class="empty">没找到 / No hay resultados</div>';
}
$('cats').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; cat = b.dataset.c; paintCats(); paintPhrases(); });
$('q').addEventListener('input', paintPhrases);
$('plist').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  unlock();
  var p = PHRASES[+b.dataset.i];
  if (b.dataset.a === 'say') speak(p[3], 'es');
  else showBig(p[3], 'es', p[1], p[2]);
});

// ---------- network note ----------
function net() { $('net').hidden = navigator.onLine !== false; }
window.addEventListener('online', net); window.addEventListener('offline', net);

// ---------- init ----------
paintOpts(); render(); paintCats(); paintPhrases(); net();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
