/**
 * Music Alarm Clock - iPad Robust Version
 */

const state = {
  alarms: [], playlist: [], snoozeAlarms: [],
  currentAlarm: null, currentSnoozeCount: 0,
  db: null, wakeLock: null, isActive: false,
  isPlaying: false, currentSongIndex: -1,
  audioContext: null, activeAudio: null, volume: 0.8
};

const MAX_SNOOZE_COUNT = 3;
const DOM = {};

document.addEventListener('DOMContentLoaded', async () => {
  // DOM取得の簡略化
  const ids = [
    'date-display', 'clock-display', 'next-alarm-info', 'activate-btn', 'activation-status',
    'alarm-form', 'alarm-time', 'alarm-snooze', 'alarm-list', 'music-files-input',
    'play-mode', 'songs-list', 'brightness-slider', 'dimmer-overlay', 'alarm-ringing-overlay',
    'ringing-song-title', 'snooze-btn', 'dismiss-btn', 'dummy-video', 'font-selector', 
    'btn-enter-fullscreen', 'volume-slider'
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

// --- iPad向け：ファイルの読み込み・保存の安定化 ---
async function initDB() {
  return new Promise(res => {
    const req = indexedDB.open('music_db', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => { state.db = e.target.result; res(); };
  });
}

async function loadPlaylist() {
  const tx = state.db.transaction('songs', 'readonly');
  const store = tx.objectStore('songs');
  const songs = await new Promise(res => store.getAll().onsuccess = e => res(e.target.result));
  state.playlist = songs;
  DOM['songs-list'].innerHTML = songs.map(s => `
    <li class="song-item">
      <span>${s.name.substring(0, 20)}${s.name.length > 20 ? '...' : ''}</span>
      <button onclick="deleteSong(${s.id})" style="background:none;border:none;color:#ff5252;padding:10px">削除</button>
    </li>
  `).join('');
}

// 修正：ファイルを一つずつ保存し、エラーを防ぐ
async function handleFileSelect(files) {
  if (!files.length) return;
  alert(`${files.length}個のファイルを処理します。少々お待ちください...`);
  
  for (const f of files) {
    try {
      const tx = state.db.transaction('songs', 'readwrite');
      await new Promise((res, rej) => {
        const req = tx.objectStore('songs').add({ name: f.name, data: f });
        req.onsuccess = res;
        req.onerror = rej;
      });
    } catch (e) {
      console.error("保存失敗:", f.name, e);
    }
  }
  await loadPlaylist();
  alert('プレイリストを更新しました');
}

// --- iPad向け：音声のロック解除 ---
async function unlockAudio() {
  // Web Audio APIの初期化
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  await state.audioContext.resume();

  // HTML Audioのアンロック（無音を再生して「許可」を得る）
  const silentTag = new Audio();
  silentTag.src = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA=="; // 極短の無音
  await silentTag.play().catch(e => console.log("Audio unlock failed:", e));

  // ダミー動画の再生（スリープ防止）
  DOM['dummy-video'].play().catch(e => console.log("Video unlock failed:", e));

  // スクリーンロックの取得
  if ('wakeLock' in navigator) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
  }

  state.isActive = true;
  DOM['activate-btn'].classList.add('hide');
  DOM['activation-status'].classList.remove('hide');
}

// --- 再生エンジン ---
function playSong(idx) {
  if (!state.isPlaying || !state.playlist[idx]) return;
  const song = state.playlist[idx];
  DOM['ringing-song-title'].textContent = `再生中: ${song.name}`;

  if (state.activeAudio) {
    state.activeAudio.pause();
    URL.revokeObjectURL(state.activeAudio.src);
  }

  const url = URL.createObjectURL(song.data);
  const a = new Audio(url);
  a.volume = state.volume; // 音量を適用
  state.activeAudio = a;
  
  a.play().catch(e => {
    console.error("Playback failed:", e);
    playBeep(); // 失敗したら電子音
  });

  a.onended = () => {
    state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? 
      Math.floor(Math.random() * state.playlist.length) : (idx + 1) % state.playlist.length;
    playSong(state.currentSongIndex);
  };
}

// --- イベント登録 ---
function registerEvents() {
  DOM['activate-btn'].onclick = unlockAudio;

  DOM['music-files-input'].onchange = e => handleFileSelect(e.target.files);

  DOM['volume-slider'].oninput = e => {
    state.volume = e.target.value;
    if (state.activeAudio) state.activeAudio.volume = state.volume;
  };

  // タブ切り替え
  DOM.tabBtns.forEach(btn => {
    btn.onclick = () => {
      DOM.tabBtns.forEach(b => b.classList.remove('active'));
      DOM.tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    };
  });

  // フォント切り替え
  DOM['font-selector'].onchange = e => {
    DOM['clock-display'].style.fontFamily = e.target.value;
    localStorage.setItem('mac_font', e.target.value);
  };

  // ... 他のイベント (アラーム保存, スヌーズ, 停止等) は前回のロジックを継承 ...
  DOM['alarm-form'].onsubmit = e => {
    e.preventDefault();
    const days = Array.from(DOM['alarm-form'].querySelectorAll('input:checked')).map(i => Number(i.value));
    state.alarms.push({ id: Date.now(), time: DOM['alarm-time'].value, snooze: Number(DOM['alarm-snooze'].value), days, active: true });
    saveAlarms();
    alert('アラームを保存しました');
  };

  DOM['btn-enter-fullscreen'].onclick = () => document.body.classList.add('fullscreen-active');
  DOM['clock-display'].onclick = () => document.body.classList.remove('fullscreen-active');

  DOM['snooze-btn'].onclick = () => {
    const time = new Date(Date.now() + state.currentAlarm.snooze * 60000);
    state.snoozeAlarms.push({ time, parentId: state.currentAlarm.id, count: state.currentSnoozeCount + 1 });
    stopAll();
  };
  DOM['dismiss-btn'].onclick = () => stopAll();
}

// その他ヘルパー (tick, saveAlarms, renderAlarms, stopAll 等は前回のコードと同様)
function tick() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  DOM['date-display'].textContent = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} (${['日','月','火','水','木','金','土'][now.getDay()]})`;
  DOM['clock-display'].innerHTML = `${timeStr}<span class="seconds-text">:${String(now.getSeconds()).padStart(2, '0')}</span>`;

  if (now.getSeconds() === 0) {
    const snooze = state.snoozeAlarms.find(s => s.time.getHours() === now.getHours() && s.time.getMinutes() === now.getMinutes());
    if (snooze) {
      triggerAlarm(state.alarms.find(a => a.id === snooze.parentId), snooze.count);
      state.snoozeAlarms = state.snoozeAlarms.filter(s => s !== snooze);
      return;
    }
    state.alarms.forEach(a => {
      if (a.active && a.time === timeStr && (a.days.length === 0 || a.days.includes(now.getDay()))) {
        if (a.days.length === 0) { a.active = false; saveAlarms(); }
        triggerAlarm(a, 0);
      }
    });
  }
}

function triggerAlarm(alarm, count) {
  state.currentAlarm = alarm;
  state.currentSnoozeCount = count;
  DOM['alarm-ringing-overlay'].classList.remove('hide');
  if (alarm.snooze > 0 && count < MAX_SNOOZE_COUNT) {
    DOM['snooze-btn'].classList.remove('hide');
  } else {
    DOM['snooze-btn'].classList.add('hide');
  }
  state.isPlaying = true;
  startPlayback();
}

function startPlayback() {
  if (state.playlist.length === 0) {
    playBeep();
    return;
  }
  state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : 0;
  playSong(state.currentSongIndex);
}

function stopAll() {
  state.isPlaying = false;
  if (state.activeAudio) state.activeAudio.pause();
  if (beepInterval) clearInterval(beepInterval);
  DOM['alarm-ringing-overlay'].classList.add('hide');
}

function saveAlarms() {
  localStorage.setItem('mac_alarms', JSON.stringify(state.alarms));
  renderAlarms();
}

function renderAlarms() {
  DOM['alarm-list'].innerHTML = state.alarms.map(a => `
    <li class="alarm-item">
      <span>${a.time} (${a.days.length?a.days.map(d=>['日','月','火','水','木','金','土'][d]).join(''):'1回'})</span>
      <button onclick="delAlarm(${a.id})" style="background:none;border:none;color:#ff5252;padding:10px">削除</button>
    </li>
  `).join('');
}

window.delAlarm = id => { state.alarms = state.alarms.filter(a => a.id !== id); saveAlarms(); };
window.deleteSong = async (id) => {
  const tx = state.db.transaction('songs', 'readwrite');
  tx.objectStore('songs').delete(id);
  await loadPlaylist();
};

let beepInterval;
function playBeep() {
  if (!state.audioContext) state.audioContext = new AudioContext();
  beepInterval = setInterval(() => {
    const o = state.audioContext.createOscillator();
    const g = state.audioContext.createGain();
    o.connect(g); g.connect(state.audioContext.destination);
    o.frequency.value = 880; g.gain.exponentialRampToValueAtTime(0.01, state.audioContext.currentTime + 0.5);
    o.start(); o.stop(state.audioContext.currentTime + 0.5);
  }, 1000);
}

function loadSettings() {
  const theme = localStorage.getItem('mac_theme') || 'amber';
  document.body.className = `theme-${theme}`;
  const font = localStorage.getItem('mac_font') || "'Share Tech Mono', monospace";
  DOM['clock-display'].style.fontFamily = font;
  if(DOM['font-selector']) DOM['font-selector'].value = font;
}

function loadAlarms() {
  state.alarms = JSON.parse(localStorage.getItem('mac_alarms') || '[]');
  renderAlarms();
}