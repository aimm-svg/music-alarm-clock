/**
 * Music Alarm Clock - Unified Logic v5
 */

const state = {
  alarms: [], playlist: [], snoozeAlarms: [],
  currentAlarm: null, currentSnoozeCount: 0,
  db: null, wakeLock: null, isActive: false,
  isPlaying: false, currentSongIndex: -1,
  audioContext: null, activeAudio: null, previewAudio: null
};

const MAX_SNOOZE_COUNT = 3;
const DOM = {};

document.addEventListener('DOMContentLoaded', async () => {
  // DOM取得
  const ids = [
    'date-display', 'clock-display', 'next-alarm-info', 'activate-btn', 'activation-status',
    'alarm-form', 'alarm-time', 'alarm-snooze', 'alarm-list', 'music-files-input',
    'play-mode', 'songs-list', 'brightness-slider', 'dimmer-overlay', 'alarm-ringing-overlay',
    'ringing-song-title', 'snooze-btn', 'dismiss-btn', 'dummy-video', 'font-selector', 'btn-enter-fullscreen'
  ];
  ids.forEach(id => DOM[id] = document.getElementById(id));
  DOM.tabBtns = document.querySelectorAll('.tab-btn');
  DOM.tabContents = document.querySelectorAll('.tab-content');
  DOM.themeBtns = document.querySelectorAll('.theme-btn');

  // 初期化
  await initDB();
  await loadPlaylist();
  loadSettings();
  loadAlarms();
  registerEvents();
  
  // 時計開始
  setInterval(tick, 1000);
  tick();
});

// --- 基盤機能 ---
async function initDB() {
  return new Promise(res => {
    const req = indexedDB.open('music_db', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = e => { state.db = e.target.result; res(); };
  });
}

function loadSettings() {
  const theme = localStorage.getItem('mac_theme') || 'amber';
  document.body.className = `theme-${theme}`;
  const font = localStorage.getItem('mac_font') || 'var(--font-clock)';
  DOM['clock-display'].style.fontFamily = font;
  DOM['font-selector'].value = font;
  const dim = localStorage.getItem('mac_dimmer') || '0';
  DOM['brightness-slider'].value = dim;
  DOM['dimmer-overlay'].style.backgroundColor = `rgba(0,0,0,${dim/100})`;
}

// --- アラーム判定 ---
function tick() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  DOM['date-display'].textContent = `${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()} (${['日','月','火','水','木','金','土'][now.getDay()]})`;
  DOM['clock-display'].innerHTML = `${timeStr}<span class="seconds-text">:${String(now.getSeconds()).padStart(2, '0')}</span>`;

  if (now.getSeconds() === 0) {
    // スヌーズチェック
    const snooze = state.snoozeAlarms.find(s => s.time.getHours() === now.getHours() && s.time.getMinutes() === now.getMinutes());
    if (snooze) {
      triggerAlarm(state.alarms.find(a => a.id === snooze.parentId), snooze.count);
      state.snoozeAlarms = state.snoozeAlarms.filter(s => s !== snooze);
      return;
    }
    // 通常アラーム
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
    DOM['snooze-btn'].textContent = `スヌーズ [${count+1}/${MAX_SNOOZE_COUNT}]`;
  } else {
    DOM['snooze-btn'].classList.add('hide');
  }
  startPlayback();
}

// --- 再生機能 ---
async function loadPlaylist() {
  const tx = state.db.transaction('songs', 'readonly');
  const songs = await new Promise(res => tx.objectStore('songs').getAll().onsuccess = e => res(e.target.result));
  state.playlist = songs;
  DOM['songs-list'].innerHTML = songs.map(s => `
    <li class="song-item">
      <span>${s.name}</span>
      <button onclick="deleteSong(${s.id})" style="background:none;border:none;color:#ff5252">🗑️</button>
    </li>
  `).join('');
}

window.deleteSong = async (id) => {
  const tx = state.db.transaction('songs', 'readwrite');
  tx.objectStore('songs').delete(id);
  await loadPlaylist();
};

function startPlayback() {
  state.isPlaying = true;
  if (state.playlist.length === 0) {
    DOM['ringing-song-title'].textContent = "電子音を再生中";
    playBeep();
    return;
  }
  state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : 0;
  playSong(state.currentSongIndex);
}

function playSong(idx) {
  if (!state.isPlaying) return;
  const song = state.playlist[idx];
  DOM['ringing-song-title'].textContent = song.name;
  if (state.activeAudio) { state.activeAudio.pause(); URL.revokeObjectURL(state.activeAudio.src); }
  const url = URL.createObjectURL(song.data);
  const a = new Audio(url);
  state.activeAudio = a;
  a.play().catch(() => playBeep());
  a.onended = () => {
    state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : (idx + 1) % state.playlist.length;
    playSong(state.currentSongIndex);
  };
}

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

// --- イベント登録 ---
function registerEvents() {
  DOM['activate-btn'].onclick = () => {
    if (!state.audioContext) state.audioContext = new AudioContext();
    DOM['dummy-video'].play();
    state.isActive = true;
    DOM['activate-btn'].classList.add('hide');
    DOM['activation-status'].classList.remove('hide');
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen');
  };

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
    alert('保存しました');
  };

  DOM['music-files-input'].onchange = async e => {
    const tx = state.db.transaction('songs', 'readwrite');
    for (const f of e.target.files) { tx.objectStore('songs').add({ name: f.name, data: f }); }
    await loadPlaylist();
    alert('登録完了');
  };

  DOM['font-selector'].onchange = e => {
    DOM['clock-display'].style.fontFamily = e.target.value;
    localStorage.setItem('mac_font', e.target.value);
  };

  DOM['btn-enter-fullscreen'].onclick = () => document.body.classList.add('fullscreen-active');
  DOM['clock-display'].onclick = () => document.body.classList.remove('fullscreen-active');

  DOM['brightness-slider'].oninput = e => {
    DOM['dimmer-overlay'].style.backgroundColor = `rgba(0,0,0,${e.target.value/100})`;
    localStorage.setItem('mac_dimmer', e.target.value);
  };

  DOM.themeBtns.forEach(b => b.onclick = () => {
    const t = b.dataset.theme;
    document.body.className = `theme-${t}`;
    localStorage.setItem('mac_theme', t);
    DOM.themeBtns.forEach(btn => btn.classList.toggle('active', btn === b));
  });

  DOM['snooze-btn'].onclick = () => {
    const time = new Date(Date.now() + state.currentAlarm.snooze * 60000);
    state.snoozeAlarms.push({ time, parentId: state.currentAlarm.id, count: state.currentSnoozeCount + 1 });
    stopAll();
  };
  DOM['dismiss-btn'].onclick = () => stopAll();
}

function stopAll() {
  state.isPlaying = false;
  if (state.activeAudio) { state.activeAudio.pause(); }
  clearInterval(beepInterval);
  DOM['alarm-ringing-overlay'].classList.add('hide');
  updateNextAlarmInfo();
}

function saveAlarms() {
  localStorage.setItem('mac_alarms', JSON.stringify(state.alarms));
  renderAlarms();
}

function renderAlarms() {
  DOM['alarm-list'].innerHTML = state.alarms.map(a => `
    <li class="alarm-item">
      <span>${a.time} (${a.days.length?a.days.map(d=>['日','月','火','水','木','金','土'][d]).join(''):'1回'})</span>
      <button onclick="delAlarm(${a.id})" style="background:none;border:none;color:#ff5252">🗑️</button>
    </li>
  `).join('');
  updateNextAlarmInfo();
}

window.delAlarm = id => { state.alarms = state.alarms.filter(a => a.id !== id); saveAlarms(); };

function loadAlarms() {
  state.alarms = JSON.parse(localStorage.getItem('mac_alarms') || '[]');
  renderAlarms();
}

function updateNextAlarmInfo() {
  // 簡易表示
  DOM['next-alarm-info'].textContent = state.alarms.length ? "⏰ アラーム設定中" : "⏰ 設定なし";
}