/**
 * Digital Music Alarm - iPad Perfect Version
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
  // DOM取得
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

  // 初期化
  await initDB();
  await loadPlaylist();
  loadSettings();
  loadAlarms();
  registerEvents();
  
  // 時計ループ
  setInterval(tick, 1000);
  tick();
});

// --- DB管理 ---
async function initDB() {
  return new Promise(res => {
    const req = indexedDB.open('music_db_final', 1);
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
      <span>${s.name.substring(0, 20)}</span>
      <button onclick="deleteSong(${s.id})" style="background:#cc4444; color:white; border:none; padding:8px 12px; border-radius:8px">削除</button>
    </li>
  `).join('');
}

// --- 最重要: iPad向け一括アンロック処理 ---
async function unlockAll() {
  try {
    // 1. AudioContextのレジューム
    if (!state.audioContext) {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

    // 2. 音声再生の通行許可を得る（無音再生）
    const silentAudio = new Audio();
    silentAudio.src = "data:audio/wav;base64,UklGRigAAABXQVZFRm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==";
    await silentAudio.play();

    // 3. スリープ防止ビデオの再生開始
    await DOM['dummy-video'].play();

    // 4. Wake Lock APIのリクエスト
    if ('wakeLock' in navigator) {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        state.wakeLock.addEventListener('release', () => {
          if (state.isActive) requestWakeLock(); // 解除されたら再取得
        });
      } catch (e) { console.warn("WakeLock failed:", e); }
    }

    state.isActive = true;
    DOM['activate-btn'].classList.add('hide');
    DOM['activation-status'].classList.remove('hide');
    alert("アラームが完全に有効化されました。画面を閉じずに置いてください。");
  } catch (err) {
    alert("有効化に失敗しました。もう一度お試しください。");
    console.error(err);
  }
}

async function requestWakeLock() {
  if ('wakeLock' in navigator && state.isActive) {
    try { state.wakeLock = await navigator.wakeLock.request('screen'); } catch(e){}
  }
}

// --- 時計更新ロジック ---
function tick() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  
  DOM['date-display'].textContent = `${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 (${['日','月','火','水','木','金','土'][now.getDay()]})`;
  DOM['clock-display'].innerHTML = `${h}:${m}<span class="sec-main">:${s}</span>`;

  // 秒が0の時にアラーム判定
  if (now.getSeconds() === 0) {
    const timeStr = `${h}:${m}`;
    
    // スヌーズチェック
    const snooze = state.snoozeAlarms.find(sa => sa.time.getHours() === now.getHours() && sa.time.getMinutes() === now.getMinutes());
    
    if (snooze) {
      triggerAlarm(state.alarms.find(a => a.id === snooze.parentId), snooze.count);
      state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa !== snooze);
    } else {
      // 通常アラームチェック
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
  
  // スヌーズボタン表示判定
  const canSnooze = alarm.snooze > 0 && count < MAX_SNOOZE_COUNT;
  DOM['snooze-btn'].classList.toggle('hide', !canSnooze);
  if (canSnooze) DOM['snooze-btn'].textContent = `スヌーズ [${count+1}/${MAX_SNOOZE_COUNT}]`;
  
  state.isPlaying = true;
  startPlayback();
}

function startPlayback() {
  if (state.playlist.length === 0) {
    playBeep();
    DOM['ringing-song-title'].textContent = "電子音を再生中...";
  } else {
    state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : 0;
    playSong(state.currentSongIndex);
  }
}

function playSong(idx) {
  if (!state.isPlaying || !state.playlist[idx]) return;
  const song = state.playlist[idx];
  DOM['ringing-song-title'].textContent = `再生中: ${song.name}`;

  if (state.activeAudio) {
    state.activeAudio.pause();
    URL.revokeObjectURL(state.activeAudio.src);
  }

  const audio = new Audio(URL.createObjectURL(song.data));
  audio.volume = state.volume;
  state.activeAudio = audio;
  audio.play().catch(playBeep);
  
  audio.onended = () => {
    state.currentSongIndex = (DOM['play-mode'].value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : (idx + 1) % state.playlist.length;
    playSong(state.currentSongIndex);
  };
}

let beepInterval;
function playBeep() {
  if (beepInterval) clearInterval(beepInterval);
  const ctx = state.audioContext;
  beepInterval = setInterval(() => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    o.start(); o.stop(ctx.currentTime + 0.5);
  }, 1000);
}

// --- イベント登録 ---
function registerEvents() {
  DOM['activate-btn'].onclick = unlockAll;

  // 音楽ファイル追加
  DOM['music-files-input'].onchange = async e => {
    alert("ファイルを読み込んでいます...");
    for (const f of e.target.files) {
      const tx = state.db.transaction('songs', 'readwrite');
      await new Promise(res => tx.objectStore('songs').add({ name: f.name, data: f }).onsuccess = res);
    }
    await loadPlaylist();
    alert("プレイリストを更新しました");
  };

  DOM['volume-slider'].oninput = e => {
    state.volume = e.target.value;
    if (state.activeAudio) state.activeAudio.volume = state.volume;
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
    alert("アラームを保存しました");
  };

  DOM['font-selector'].onchange = e => {
    const f = e.target.value;
    DOM['clock-display'].style.fontFamily = f;
    document.querySelector('.clock-bg-layer').style.display = f.includes('DSEG') ? 'block' : 'none';
    localStorage.setItem('mac_font', f);
  };

  DOM['btn-enter-fullscreen'].onclick = () => document.body.classList.add('fullscreen-active');
  DOM['clock-display'].onclick = () => {
    if (document.body.classList.contains('fullscreen-active')) {
      document.body.classList.remove('fullscreen-active');
    }
  };

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
    const snoozeTime = new Date(Date.now() + state.currentAlarm.snooze * 60000);
    state.snoozeAlarms.push({ time: snoozeTime, parentId: state.currentAlarm.id, count: state.currentSnoozeCount + 1 });
    stopPlaybackAll();
  };

  DOM['dismiss-btn'].onclick = stopPlaybackAll;
}

function stopPlaybackAll() {
  state.isPlaying = false;
  if (state.activeAudio) state.activeAudio.pause();
  if (beepInterval) clearInterval(beepInterval);
  DOM['alarm-ringing-overlay'].classList.add('hide');
  renderAlarms();
}

function saveAlarms() {
  localStorage.setItem('mac_alarms_final', JSON.stringify(state.alarms));
  renderAlarms();
}

function renderAlarms() {
  DOM['alarm-list'].innerHTML = state.alarms.map(a => `
    <li class="alarm-item">
      <span style="font-family:var(--font-digital); font-size:1.5rem">${a.time}</span>
      <span style="font-size:0.8rem; color:#888">${a.days.length?a.days.map(d=>['日','月','火','水','木','金','土'][d]).join(''):'1回'}</span>
      <button onclick="delAlarm(${a.id})" style="background:#ff4444; color:white; border:none; padding:6px 12px; border-radius:8px">削除</button>
    </li>
  `).join('');
}

function loadSettings() {
  const theme = localStorage.getItem('mac_theme') || 'amber';
  document.body.className = `theme-${theme}`;
  const font = localStorage.getItem('mac_font') || "'DSEG7-Classic', sans-serif";
  DOM['clock-display'].style.fontFamily = font;
  document.querySelector('.clock-bg-layer').style.display = font.includes('DSEG') ? 'block' : 'none';
  DOM['font-selector'].value = font;
  const dimmer = localStorage.getItem('mac_dimmer') || '0';
  DOM['brightness-slider'].value = dimmer;
  DOM['dimmer-overlay'].style.backgroundColor = `rgba(0,0,0,${dimmer/100})`;
}

function loadAlarms() {
  state.alarms = JSON.parse(localStorage.getItem('mac_alarms_final') || '[]');
  renderAlarms();
}

window.delAlarm = id => { state.alarms = state.alarms.filter(a => a.id !== id); saveAlarms(); };
window.deleteSong = async (id) => {
  const tx = state.db.transaction('songs', 'readwrite');
  tx.objectStore('songs').delete(id);
  await loadPlaylist();
};