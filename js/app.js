(() => {
  'use strict';

  // 定数
  const THEME_STORAGE_KEY = 'web-meeting-test-theme';
  const MAX_RECORDING_SECONDS = 60;
  const MAX_RECORDING_MS = MAX_RECORDING_SECONDS * 1000;
  const RECORDING_TIMER_INTERVAL_MS = 100;
  const RECORDER_STOP_TIMEOUT_MS = 500;

  // DOM 要素
  const themeSwitch = document.getElementById('theme-switch');
  const globalAlert = document.getElementById('global-alert');

  const cameraSelect = document.getElementById('camera-select');
  const cameraToggleBtn = document.getElementById('camera-toggle-btn');
  const cameraWrapper = document.getElementById('camera-wrapper');
  const cameraPreview = document.getElementById('camera-preview');
  const cameraStatus = document.getElementById('camera-status');

  const micSelect = document.getElementById('mic-select');
  const micToggleBtn = document.getElementById('mic-toggle-btn');
  const micLevel = document.getElementById('mic-level');
  const micLevelText = document.getElementById('mic-level-text');
  const recordToggleBtn = document.getElementById('record-toggle-btn');
  const recordingTimer = document.getElementById('recording-timer');
  const audioPlayback = document.getElementById('audio-playback');
  const micStatus = document.getElementById('mic-status');

  // 状態管理: カメラ系
  let cameraStream = null;
  let cameraPermissionGranted = false;
  let isCameraBusy = false;

  // 状態管理: マイク・音量メーター系
  let micStream = null;
  let micPermissionGranted = false;
  let isMicBusy = false;
  let audioContext = null;
  let analyserNode = null;
  let meterAnimationId = null;

  // 状態管理: 録音・再生系
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedAudioUrl = null;
  let recordingTimerId = null;
  let recordingStartTime = 0;
  let autoStoppedByLimit = false;
  let recordingStopResolver = null;

  // 環境フラグ
  let isMediaSupported = false;
  const isRecorderSupported = typeof window.MediaRecorder !== 'undefined';

  // ============================================================
  // ユーティリティ
  // ============================================================

  function getStoredTheme() {
    try {
      const value = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (value === 'light' || value === 'dark') {
        return value;
      }
    } catch (_err) {
      // localStorage が使えない環境は無視
    }
    return null;
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (_err) {
      // localStorage が使えない環境は無視
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeSwitch.checked = theme === 'dark';
  }

  function initTheme() {
    const saved = getStoredTheme();
    const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const initialTheme = saved || (mediaQuery && mediaQuery.matches ? 'dark' : 'light');

    applyTheme(initialTheme);

    themeSwitch.addEventListener('change', () => {
      const nextTheme = themeSwitch.checked ? 'dark' : 'light';
      applyTheme(nextTheme);
      saveTheme(nextTheme);
    });

    // 手動設定が未保存の場合のみ OS テーマ変更へ追従
    if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', (event) => {
        if (!getStoredTheme()) {
          applyTheme(event.matches ? 'dark' : 'light');
        }
      });
    }
  }

  function setStatus(el, message, tone = 'normal') {
    el.textContent = message;
    el.classList.remove('is-error', 'is-active');
    if (tone === 'error') {
      el.classList.add('is-error');
    } else if (tone === 'active') {
      el.classList.add('is-active');
    }
  }

  function setCameraStatus(message, tone = 'normal') {
    setStatus(cameraStatus, message, tone);
  }

  function setMicStatus(message, tone = 'normal') {
    setStatus(micStatus, message, tone);
  }

  function setButtonBusy(button, busy) {
    button.disabled = busy;
    if (busy) {
      button.setAttribute('aria-busy', 'true');
    } else {
      button.removeAttribute('aria-busy');
    }
  }

  function formatSeconds(totalSeconds) {
    const clamped = Math.max(0, Math.min(MAX_RECORDING_SECONDS, Math.floor(totalSeconds)));
    const minutes = String(Math.floor(clamped / 60)).padStart(2, '0');
    const seconds = String(clamped % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  function updateRecordingTimerText(elapsedSeconds) {
    recordingTimer.textContent = `${formatSeconds(elapsedSeconds)} / ${formatSeconds(MAX_RECORDING_SECONDS)}`;
  }

  function getMediaErrorMessage(err, deviceLabel) {
    const name = err && err.name ? err.name : '';
    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return `${deviceLabel}の使用が拒否された。ブラウザの権限設定から許可が必要`;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return `接続された${deviceLabel}が見つからない。デバイスの接続確認が必要`;
      case 'NotReadableError':
      case 'TrackStartError':
        return `${deviceLabel}を開始できない。他の会議アプリ等で使用中の可能性あり`;
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return `選択中の${deviceLabel}が利用不可。一覧を更新したため再選択が必要`;
      case 'AbortError':
        return `${deviceLabel}の起動が中断された`;
      case 'SecurityError':
        return `セキュリティ制限により${deviceLabel}へアクセス不可`;
      default:
        return `${deviceLabel}の開始に失敗（${name || '不明なエラー'}）`;
    }
  }

  function getActiveTrackDeviceId(stream, kind) {
    if (!stream) {
      return '';
    }
    const tracks = kind === 'video' ? stream.getVideoTracks() : stream.getAudioTracks();
    const track = tracks[0];
    if (!track || typeof track.getSettings !== 'function') {
      return '';
    }
    const settings = track.getSettings();
    return settings && settings.deviceId ? settings.deviceId : '';
  }

  // ============================================================
  // 環境チェック・デバイス一覧管理
  // ============================================================

  function checkEnvironment() {
    if (!window.isSecureContext) {
      globalAlert.textContent = 'この機能は HTTPS または localhost で開く必要がある。安全な環境から再度アクセスが必要';
      globalAlert.hidden = false;
      disableAllControls();
      return false;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      globalAlert.textContent = 'このブラウザはカメラ・マイク取得 API（getUserMedia）に非対応';
      globalAlert.hidden = false;
      disableAllControls();
      return false;
    }

    globalAlert.hidden = true;
    return true;
  }

  function disableAllControls() {
    cameraSelect.disabled = true;
    cameraToggleBtn.disabled = true;
    micSelect.disabled = true;
    micToggleBtn.disabled = true;
    recordToggleBtn.disabled = true;
  }

  function populateDeviceSelect(selectEl, devices, config) {
    const {
      kindLabel,
      placeholderText,
      emptyText,
      preferredDeviceId,
      permissionGranted,
    } = config;

    const currentValue = preferredDeviceId || selectEl.value;
    selectEl.innerHTML = '';

    if (devices.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = emptyText;
      selectEl.appendChild(option);
      return;
    }

    // 権限未取得かつ全要素の deviceId / label が空の場合はプレースホルダを維持
    const hasIdentifiableDevice = devices.some((d) => Boolean(d.deviceId || d.label));
    if (!permissionGranted && !hasIdentifiableDevice) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholderText;
      selectEl.appendChild(option);
      return;
    }

    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `${kindLabel} ${index + 1}`;
      selectEl.appendChild(option);
    });

    // 可能な限り現在の選択値を保持
    const matched = Array.from(selectEl.options).some((opt) => opt.value === currentValue && currentValue !== '');
    if (matched) {
      selectEl.value = currentValue;
    }
  }

  async function refreshDeviceList() {
    if (!isMediaSupported || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === 'videoinput');
      const audioDevices = devices.filter((device) => device.kind === 'audioinput');

      populateDeviceSelect(cameraSelect, videoDevices, {
        kindLabel: 'カメラ',
        placeholderText: 'カメラ開始後に一覧を取得',
        emptyText: 'カメラ未検出',
        preferredDeviceId: getActiveTrackDeviceId(cameraStream, 'video'),
        permissionGranted: cameraPermissionGranted,
      });

      populateDeviceSelect(micSelect, audioDevices, {
        kindLabel: 'マイク',
        placeholderText: 'マイク開始後に一覧を取得',
        emptyText: 'マイク未検出',
        preferredDeviceId: getActiveTrackDeviceId(micStream, 'audio'),
        permissionGranted: micPermissionGranted,
      });
    } catch (_err) {
      // デバイス一覧の更新失敗時は既存一覧を維持
    }
  }

  // ============================================================
  // カメラ制御
  // ============================================================

  async function startCamera(deviceId) {
    if (!isMediaSupported || isCameraBusy) {
      return;
    }

    isCameraBusy = true;
    setButtonBusy(cameraToggleBtn, true);
    setCameraStatus('カメラを起動中...');

    if (cameraStream) {
      stopCamera({ silent: true });
    }

    const constraints = {
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraStream = stream;
      cameraPermissionGranted = true;
      cameraPreview.srcObject = stream;
      cameraPreview.play().catch(() => {});
      cameraWrapper.classList.add('is-active');

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (cameraStream === stream) {
            stopCamera({ reason: 'カメラが切断されたため停止' });
          }
        };
      }

      cameraToggleBtn.textContent = 'カメラ停止';
      cameraToggleBtn.classList.add('contrast');
      setCameraStatus('カメラ稼働中', 'active');

      await refreshDeviceList();
    } catch (err) {
      cameraStream = null;
      cameraPreview.srcObject = null;
      cameraWrapper.classList.remove('is-active');
      cameraToggleBtn.textContent = 'カメラ開始';
      cameraToggleBtn.classList.remove('contrast');
      setCameraStatus(getMediaErrorMessage(err, 'カメラ'), 'error');

      if (err && (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')) {
        await refreshDeviceList();
      }
    } finally {
      isCameraBusy = false;
      setButtonBusy(cameraToggleBtn, false);
    }
  }

  function stopCamera(options = {}) {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      cameraStream = null;
    }

    cameraPreview.srcObject = null;
    cameraWrapper.classList.remove('is-active');
    cameraToggleBtn.textContent = 'カメラ開始';
    cameraToggleBtn.classList.remove('contrast');

    if (!options.silent) {
      if (options.reason) {
        setCameraStatus(options.reason, 'error');
      } else {
        setCameraStatus('カメラ停止');
      }
    }
  }

  // ============================================================
  // マイク・音量メーター制御
  // ============================================================

  async function startMeter(stream) {
    stopMeter();

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      return;
    }

    audioContext = new AudioCtx();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    // ハウリング防止のため destination には接続しない
    source.connect(analyserNode);

    const dataArray = new Uint8Array(analyserNode.fftSize);

    const updateMeter = () => {
      if (!analyserNode) {
        return;
      }

      analyserNode.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const normalized = (dataArray[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      // 通常の会話音声で視認しやすい 0〜100 スケールへ変換
      const level = Math.min(100, Math.round(rms * 300));

      micLevel.value = level;
      micLevelText.textContent = `${level}%`;
      meterAnimationId = window.requestAnimationFrame(updateMeter);
    };

    meterAnimationId = window.requestAnimationFrame(updateMeter);
  }

  function stopMeter() {
    if (meterAnimationId !== null) {
      window.cancelAnimationFrame(meterAnimationId);
      meterAnimationId = null;
    }

    analyserNode = null;
    micLevel.value = 0;
    micLevelText.textContent = '0%';

    if (audioContext) {
      const ctx = audioContext;
      audioContext = null;
      ctx.close().catch(() => {});
    }
  }

  async function startMic(deviceId) {
    if (!isMediaSupported || isMicBusy) {
      return;
    }

    isMicBusy = true;
    setButtonBusy(micToggleBtn, true);
    recordToggleBtn.disabled = true;
    setMicStatus('マイクを起動中...');

    if (micStream) {
      await stopMic({ silent: true });
    }

    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      micStream = stream;
      micPermissionGranted = true;

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          if (micStream === stream) {
            stopMic({ reason: 'マイクが切断されたため停止' });
          }
        };
      }

      await startMeter(stream);

      micToggleBtn.textContent = 'マイク停止';
      micToggleBtn.classList.add('contrast');

      if (isRecorderSupported) {
        recordToggleBtn.disabled = false;
        setMicStatus('マイク稼働中', 'active');
      } else {
        recordToggleBtn.disabled = true;
        setMicStatus('マイク稼働中（このブラウザは録音機能に非対応）');
      }

      await refreshDeviceList();
    } catch (err) {
      stopMeter();
      micStream = null;
      micToggleBtn.textContent = 'マイク開始';
      micToggleBtn.classList.remove('contrast');
      recordToggleBtn.disabled = true;
      setMicStatus(getMediaErrorMessage(err, 'マイク'), 'error');

      if (err && (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError')) {
        await refreshDeviceList();
      }
    } finally {
      isMicBusy = false;
      setButtonBusy(micToggleBtn, false);
    }
  }

  async function stopMic(options = {}) {
    recordToggleBtn.disabled = true;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      await stopRecording();
    }

    stopMeter();

    if (micStream) {
      micStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      micStream = null;
    }

    micToggleBtn.textContent = 'マイク開始';
    micToggleBtn.classList.remove('contrast');
    recordToggleBtn.disabled = true;
    recordToggleBtn.textContent = '録音開始';
    recordToggleBtn.classList.remove('contrast');

    if (!options.silent) {
      if (options.reason) {
        setMicStatus(options.reason, 'error');
      } else {
        setMicStatus('マイク停止');
      }
    }
  }

  // ============================================================
  // 録音・再生制御
  // ============================================================

  function getSupportedAudioMimeType() {
    if (!isRecorderSupported || typeof window.MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }

    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
    ];

    for (const mimeType of candidates) {
      if (window.MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }

    return '';
  }

  function revokeRecordedAudio() {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      recordedAudioUrl = null;
    }
    audioPlayback.pause();
    audioPlayback.removeAttribute('src');
    audioPlayback.load();
  }

  function clearRecordingTimer() {
    if (recordingTimerId !== null) {
      window.clearInterval(recordingTimerId);
      recordingTimerId = null;
    }
  }

  function resolveRecordingStopWaiter() {
    if (recordingStopResolver) {
      const resolve = recordingStopResolver;
      recordingStopResolver = null;
      resolve();
    }
  }

  function startRecording() {
    if (!micStream) {
      return;
    }

    if (!isRecorderSupported) {
      setMicStatus('このブラウザは録音機能（MediaRecorder）に非対応', 'error');
      return;
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      return;
    }

    // 再録音時は前回の録音データを破棄してメモリ解放
    revokeRecordedAudio();
    recordedChunks = [];
    autoStoppedByLimit = false;

    const mimeType = getSupportedAudioMimeType();
    let recorder;
    try {
      recorder = mimeType
        ? new window.MediaRecorder(micStream, { mimeType })
        : new window.MediaRecorder(micStream);
    } catch (err) {
      setMicStatus(`録音の開始に失敗（${err && err.name ? err.name : '不明なエラー'}）`, 'error');
      return;
    }

    mediaRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      clearRecordingTimer();

      const elapsedSeconds = autoStoppedByLimit
        ? MAX_RECORDING_SECONDS
        : Math.floor((Date.now() - recordingStartTime) / 1000);
      updateRecordingTimerText(elapsedSeconds);

      if (recordedChunks.length > 0) {
        const blobType = recorder.mimeType || mimeType || 'audio/webm';
        const audioBlob = new Blob(recordedChunks, { type: blobType });
        recordedAudioUrl = URL.createObjectURL(audioBlob);
        audioPlayback.src = recordedAudioUrl;
        audioPlayback.load();
      }

      recordedChunks = [];
      if (mediaRecorder === recorder) {
        mediaRecorder = null;
      }

      recordToggleBtn.textContent = '録音開始';
      recordToggleBtn.classList.remove('contrast');
      recordToggleBtn.disabled = !micStream;

      if (autoStoppedByLimit) {
        setMicStatus('最大録音時間（60秒）に達したため自動停止。再生プレイヤーで確認可能');
      } else if (micStream) {
        setMicStatus('録音完了。再生プレイヤーで確認可能', 'active');
      }

      resolveRecordingStopWaiter();
    };

    recorder.onerror = () => {
      clearRecordingTimer();
      if (mediaRecorder === recorder) {
        mediaRecorder = null;
      }
      recordToggleBtn.textContent = '録音開始';
      recordToggleBtn.classList.remove('contrast');
      recordToggleBtn.disabled = !micStream;
      setMicStatus('録音中にエラーが発生', 'error');
      resolveRecordingStopWaiter();
    };

    recorder.start();
    recordingStartTime = Date.now();
    updateRecordingTimerText(0);

    recordingTimerId = window.setInterval(() => {
      const elapsedMs = Date.now() - recordingStartTime;
      if (elapsedMs >= MAX_RECORDING_MS) {
        updateRecordingTimerText(MAX_RECORDING_SECONDS);
        autoStoppedByLimit = true;
        stopRecording();
        return;
      }
      updateRecordingTimerText(elapsedMs / 1000);
    }, RECORDING_TIMER_INTERVAL_MS);

    recordToggleBtn.textContent = '録音停止';
    recordToggleBtn.classList.add('contrast');
    setMicStatus('録音中（最大60秒）', 'active');
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      recordingStopResolver = done;
      window.setTimeout(done, RECORDER_STOP_TIMEOUT_MS);

      try {
        mediaRecorder.stop();
      } catch (_err) {
        done();
      }
    });
  }

  // ============================================================
  // クリーンアップ・イベント登録
  // ============================================================

  function cleanupOnUnload() {
    clearRecordingTimer();
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.stop();
      } catch (_err) {
        // 離脱時の停止エラーは無視
      }
    }
    stopCamera({ silent: true });
    stopMeter();
    if (micStream) {
      micStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      micStream = null;
    }
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      recordedAudioUrl = null;
    }
  }

  function bindEvents() {
    cameraToggleBtn.addEventListener('click', () => {
      if (cameraStream) {
        stopCamera();
      } else {
        startCamera(cameraSelect.value);
      }
    });

    cameraSelect.addEventListener('change', () => {
      if (cameraStream) {
        startCamera(cameraSelect.value);
      }
    });

    micToggleBtn.addEventListener('click', () => {
      if (isMicBusy) {
        return;
      }
      if (micStream) {
        stopMic();
      } else {
        startMic(micSelect.value);
      }
    });

    micSelect.addEventListener('change', () => {
      if (micStream) {
        startMic(micSelect.value);
      }
    });

    recordToggleBtn.addEventListener('click', () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      } else {
        startRecording();
      }
    });

    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        refreshDeviceList();
      });
    }

    window.addEventListener('pagehide', cleanupOnUnload);
    window.addEventListener('beforeunload', cleanupOnUnload);
  }

  // ============================================================
  // 初期化
  // ============================================================

  function init() {
    initTheme();
    updateRecordingTimerText(0);
    isMediaSupported = checkEnvironment();

    if (isMediaSupported) {
      bindEvents();
      refreshDeviceList();
    }
  }

  init();
})();
