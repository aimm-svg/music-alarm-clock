/**
 * Music Alarm Clock - Resilient iPad Version
 */

const state = {
  alarms: [], playlist: [], snoozeAlarms: [],
  currentAlarm: null, currentSnoozeCount: 0,
  db: null, wakeLock: null, isActive: false,
  isPlaying: false, currentSongIndex: -1,
  audioContext: null, activeAudio: null, volume: 0.8
};

const DOM = {};

document.addEventListener('DOMContentLoaded', async () => {
  // DOM取得
  const ids = [
    'date-display', 'clock-display', 'next-alarm-info', 'activate-btn', 'activation-status',
    'alarm-form', 'alarm-time', 'alarm-snooze', 'alarm-list', 'music-files-input',
    'play-mode', 'songs-list', 'brightness-slider', 'dimmer-overlay', 'alarm-ringing-overlay',
    'ringing-song-title', 'snooze-btn', 'dismiss-btn', 'dummy-video', 'volume-slider', 'btn-enter-fullscreen'
  ];
  ids.forEach(id => DOM[id] = document.getElementById(id));
  DOM.tabBtns = document.querySelectorAll('.tab-btn');
  DOM.tabContents = document.querySelectorAll('.tab-content');
  DOM.themeBtns = document.querySelectorAll('.theme-btn');

  await initDB();
  await loadPlaylist();
  loadSettings();
  loadAlarms();
  registerEvents();
  
  setInterval(tick, 1000);
  tick();
});

async function initDB() {
  return new Promise(res => {
    const req = indexedDB.open('music_db_final', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => { state.db = e.target.result; res(); };
  });
}

// 有効化処理：エラーが出ても無視して動作を続ける
async function unlockApp() {
  state.isActive = true;

  // 1. AudioContextの再開
  try {
    if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    await state.audioContext.resume();
  } catch(e) {}

  // 2. 音声許可の取得（短い無音の再生）
  try {
    const silent = new Audio();
    silent.src = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    await silent.play();
  } catch(e) {}

  // 3. スリープ防止ビデオ
  try {
    await DOM['dummy-video'].play();
  } catch(e) {}

  // 4. Wake Lock (一部のiPadでは失敗することがあるので、失敗してもアラートは出さない)
  if ('wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
    } catch(e) {}
  }

  // 5. 音声エンジンがスリープするのを防ぐ「心拍音」の開始
  setInterval(() => {
    if (!state.isActive) return;
    const heartbeat = new Audio();
    heartbeat.src = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    heartbeat.volume = 0.01;
    heartbeat.play().catch(()=>{});
  }, 30000); // 30秒ごとにこっそり音を出す

  DOM['activate-btn'].classList.add('hide');
  DOM['activation-status'].classList.remove('hide');
  alert("アラームを有効化しました。アプリを閉じずに置いてください。");
}

function tick() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const day = ['日','月','火','水','木','金','土'][now.getDay()];
  
  DOM['date-display'].textContent = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} (${day})`;
  DOM['clock-display'].innerHTML = `${h}:${m}<span class="sec-text">:${s}</span>`;

  if (now.getSeconds() === 0) {
    const timeStr = `${h}:${m}`;
    const snz = state.snoozeAlarms.find(sa => sa.time.getHours() === now.getHours() && sa.time.getMinutes() === now.getMinutes());
    if (snz) {
      triggerAlarm(state.alarms.find(a => a.id === snz.parentId), snz.count);
      state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa !== snz);
    } else {
      state.alarms.forEach(a => {
        if (a.active && a.time === timeStr && (a.days.length === 0 || a.days.includes(now.getDay()))) {
          if (a.days.length === 0) { a.active = false; saveAlarms(); }
          triggerAlarm(a, 0);
        }
      });
    }
  }
}

function triggerAlarm(alarm, count) {
  state.currentAlarm = alarm;
  state.currentSnoozeCount = count;
  DOM['alarm-ringing-overlay'].classList.remove('hide');
  state.isPlaying = true;
  
  if (alarm.snooze > 0 && count < 3) {
    DOM['snooze-btn'].classList.remove('hide');
    DOM['snooze-btn'].textContent = `スヌーズ [${count+1}/3]`;
  } else {
    DOM['snooze-btn'].classList.add('hide');
  }

  if (state.playlist.length === 0) {
    playBeep();
  } else {
    state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : 0;
    playSong(state.currentSongIndex);
  }
}

function playSong(idx) {
  if (!state.isPlaying || !state.playlist[idx]) return;
  const song = state.playlist[idx];
  DOM['ringing-song-title'].textContent = song.name;

  if (state.activeAudio) { state.activeAudio.pause(); URL.revokeObjectURL(state.activeAudio.src); }
  const a = new Audio(URL.createObjectURL(song.data));
  a.volume = state.volume;
  state.activeAudio = a;
  a.play().catch(playBeep);
  
  a.onended = () => {
    state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : (idx + 1) % state.playlist.length;
    playSong(state.currentSongIndex);
  };
}

let beepInt;
function playBeep() {
  if (beepInt) clearInterval(beepInt);
  const ctx = state.audioContext;
  beepInt = setInterval(() => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  }, 1000);
}

function registerEvents() {
  DOM['activate-btn'].onclick = unlockApp;
  DOM['music-files-input'].onchange = async e => {
    for (const f of e.target.files) {
      const tx = state.db.transaction('songs', 'readwrite');
      tx.objectStore('songs').add({ name: f.name, data: f });
    }
    setTimeout(loadPlaylist, 500);
  };
  DOM['volume-slider'].oninput = e => state.volume = e.target.value;
  DOM.tabBtns.forEach(btn => {
    btn.onclick = () => {
      DOM.tabBtns.forEach(b => b.classList.remove('active'));
      DOM.tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    };
  });
  DOM['alarm-form'].onsubmit = e => {
    e.preventDefault();
    const days = Array.from(DOM['alarm-form'].querySelectorAll('input:checked')).map(i => Number(i.value));
    state.alarms.push({ id: Date.now(), time: DOM['alarm-time'].value, snooze: Number(DOM['alarm-snooze'].value), days, active: true });
    saveAlarms();
    alert("アラームを保存しました");
  };
  DOM['btn-enter-fullscreen'].onclick = () => document.body.classList.add('fullscreen-active');
  DOM['clock-display'].onclick = () => document.body.classList.remove('fullscreen-active');
  DOM['brightness-slider'].oninput = e => {
    DOM['dimmer-overlay'].style.backgroundColor = `rgba(0,0,0,${e.target.value/100})`;
    localStorage.setItem('mac_dimmer', e.target.value);
  };
  DOM.themeBtns.forEach(b => b.onclick = () => {
    document.body.className = `theme-${b.dataset.theme}`;
    localStorage.setItem('mac_theme', b.dataset.theme);
    DOM.themeBtns.forEach(btn => btn.classList.toggle('active', btn === b));
  });
  DOM['snooze-btn'].onclick = () => {
    const time = new Date(Date.now() + state.currentAlarm.snooze * 60000);
    state.snoozeAlarms.push({ time, parentId: state.currentAlarm.id, count: state.currentSnoozeCount + 1 });
    stopAll();
  };
  DOM['dismiss-btn'].onclick = stopAll;
}

function stopAll() {
  state.isPlaying = false;
  if (state.activeAudio) state.activeAudio.pause();
  clearInterval(beepInt);
  DOM['alarm-ringing-overlay'].classList.add('hide');
  renderAlarms();
}

function saveAlarms() {
  localStorage.setItem('mac_alarms_v3', JSON.stringify(state.alarms));
  renderAlarms();
  updateNextInfo();
}

function updateNextInfo() {
  DOM['next-alarm-info'].textContent = state.alarms.some(a=>a.active) ? "次のアラーム: セット済み" : "次のアラーム: 未設定";
}

function renderAlarms() {
  DOM['alarm-list'].innerHTML = state.alarms.map(a => `
    <li class="alarm-item">
      <span>${a.time} [${a.active?'ON':'OFF'}]</span>
      <button onclick="delAlarm(${a.id})" style="background:#444; color:#fff; border:none; padding:5px; border-radius:5px">削除</button>
    </li>
  `).join('');
}

async function loadPlaylist() {
  const tx = state.db.transaction('songs', 'readonly');
  const store = tx.objectStore('songs');
  const songs = await new Promise(res => store.getAll().onsuccess = e => res(e.target.result));
  state.playlist = songs;
  DOM['songs-list'].innerHTML = songs.map(s => `
    <li class="song-item"><span>${s.name}</span><button onclick="deleteSong(${s.id})" style="color:#ff4444; background:none; border:none">削除</button></li>
  `).join('');
}

function loadSettings() {
  const theme = localStorage.getItem('mac_theme') || 'amber';
  document.body.className = `theme-${theme}`;
  const dim = localStorage.getItem('mac_dimmer') || '0';
  DOM['brightness-slider'].value = dim;
  DOM['dimmer-overlay'].style.backgroundColor = `rgba(0,0,0,${dim/100})`;
}

function loadAlarms() {
  state.alarms = JSON.parse(localStorage.getItem('mac_alarms_v3') || '[]');
  renderAlarms();
  updateNextInfo();
}

window.delAlarm = id => { state.alarms = state.alarms.filter(a => a.id !== id); saveAlarms(); };
window.deleteSong = async (id) => {
  const tx = state.db.transaction('songs', 'readwrite');
  tx.objectStore('songs').delete(id);
  setTimeout(loadPlaylist, 300);
};