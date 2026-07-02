/**
 * Music Alarm Clock - Core Application Logic
 */

// --- 状態管理 ---
const state = {
  alarms: [],
  playlist: [],
  currentAlarm: null, // 現在鳴動中のアラーム
  snoozeAlarms: [], // スヌーズ中のアラーム { time: Date, parentId: id, snoozeMinutes: mins }
  isPlaying: false,
  currentSongIndex: -1,
  db: null,
  wakeLock: null,
  isActive: false, // iOS向けのスリープ防止・音声有効化状態
  theme: 'amber',
  dimmerOpacity: 0,
  audioContext: null,
  activeAudio: null, // 再生中のオーディオオブジェクト
  previewAudio: null, // 試聴中のオーディオオブジェクト
  alarmCheckerInterval: null
};

// 曜日名のマッピング
const WEEKDAYS_SHORT = ['日', '月', '火', '水', '木', '金', '土'];

// --- DOM 要素の取得 ---
const DOM = {
  dateDisplay: document.getElementById('date-display'),
  clockDisplay: document.getElementById('clock-display'),
  nextAlarmInfo: document.getElementById('next-alarm-info'),
  activateBtn: document.getElementById('activate-btn'),
  activationStatus: document.getElementById('activation-status'),
  
  // タブ
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  
  // アラーム
  alarmForm: document.getElementById('alarm-form'),
  alarmTime: document.getElementById('alarm-time'),
  alarmSnooze: document.getElementById('alarm-snooze'),
  alarmList: document.getElementById('alarm-list'),
  
  // プレイリスト
  musicFilesInput: document.getElementById('music-files-input'),
  playMode: document.getElementById('play-mode'),
  songsList: document.getElementById('songs-list'),
  playlistCount: document.getElementById('playlist-count'),
  
  // ディスプレイ
  themeBtns: document.querySelectorAll('.theme-btn'),
  brightnessSlider: document.getElementById('brightness-slider'),
  dimmerOverlay: document.getElementById('dimmer-overlay'),
  
  // アラーム鳴動オーバーレイ
  alarmRingingOverlay: document.getElementById('alarm-ringing-overlay'),
  ringingSongTitle: document.getElementById('ringing-song-title'),
  snoozeBtn: document.getElementById('snooze-btn'),
  dismissBtn: document.getElementById('dismiss-btn'),
  
  // ダミービデオ
  dummyVideo: document.getElementById('dummy-video')
};

// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', async () => {
  // テーマと明るさの復元
  loadSettings();
  
  // IndexedDBの初期化
  await initDB();
  
  // プレイリストの読み込み
  await loadPlaylist();
  
  // 保存されたアラームの読み込み
  loadAlarms();
  
  // イベントリスナーの登録
  registerEventListeners();
  
  // 時計の開始
  startClock();
});

// --- LocalStorageによる設定の読み込み/保存 ---
function loadSettings() {
  // テーマ
  state.theme = localStorage.getItem('mac_theme') || 'amber';
  document.body.className = `theme-${state.theme}`;
  DOM.themeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === state.theme);
  });

  // 疑似調光
  state.dimmerOpacity = parseInt(localStorage.getItem('mac_dimmer') || '0', 10);
  DOM.brightnessSlider.value = state.dimmerOpacity;
  updateDimmer();

  // 再生モード
  const savedPlayMode = localStorage.getItem('mac_playMode');
  if (savedPlayMode) {
    DOM.playMode.value = savedPlayMode;
  }
}

function updateDimmer() {
  DOM.dimmerOverlay.style.backgroundColor = `rgba(0, 0, 0, ${state.dimmerOpacity / 100})`;
}

// --- IndexedDB: 音楽ファイルの永続化 ---
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
    
    const songData = {
      name: file.name,
      type: file.type,
      data: file, // FileオブジェクトはBlobを継承しており、IndexedDBにそのまま保存可能
      addedAt: Date.now()
    };
    
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
    DOM.songsList.innerHTML = '<li class="empty-list-msg">曲が登録されていません。上のボタンから追加してください。</li>';
    return;
  }
  
  state.playlist.forEach((song) => {
    const li = document.createElement('li');
    li.className = 'song-item';
    
    const titleCol = document.createElement('div');
    titleCol.className = 'song-title-col';
    
    const icon = document.createElement('span');
    icon.className = 'song-icon';
    icon.textContent = '🎵';
    
    const title = document.createElement('span');
    title.className = 'song-title';
    title.textContent = song.name;
    title.title = song.name;
    
    titleCol.appendChild(icon);
    titleCol.appendChild(title);
    
    const actions = document.createElement('div');
    actions.className = 'song-actions';
    
    // 試聴ボタン
    const previewBtn = document.createElement('button');
    previewBtn.className = 'btn-play-preview';
    previewBtn.textContent = '▶ 試聴';
    previewBtn.onclick = () => togglePreview(song);
    
    // 削除ボタン
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.onclick = async () => {
      if (confirm(`「${song.name}」を削除しますか？`)) {
        stopPreview();
        await deleteSongFromDB(song.id);
        await loadPlaylist();
      }
    };
    
    actions.appendChild(previewBtn);
    actions.appendChild(deleteBtn);
    
    li.appendChild(titleCol);
    li.appendChild(actions);
    DOM.songsList.appendChild(li);
  });
}

// 試聴機能の制御
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
  
  // 全てのプレビューボタンのテキストを元に戻す
  document.querySelectorAll('.btn-play-preview').forEach(btn => btn.textContent = '▶ 試聴');
  
  // クリックされたボタンのテキストを「■ 停止」にする
  event.target.textContent = '■ 停止';
  
  audio.play().catch(err => {
    console.error('プレビューの再生に失敗しました', err);
    alert('iOSでは、あらかじめ「アラームを有効化」ボタンを押して再生許可を有効にする必要があります。');
    stopPreview();
  });
  
  audio.onended = () => {
    stopPreview();
  };
}

function stopPreview() {
  if (state.previewAudio) {
    state.previewAudio.pause();
    URL.revokeObjectURL(state.previewAudio.src);
    state.previewAudio = null;
  }
  document.querySelectorAll('.btn-play-preview').forEach(btn => btn.textContent = '▶ 試聴');
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
  
  // 時刻順にソートして表示
  const sortedAlarms = [...state.alarms].sort((a, b) => a.time.localeCompare(b.time));
  
  sortedAlarms.forEach((alarm) => {
    const li = document.createElement('li');
    li.className = 'alarm-item';
    
    const info = document.createElement('div');
    info.className = 'alarm-info';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'alarm-time-text';
    timeSpan.textContent = alarm.time;
    
    const daysSpan = document.createElement('span');
    daysSpan.className = 'alarm-days-text';
    
    let daysText = '';
    if (alarm.days.length === 7) {
      daysText = '毎日';
    } else if (alarm.days.length === 0) {
      daysText = '1回のみ';
    } else {
      // 曜日を月曜始まり等でソートして表記
      daysText = alarm.days.map(d => WEEKDAYS_SHORT[d]).join('・');
    }
    
    let snoozeText = alarm.snooze > 0 ? `スヌーズ: ${alarm.snooze}分` : 'スヌーズなし';
    
    daysSpan.textContent = `${daysText} | ${snoozeText}`;
    
    info.appendChild(timeSpan);
    info.appendChild(daysSpan);
    
    const control = document.createElement('div');
    control.className = 'alarm-control';
    
    // ON/OFF トグルスイッチ
    const switchLabel = document.createElement('label');
    switchLabel.className = 'switch';
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = alarm.active;
    input.onchange = (e) => {
      alarm.active = e.target.checked;
      // アクティブになったら、そのアラームに関連する過去のスヌーズは消去する
      if (alarm.active) {
        state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa.parentId !== alarm.id);
      }
      saveAlarms();
    };
    
    const slider = document.createElement('span');
    slider.className = 'slider';
    
    switchLabel.appendChild(input);
    switchLabel.appendChild(slider);
    
    // 削除ボタン
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.onclick = () => {
      if (confirm(`${alarm.time} のアラームを削除しますか？`)) {
        // スヌーズも削除
        state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa.parentId !== alarm.id);
        state.alarms = state.alarms.filter(a => a.id !== alarm.id);
        saveAlarms();
      }
    };
    
    control.appendChild(switchLabel);
    control.appendChild(deleteBtn);
    
    li.appendChild(info);
    li.appendChild(control);
    DOM.alarmList.appendChild(li);
  });
}

// --- 次のアラーム時刻の計算と表示 ---
function updateNextAlarmInfo() {
  const next = getNextAlarmTime();
  if (!next) {
    DOM.nextAlarmInfo.innerHTML = '<span class="alarm-icon">⏰</span> 次のアラーム: 設定なし';
    return;
  }
  
  const diffMs = next.time.getTime() - Date.now();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  let remainingText = '';
  if (diffHrs > 0) {
    remainingText = `${diffHrs}時間${diffMins}分後`;
  } else {
    remainingText = `${diffMins}分後`;
  }
  
  const month = next.time.getMonth() + 1;
  const date = next.time.getDate();
  const day = WEEKDAYS_SHORT[next.time.getDay()];
  const hours = String(next.time.getHours()).padStart(2, '0');
  const minutes = String(next.time.getMinutes()).padStart(2, '0');
  
  let alarmLabel = next.isSnooze ? 'スヌーズ' : 'アラーム';
  
  DOM.nextAlarmInfo.innerHTML = `<span class="alarm-icon">⏰</span> 次の${alarmLabel}: ${month}/${date}(${day}) ${hours}:${minutes} (${remainingText})`;
}

// 最も近い次のアラームを取得する関数
function getNextAlarmTime() {
  const now = new Date();
  let nearestAlarm = null;
  let minDiff = Infinity;
  
  // 1. スヌーズ中のアラームがあれば最優先で考慮
  state.snoozeAlarms.forEach((sa) => {
    const diff = sa.time.getTime() - now.getTime();
    if (diff > 0 && diff < minDiff) {
      minDiff = diff;
      nearestAlarm = { time: sa.time, isSnooze: true };
    }
  });
  
  // 2. 通常のアクティブなアラームをチェック
  state.alarms.forEach((alarm) => {
    if (!alarm.active) return;
    
    const [hStr, mStr] = alarm.time.split(':');
    const targetHours = parseInt(hStr, 10);
    const targetMinutes = parseInt(mStr, 10);
    
    // 曜日指定ありの場合
    if (alarm.days.length > 0) {
      // 今日から数えて最も近い該当曜日を探す
      for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
        const testDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
        testDate.setHours(targetHours, targetMinutes, 0, 0);
        
        // 曜日が一致するかチェック
        if (alarm.days.includes(testDate.getDay())) {
          // 今日のその時刻がすでに過ぎている場合は翌週の同じ曜日にスキップ
          if (dayOffset === 0 && testDate.getTime() <= now.getTime()) {
            continue;
          }
          
          const diff = testDate.getTime() - now.getTime();
          if (diff > 0 && diff < minDiff) {
            minDiff = diff;
            nearestAlarm = { time: testDate, isSnooze: false };
          }
          break; // このアラームに対しては一番近い曜日が見つかったので内側のループを終了
        }
      }
    } else {
      // 曜日指定なし（1回のみ）の場合
      let testDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHours, targetMinutes, 0, 0);
      
      // すでに今日の時刻を過ぎている場合は明日の同時刻にする
      if (testDate.getTime() <= now.getTime()) {
        testDate.setDate(testDate.getDate() + 1);
      }
      
      const diff = testDate.getTime() - now.getTime();
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
        nearestAlarm = { time: testDate, isSnooze: false };
      }
    }
  });
  
  return nearestAlarm;
}

// --- 時計ロジック & アラームトリガー ---
function startClock() {
  updateClock();
  
  // 1秒に1回時刻更新とアラーム判定
  state.alarmCheckerInterval = setInterval(() => {
    updateClock();
    checkAlarmTrigger();
  }, 1000);
}

function updateClock() {
  const now = new Date();
  
  // 日付
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const day = WEEKDAYS_SHORT[now.getDay()];
  DOM.dateDisplay.textContent = `${year}年${month}月${date}日 (${day})`;
  
  // 時間
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  DOM.clockDisplay.innerHTML = `${hours}:${minutes}<span class="seconds-text">:${seconds}</span>`;
}

// 毎秒呼び出して、アラームがトリガーされるべきか判定
function checkAlarmTrigger() {
  const now = new Date();
  
  // 秒が 0 の瞬間にのみアラーム時刻の突合チェックを行う（1分間に何度もトリガーされるのを防ぐ）
  if (now.getSeconds() !== 0) return;
  
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentDay = now.getDay();
  
  // アラームの時刻文字列 (例: "07:00")
  const nowTimeStr = `${String(currentHours).padStart(2, '0')}:${String(currentMinutes).padStart(2, '0')}`;
  
  // 1. まずスヌーズ中のアラームが今かチェック
  const dueSnoozes = state.snoozeAlarms.filter(sa => {
    const saTime = sa.time;
    return saTime.getHours() === currentHours && saTime.getMinutes() === currentMinutes;
  });
  
  if (dueSnoozes.length > 0) {
    // 該当するスヌーズ元の親アラームを探す
    const parentAlarm = state.alarms.find(a => a.id === dueSnoozes[0].parentId);
    // スヌーズを鳴動させる
    triggerAlarm(parentAlarm || { id: Date.now(), snooze: dueSnoozes[0].snoozeMinutes });
    // 発火したスヌーズはリストから消去する
    state.snoozeAlarms = state.snoozeAlarms.filter(sa => !dueSnoozes.includes(sa));
    updateNextAlarmInfo();
    return;
  }
  
  // 2. 通常アラームのチェック
  state.alarms.forEach(async (alarm) => {
    if (!alarm.active) return;
    
    if (alarm.time === nowTimeStr) {
      let isTriggerDay = false;
      
      if (alarm.days.length === 0) {
        // 曜日指定なしなら「1回のみ」なので必ず発火
        isTriggerDay = true;
        // 発火したため、このアラームはOFFにする
        alarm.active = false;
        saveAlarms();
      } else if (alarm.days.includes(currentDay)) {
        // 指定された曜日と合致すれば発火
        isTriggerDay = true;
      }
      
      if (isTriggerDay) {
        // アラーム発火
        triggerAlarm(alarm);
      }
    }
  });
}

// アラーム発火処理
function triggerAlarm(alarm) {
  state.currentAlarm = alarm;
  DOM.alarmRingingOverlay.classList.remove('hide');
  
  // 試聴があれば停止
  stopPreview();
  
  // 音楽再生の開始
  startPlaylistPlayback();
  
  // スヌーズ設定があるかないかでボタンの表示/無効化を切り替え
  if (alarm.snooze > 0) {
    DOM.snoozeBtn.classList.remove('hide');
    DOM.snoozeBtn.textContent = `スヌーズ (${alarm.snooze}分)`;
  } else {
    DOM.snoozeBtn.classList.add('hide');
  }
}

// --- プレイリスト再生制御 ---
function startPlaylistPlayback() {
  state.isPlaying = true;
  
  if (state.playlist.length === 0) {
    // 曲が登録されていない場合の代替アラーム音 (Web Audio API による発振音)
    startFallbackBeep();
    DOM.ringingSongTitle.textContent = '再生中: デフォルトのアラーム音 (ピピピ...)';
    return;
  }
  
  // 再生曲順のインデックスを計算
  if (DOM.playMode.value === 'shuffle') {
    state.currentSongIndex = Math.floor(Math.random() * state.playlist.length);
  } else {
    state.currentSongIndex = 0;
  }
  
  playPlaylistSong(state.currentSongIndex);
}

function playPlaylistSong(index) {
  if (!state.isPlaying || index < 0 || index >= state.playlist.length) {
    stopPlaylistPlayback();
    return;
  }
  
  const song = state.playlist[index];
  DOM.ringingSongTitle.textContent = `再生中: ${song.name}`;
  
  // 既存のオーディオオブジェクトがあれば破棄
  if (state.activeAudio) {
    state.activeAudio.pause();
    URL.revokeObjectURL(state.activeAudio.src);
  }
  
  const objectUrl = URL.createObjectURL(song.data);
  const audio = new Audio(objectUrl);
  audio.loop = false;
  state.activeAudio = audio;
  
  audio.play().catch(err => {
    console.error('プレイリスト曲の再生に失敗しました', err);
    // 再生エラーが起きた場合はフォールバック音を鳴らす
    startFallbackBeep();
  });
  
  audio.onended = () => {
    // 次の曲へ
    if (DOM.playMode.value === 'shuffle') {
      state.currentSongIndex = Math.floor(Math.random() * state.playlist.length);
    } else {
      state.currentSongIndex = (state.currentSongIndex + 1) % state.playlist.length;
    }
    playPlaylistSong(state.currentSongIndex);
  };
}

function stopPlaylistPlayback() {
  state.isPlaying = false;
  
  if (state.activeAudio) {
    state.activeAudio.pause();
    URL.revokeObjectURL(state.activeAudio.src);
    state.activeAudio = null;
  }
  
  stopFallbackBeep();
}

// フォールバック用のビープ音発振タイマー
let fallbackInterval = null;
function startFallbackBeep() {
  stopFallbackBeep();
  
  // iOSの再生制限を解除するために作成したAudioContextを使用（または新規作成）
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  const ctx = state.audioContext;
  
  // ピピピと断続的にビープ音を鳴らす処理
  fallbackInterval = setInterval(() => {
    if (!state.isPlaying) return;
    
    // 短いビープ音を一音鳴らす
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sine'; // サイン波
    osc.frequency.setValueAtTime(880, ctx.currentTime); // 880Hz (ラ)
    
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3); // 0.3秒で減衰
    
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  }, 1000); // 1秒間隔で繰り返す
}

function stopFallbackBeep() {
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
  }
}

// --- スヌーズとアラーム停止のハンドラ ---
function snoozeCurrentAlarm() {
  if (!state.currentAlarm) return;
  
  const snoozeMinutes = state.currentAlarm.snooze;
  if (snoozeMinutes <= 0) return;
  
  // 現在時刻からN分後の時刻を計算
  const now = new Date();
  const snoozeTime = new Date(now.getTime() + snoozeMinutes * 60 * 1000);
  
  // スヌーズを登録
  state.snoozeAlarms.push({
    time: snoozeTime,
    parentId: state.currentAlarm.id,
    snoozeMinutes: snoozeMinutes
  });
  
  // 再生を一時停止
  stopPlaylistPlayback();
  
  // オーバーレイを閉じる
  DOM.alarmRingingOverlay.classList.add('hide');
  state.currentAlarm = null;
  
  updateNextAlarmInfo();
}

function dismissCurrentAlarm() {
  // アラーム音を完全に停止
  stopPlaylistPlayback();
  
  // 該当するアラームに関連するすべてのスヌーズを消去
  if (state.currentAlarm) {
    state.snoozeAlarms = state.snoozeAlarms.filter(sa => sa.parentId !== state.currentAlarm.id);
  }
  
  // オーバーレイを閉じる
  DOM.alarmRingingOverlay.classList.add('hide');
  state.currentAlarm = null;
  
  updateNextAlarmInfo();
}

// --- iOS向けスリープ防止＆オーディオアンロックのアクティブ化 ---
function activateApp() {
  // Web Audio Context の有効化（音声のブロック解除）
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === 'suspended') {
    state.audioContext.resume();
  }
  
  // iOSの自動スリープ（ロック）を防止するために非表示のダミー動画をループ再生
  DOM.dummyVideo.play().then(() => {
    console.log('スリープ防止用ダミー動画の再生を開始しました');
  }).catch(err => {
    console.error('ダミー動画の再生開始に失敗しました', err);
  });
  
  // PWA/モダンブラウザでのScreen Wake Lock APIの呼び出し（サポートされている場合）
  if ('wakeLock' in navigator) {
    requestWakeLock();
  }
  
  state.isActive = true;
  DOM.activateBtn.classList.add('hide');
  DOM.activationStatus.classList.remove('hide');
  
  // iOS Safari等での無音オーディオのテスト再生（無音ファイルの生成と再生）
  const silentBuffer = state.audioContext.createBuffer(1, 1, 22050);
  const source = state.audioContext.createBufferSource();
  source.buffer = silentBuffer;
  source.connect(state.audioContext.destination);
  source.start(0);
}

// Screen Wake Lock API のリクエスト
async function requestWakeLock() {
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => {
      console.log('Wake Lock was released');
      // フォーカスが戻ってきたときなどに再取得するため
      if (state.isActive) {
        requestWakeLock();
      }
    });
    console.log('Wake Lock is active');
  } catch (err) {
    console.error(`Wake Lock error: ${err.name}, ${err.message}`);
  }
}

// 画面の再フォーカス時にWake Lockを再取得
document.addEventListener('visibilitychange', async () => {
  if (state.wakeLock !== null && document.visibilityState === 'visible' && state.isActive) {
    await requestWakeLock();
    // ダミー動画も再再生
    DOM.dummyVideo.play().catch(e => console.log('Re-play dummy video failed:', e));
  }
});

// --- イベントリスナーの登録 ---
function registerEventListeners() {
  // iOSアクティベートボタン
  DOM.activateBtn.addEventListener('click', activateApp);
  
  // タブ切り替え
  DOM.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      
      DOM.tabBtns.forEach(b => b.classList.remove('active'));
      DOM.tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(`tab-${tabName}`).classList.add('active');
    });
  });
  
  // アラーム保存フォーム送信
  DOM.alarmForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const time = DOM.alarmTime.value;
    const snooze = parseInt(DOM.alarmSnooze.value, 10);
    
    // チェックされている曜日を取得
    const checkedDays = [];
    DOM.alarmForm.querySelectorAll('.weekdays-select input:checked').forEach(input => {
      checkedDays.push(parseInt(input.value, 10));
    });
    
    const newAlarm = {
      id: Date.now(),
      time: time,
      snooze: snooze,
      days: checkedDays,
      active: true
    };
    
    state.alarms.push(newAlarm);
    saveAlarms();
    
    // フォームリセット (曜日のチェックを外す)
    DOM.alarmForm.querySelectorAll('.weekdays-select input').forEach(input => {
      input.checked = false;
    });
    
    // 設定タブのアラームリストを表示更新するために再レンダリングされる
    alert(`${time} のアラームを追加しました！`);
  });
  
  // 音楽ファイルの選択時処理
  DOM.musicFilesInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;
    
    let addedCount = 0;
    
    // ローディング中などのインジケータを入れると良いが、シンプルなalertで対応
    for (let i = 0; i < files.length; i++) {
      try {
        await addSongToDB(files[i]);
        addedCount++;
      } catch (err) {
        console.error('曲の保存に失敗:', files[i].name, err);
      }
    }
    
    if (addedCount > 0) {
      alert(`${addedCount}個の曲を登録しました。`);
      await loadPlaylist();
    } else {
      alert('曲の登録に失敗しました。');
    }
    
    // inputをクリアして同じファイルを再選択可能に
    DOM.musicFilesInput.value = '';
  });
  
  // 再生モード変更
  DOM.playMode.addEventListener('change', (e) => {
    localStorage.setItem('mac_playMode', e.target.value);
  });
  
  // テーマ変更
  DOM.themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      state.theme = theme;
      
      DOM.themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.body.className = `theme-${theme}`;
      localStorage.setItem('mac_theme', theme);
    });
  });
  
  // 明るさスライダー
  DOM.brightnessSlider.addEventListener('input', (e) => {
    state.dimmerOpacity = parseInt(e.target.value, 10);
    updateDimmer();
  });
  DOM.brightnessSlider.addEventListener('change', (e) => {
    localStorage.setItem('mac_dimmer', e.target.value);
  });
  
  // スヌーズ・停止ボタン
  DOM.snoozeBtn.addEventListener('click', snoozeCurrentAlarm);
  DOM.dismissBtn.addEventListener('click', dismissCurrentAlarm);
}
