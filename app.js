/**
 * Music Alarm Clock - iPad Compatibility Fix
 */

const state = {
  alarms: [], playlist: [], currentAlarm: null, currentSnoozeCount: 0,
  snoozeAlarms: [], isPlaying: false, currentSongIndex: -1,
  db: null, wakeLock: null, isActive: false, theme: 'amber',
  dimmerOpacity: 0, audioContext: null, activeAudio: null,
  previewAudio: null, alarmCheckerInterval: null
};

const MAX_SNOOZE_COUNT = 3;
const WEEKDAYS_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

// DOM要素を格納する変数（初期化時に代入）
let DOM = {};

document.addEventListener('DOMContentLoaded', async () => {
  // DOM要素の再取得
  DOM = {
    dateDisplay: document.getElementById('date-display'),
    clockDisplay: document.getElementById('clock-display'),
    nextAlarmInfo: document.getElementById('next-alarm-info'),
    activateBtn: document.getElementById('activate-btn'),
    activationStatus: document.getElementById('activation-status'),
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    alarmForm: document.getElementById('alarm-form'),
    alarmTime: document.getElementById('alarm-time'),
    alarmSnooze: document.getElementById('alarm-snooze'),
    alarmList: document.getElementById('alarm-list'),
    musicFilesInput: document.getElementById('music-files-input'),
    playMode: document.getElementById('play-mode'),
    songsList: document.getElementById('songs-list'),
    playlistCount: document.getElementById('playlist-count'),
    themeBtns: document.querySelectorAll('.theme-btn'),
    brightnessSlider: document.getElementById('brightness-slider'),
    dimmerOverlay: document.getElementById('dimmer-overlay'),
    alarmRingingOverlay: document.getElementById('alarm-ringing-overlay'),
    ringingSongTitle: document.getElementById('ringing-song-title'),
    snoozeBtn: document.getElementById('snooze-btn'),
    dismissBtn: document.getElementById('dismiss-btn'),
    dummyVideo: document.getElementById('dummy-video')
  };

  loadSettings();
  await initDB();
  await loadPlaylist();
  loadAlarms();
  registerEventListeners();
  startClock();
});

// --- 設定管理 ---
function loadSettings() {
  state.theme = localStorage.getItem('mac_theme') || 'amber';
  document.body.className = `theme-${state.theme}`;
  DOM.themeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === state.theme);
  });

  state.dimmerOpacity = parseInt(localStorage.getItem('mac_dimmer') || '0', 10);
  DOM.brightnessSlider.value = state.dimmerOpacity;
  updateDimmer();

  const savedPlayMode = localStorage.getItem('mac_playMode');
  if (savedPlayMode) {
    DOM.playMode.value = savedPlayMode;
  }
}

function updateDimmer() {
  DOM.dimmerOverlay.style.backgroundColor = `rgba(0, 0, 0, ${state.dimmerOpacity / 100})`;
}

// --- IndexedDB ---
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('music_db', 1);
    request.onerror = (e) => reject('Database error: ' + e.target.errorCode);
    request.onsuccess = (e) => {
      state.db = e.target.result;
      resolve();
    };
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('songs')) {
        db.createObjectStore('songs', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function addSongToDB(file) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(['songs'], 'readwrite');
    const store = transaction.objectStore('songs');
    const songData = { name: file.name, type: file.type, data: file, addedAt: Date.now() };
    const request = store.add(songData);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

function getSongsFromDB() {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(['songs'], 'readonly');
    const store = transaction.objectStore('songs');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function deleteSongFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = state.db.transaction(['songs'], 'readwrite');
    const store = transaction.objectStore('songs');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// --- プレイリスト管理 ---
async function loadPlaylist() {
  try {
    state.playlist = await getSongsFromDB();
    renderPlaylist();
  } catch (error) {
    console.error('プレイリストの読み込みに失敗しました', error);
  }
}

function renderPlaylist() {
  DOM.songsList.innerHTML = '';
  DOM.playlistCount.textContent = state.playlist.length;
  if (state.playlist.length === 0) {
    DOM.songsList.innerHTML = '<li class="empty-list-msg">曲が登録されていません。</li>';
    return;
  }
  state.playlist.forEach((song) => {
    const li = document.createElement('li');
    li.className = 'song-item';
    li.innerHTML = `
      <div class="song-title-col">
        <span class="song-icon">🎵</span>
        <span class="song-title" title="${song.name}">${song.name}</span>
      </div>
      <div class="song-actions">
        <button class="btn-play-preview" data-id="${song.id}">▶ 試聴</button>
        <button class="btn-delete-song" data-id="${song.id}">🗑️</button>
      </div>
    `;
    // イベントリスナーをボタンに直接付与
    li.querySelector('.btn-play-preview').onclick = () => togglePreview(song);
    li.querySelector('.btn-delete-song').onclick = async () => {
      if (confirm(`「${song.name}」を削除しますか？`)) {
        stopPreview();
        await deleteSongFromDB(song.id);
        await loadPlaylist();
      }
    };
    DOM.songsList.appendChild(li);
  });
}

function togglePreview(song) {
  if (state.previewAudio && state.previewAudio.dataset.songId == song.id) {
    stopPreview();
    return;
  }
  stopPreview();
  const objectUrl = URL.createObjectURL(song.data);
  const audio = new Audio(objectUrl);
  audio.dataset.songId = song.id;
  state.previewAudio = audio;
  audio.play().catch(err => {
    alert('iOSでは「アラームを有効化」を先に押してください。');
    stopPreview();
  });
  audio.onended = () => stopPreview();
}

function stopPreview() {
  if (state.previewAudio) {
    state.previewAudio.pause();
    URL.revokeObjectURL(state.previewAudio.src);
    state.previewAudio = null;
  }
}

// --- アラーム管理 ---
function loadAlarms() {
  const saved = localStorage.getItem('mac_alarms');
  state.alarms = saved ? JSON.parse(saved) : [];
  renderAlarms();
  updateNextAlarmInfo();
}

function saveAlarms() {
  localStorage.setItem('mac_alarms', JSON.stringify(state.alarms));
  renderAlarms();
  updateNextAlarmInfo();
}

function renderAlarms() {
  DOM.alarmList.innerHTML = '';
  if (state.alarms.length === 0) {
    DOM.alarmList.innerHTML = '<li class="empty-list-msg">アラームが設定されていません。</li>';
    return;
  }
  const sortedAlarms = [...state.alarms].sort((a, b) => a.time.localeCompare(b.time));
  sortedAlarms.forEach((alarm) => {
    const li = document.createElement('li');
    li.className = 'alarm-item';
    let daysText = alarm.days.length === 7 ? '毎日' : (alarm.days.length === 0 ? '1回のみ' : alarm.days.map(d => WEEKDAYS_SHORT[d]).join('・'));
    li.innerHTML = `
      <div class="alarm-info">
        <span class="alarm-time-text">${alarm.time}</span>
        <span class="alarm-days-text">${daysText} | スヌーズ:${alarm.snooze}分</span>
      </div>
      <div class="alarm-control">
        <label class="switch">
          <input type="checkbox" ${alarm.active ? 'checked' : ''} class="toggle-alarm" data-id="${alarm.id}">
          <span class="slider"></span>
        </label>
        <button class="btn-delete" onclick="deleteAlarm(${alarm.id})">🗑️</button>
      </div>
    `;
    li.querySelector('.toggle-alarm').onchange = (e) => {
      const target = state.alarms.find(a => a.id === alarm.id);
      if (target) {
        target.active = e.target.checked;
        if (target.active) state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa.parentId !== alarm.id);
        saveAlarms();
      }
    };
    DOM.alarmList.appendChild(li);
  });
}

function deleteAlarm(id) {
  if (confirm(`アラームを削除しますか？`)) {
    state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa.parentId !== id);
    state.alarms = state.alarms.filter(a => a.id !== id);
    saveAlarms();
  }
}

function updateNextAlarmInfo() {
  const next = getNextAlarmTime();
  if (!next) {
    DOM.nextAlarmInfo.innerHTML = '<span class="alarm-icon">⏰</span> 次のアラーム: 設定なし';
    return;
  }
  const diffMs = next.time.getTime() - Date.now();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const alarmLabel = next.isSnooze ? 'スヌーズ' : 'アラーム';
  DOM.nextAlarmInfo.innerHTML = `<span class="alarm-icon">⏰</span> 次の${alarmLabel}: ${next.time.getHours()}:${String(next.time.getMinutes()).padStart(2, '0')} (${diffHrs}時間${diffMins}分後)`;
}

function getNextAlarmTime() {
  const now = new Date();
  let nearestAlarm = null;
  let minDiff = Infinity;

  state.snoozeAlarms.forEach((sa) => {
    const diff = sa.time.getTime() - now.getTime();
    if (diff > 0 && diff < minDiff) { minDiff = diff; nearestAlarm = { time: sa.time, isSnooze: true }; }
  });

  state.alarms.forEach((alarm) => {
    if (!alarm.active) return;
    const [h, m] = alarm.time.split(':').map(Number);
    if (alarm.days.length > 0) {
      for (let i = 0; i < 8; i++) {
        const testDate = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
        testDate.setHours(h, m, 0, 0);
        if (alarm.days.includes(testDate.getDay()) && testDate.getTime() > now.getTime()) {
          const diff = testDate.getTime() - now.getTime();
          if (diff < minDiff) { minDiff = diff; nearestAlarm = { time: testDate, isSnooze: false }; }
          break;
        }
      }
    } else {
      let testDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
      if (testDate.getTime() <= now.getTime()) testDate.setDate(testDate.getDate() + 1);
      const diff = testDate.getTime() - now.getTime();
      if (diff < minDiff) { minDiff = diff; nearestAlarm = { time: testDate, isSnooze: false }; }
    }
  });
  return nearestAlarm;
}

// --- 時計ロジック & アラームトリガー ---
function startClock() {
  updateClock();
  state.alarmCheckerInterval = setInterval(() => {
    updateClock();
    checkAlarmTrigger();
  }, 1000);
}

function updateClock() {
  const now = new Date();
  DOM.dateDisplay.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 (${WEEKDAYS_SHORT[now.getDay()]})`;
  DOM.clockDisplay.innerHTML = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}<span class="seconds-text">:${String(now.getSeconds()).padStart(2, '0')}</span>`;
}

function checkAlarmTrigger() {
  const now = new Date();
  if (now.getSeconds() !== 0) return;
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const nowTimeStr = `${String(currentHours).padStart(2, '0')}:${String(currentMinutes).padStart(2, '0')}`;

  const dueSnoozes = state.snoozeAlarms.filter(sa => sa.time.getHours() === currentHours && sa.time.getMinutes() === currentMinutes);
  if (dueSnoozes.length > 0) {
    const ds = dueSnoozes[0];
    const parentAlarm = state.alarms.find(a => a.id === ds.parentId);
    triggerAlarm(parentAlarm || { id: Date.now(), snooze: ds.snoozeMinutes }, ds.count);
    state.snoozeAlarms = state.snoozeAlarms.filter(sa => !dueSnoozes.includes(sa));
    updateNextAlarmInfo();
    return;
  }

  state.alarms.forEach(alarm => {
    if (alarm.active && alarm.time === nowTimeStr) {
      if (alarm.days.length === 0 || alarm.days.includes(now.getDay())) {
        if (alarm.days.length === 0) { alarm.active = false; saveAlarms(); }
        triggerAlarm(alarm, 0);
      }
    }
  });
}

function triggerAlarm(alarm, snoozeCount = 0) {
  state.currentAlarm = alarm;
  state.currentSnoozeCount = snoozeCount;
  DOM.alarmRingingOverlay.classList.remove('hide');
  stopPreview();
  startPlaylistPlayback();
  
  if (alarm.snooze > 0 && state.currentSnoozeCount < MAX_SNOOZE_COUNT) {
    DOM.snoozeBtn.classList.remove('hide');
    DOM.snoozeBtn.textContent = `スヌーズ (${alarm.snooze}分) [${state.currentSnoozeCount + 1}/${MAX_SNOOZE_COUNT}]`;
  } else {
    DOM.snoozeBtn.classList.add('hide');
  }
}

// --- 音楽再生 ---
function startPlaylistPlayback() {
  state.isPlaying = true;
  if (state.playlist.length === 0) {
    startFallbackBeep();
    DOM.ringingSongTitle.textContent = '再生中: 電子アラーム音';
    return;
  }
  state.currentSongIndex = (DOM.playMode.value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : 0;
  playPlaylistSong(state.currentSongIndex);
}

function playPlaylistSong(index) {
  if (!state.isPlaying || index < 0 || index >= state.playlist.length) return;
  const song = state.playlist[index];
  DOM.ringingSongTitle.textContent = `再生中: ${song.name}`;
  if (state.activeAudio) { state.activeAudio.pause(); URL.revokeObjectURL(state.activeAudio.src); }
  const objectUrl = URL.createObjectURL(song.data);
  const audio = new Audio(objectUrl);
  state.activeAudio = audio;
  audio.play().catch(() => startFallbackBeep());
  audio.onended = () => {
    state.currentSongIndex = (DOM.playMode.value === 'shuffle') ? Math.floor(Math.random() * state.playlist.length) : (state.currentSongIndex + 1) % state.playlist.length;
    playPlaylistSong(state.currentSongIndex);
  };
}

function stopPlaylistPlayback() {
  state.isPlaying = false;
  if (state.activeAudio) { state.activeAudio.pause(); URL.revokeObjectURL(state.activeAudio.src); state.activeAudio = null; }
  stopFallbackBeep();
}

let fallbackInterval = null;
function startFallbackBeep() {
  stopFallbackBeep();
  if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  fallbackInterval = setInterval(() => {
    if (!state.isPlaying) return;
    const osc = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    osc.connect(gain); gain.connect(state.audioContext.destination);
    osc.frequency.setValueAtTime(880, state.audioContext.currentTime);
    gain.gain.setValueAtTime(0.5, state.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, state.audioContext.currentTime + 0.3);
    osc.start(); osc.stop(state.audioContext.currentTime + 0.35);
  }, 1000);
}

function stopFallbackBeep() { if (fallbackInterval) { clearInterval(fallbackInterval); fallbackInterval = null; } }

function snoozeCurrentAlarm() {
  if (!state.currentAlarm || state.currentSnoozeCount >= MAX_SNOOZE_COUNT) return;
  const snoozeTime = new Date(Date.now() + state.currentAlarm.snooze * 60 * 1000);
  state.snoozeAlarms.push({ time: snoozeTime, parentId: state.currentAlarm.id, snoozeMinutes: state.currentAlarm.snooze, count: state.currentSnoozeCount + 1 });
  stopPlaylistPlayback();
  DOM.alarmRingingOverlay.classList.add('hide');
  state.currentAlarm = null;
  updateNextAlarmInfo();
}

function dismissCurrentAlarm() {
  stopPlaylistPlayback();
  if (state.currentAlarm) state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa.parentId !== state.currentAlarm.id);
  DOM.alarmRingingOverlay.classList.add('hide');
  state.currentAlarm = null;
  updateNextAlarmInfo();
}

// --- アクティブ化 ---
async function activateApp() {
  if (!state.audioContext) state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioContext.state === 'suspended') state.audioContext.resume();
  DOM.dummyVideo.play().catch(console.error);
  if ('wakeLock' in navigator) requestWakeLock();
  state.isActive = true;
  DOM.activateBtn.classList.add('hide');
  DOM.activationStatus.classList.remove('hide');
}

async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
  } catch (err) { console.error(err); }
}

// --- イベントリスナー登録 ---
function registerEventListeners() {
  // すべて addEventListener ('click', ...) に変更
  DOM.activateBtn.addEventListener('click', activateApp);
  
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      DOM.tabBtns.forEach(b => b.classList.remove('active'));
      DOM.tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetContent = document.getElementById(`tab-${tabId}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });

  DOM.alarmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const checkedDays = Array.from(DOM.alarmForm.querySelectorAll('.weekdays-select input:checked')).map(i => parseInt(i.value));
    state.alarms.push({ id: Date.now(), time: DOM.alarmTime.value, snooze: parseInt(DOM.alarmSnooze.value), days: checkedDays, active: true });
    saveAlarms();
    DOM.alarmForm.querySelectorAll('input[type="checkbox"]').forEach(i => i.checked = false);
    alert('アラームを保存しました');
  });

  DOM.musicFilesInput.addEventListener('change', async (e) => {
    for (const file of e.target.files) { await addSongToDB(file); }
    await loadPlaylist();
    alert('曲を登録しました');
    DOM.musicFilesInput.value = '';
  });

  DOM.themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.theme = btn.dataset.theme;
      DOM.themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.body.className = `theme-${state.theme}`;
      localStorage.setItem('mac_theme', state.theme);
    });
  });

  DOM.brightnessSlider.addEventListener('input', (e) => {
    state.dimmerOpacity = e.target.value;
    updateDimmer();
  });
  DOM.brightnessSlider.addEventListener('change', (e) => localStorage.setItem('mac_dimmer', e.target.value));

  DOM.snoozeBtn.addEventListener('click', snoozeCurrentAlarm);
  DOM.dismissBtn.addEventListener('click', dismissCurrentAlarm);
  DOM.playMode.addEventListener('change', (e) => localStorage.setItem('mac_playMode', e.target.value));
}