//**
 * Music Alarm Clock - Core Application Logic (Updated)
 */

// --- 状態管理 ---
const state = {
  alarms: [],
  playlist: [],
  currentAlarm: null,
  currentSnoozeCount: 0, // 現在の鳴動に関するスヌーズ回数
  snoozeAlarms: [], // { time: Date, parentId: id, snoozeMinutes: mins, count: number }
  // ... (他のプロパティは変更なし)
  isPlaying: false,
  currentSongIndex: -1,
  db: null,
  wakeLock: null,
  isActive: false,
  theme: 'amber',
  dimmerOpacity: 0,
  audioContext: null,
  activeAudio: null,
  previewAudio: null,
  alarmCheckerInterval: null
};

// --- (DOM要素の取得、初期化、IndexedDB管理は既存のまま) ---

// (既存の関数群... loadSettings, updateDimmer, initDB, addSongToDB, getSongsFromDB, deleteSongFromDB, loadPlaylist, renderPlaylist, togglePreview, stopPreview は変更なし)

// --- アラーム管理 (一部修正) ---
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

// (renderAlarms, updateNextAlarmInfo, getNextAlarmTime, startClock, updateClock は変更なし)

// --- アラーム判定 (修正) ---
function checkAlarmTrigger() {
  const now = new Date();
  if (now.getSeconds() !== 0) return;
  
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentDay = now.getDay();
  const nowTimeStr = `${String(currentHours).padStart(2, '0')}:${String(currentMinutes).padStart(2, '0')}`;
  
  // 1. スヌーズのチェック
  const dueSnoozes = state.snoozeAlarms.filter(sa => {
    const saTime = sa.time;
    return saTime.getHours() === currentHours && saTime.getMinutes() === currentMinutes;
  });
  
  if (dueSnoozes.length > 0) {
    const ds = dueSnoozes[0];
    const parentAlarm = state.alarms.find(a => a.id === ds.parentId);
    // スヌーズ回数を引き継いでトリガー
    triggerAlarm(parentAlarm || { id: Date.now(), snooze: ds.snoozeMinutes }, ds.count);
    state.snoozeAlarms = state.snoozeAlarms.filter(sa => !dueSnoozes.includes(sa));
    updateNextAlarmInfo();
    return;
  }
  
  // 2. 通常アラーム
  state.alarms.forEach(async (alarm) => {
    if (!alarm.active) return;
    if (alarm.time === nowTimeStr) {
      let isTriggerDay = false;
      if (alarm.days.length === 0) {
        isTriggerDay = true;
        alarm.active = false;
        saveAlarms();
      } else if (alarm.days.includes(currentDay)) {
        isTriggerDay = true;
      }
      if (isTriggerDay) {
        triggerAlarm(alarm, 0); // 初回はカウント0
      }
    }
  });
}

// アラーム発火処理 (修正)
const MAX_SNOOZE_COUNT = 3;

function triggerAlarm(alarm, snoozeCount = 0) {
  state.currentAlarm = alarm;
  state.currentSnoozeCount = snoozeCount;
  
  DOM.alarmRingingOverlay.classList.remove('hide');
  stopPreview();
  startPlaylistPlayback();
  
  // スヌーズボタンの制御
  if (alarm.snooze > 0 && state.currentSnoozeCount < MAX_SNOOZE_COUNT) {
    DOM.snoozeBtn.classList.remove('hide');
    DOM.snoozeBtn.textContent = `スヌーズ (${alarm.snooze}分) [${state.currentSnoozeCount + 1}/${MAX_SNOOZE_COUNT}]`;
  } else {
    // スヌーズ回数上限に達したか、設定がない場合は隠す
    DOM.snoozeBtn.classList.add('hide');
    if (state.currentSnoozeCount >= MAX_SNOOZE_COUNT) {
      DOM.ringingSongTitle.textContent += " (スヌーズ回数上限です)";
    }
  }
}

// スヌーズハンドラ (修正)
function snoozeCurrentAlarm() {
  if (!state.currentAlarm) return;
  
  const snoozeMinutes = state.currentAlarm.snooze;
  if (snoozeMinutes <= 0 || state.currentSnoozeCount >= MAX_SNOOZE_COUNT) return;
  
  const now = new Date();
  const snoozeTime = new Date(now.getTime() + snoozeMinutes * 60 * 1000);
  
  // カウントを増やして登録
  state.snoozeAlarms.push({
    time: snoozeTime,
    parentId: state.currentAlarm.id,
    snoozeMinutes: snoozeMinutes,
    count: state.currentSnoozeCount + 1
  });
  
  stopPlaylistPlayback();
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
