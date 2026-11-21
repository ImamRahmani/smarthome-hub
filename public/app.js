/**
 * NexHome — Smart IoT Lab Controller (app.js)
 * Sinkron dengan server.js terpadu (3 Lampu PWM, RFID Pintu Lab, ESP32-CAM, Auto Thermostat)
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Global State ---
  let systemState = {
    lamps: [
      { id: 1, status: 'OFF', intensity: 0, updated_at: '-' },
      { id: 2, status: 'OFF', intensity: 0, updated_at: '-' },
      { id: 3, status: 'OFF', intensity: 0, updated_at: '-' }
    ],
    doors: [
      { id: 1, name: 'Pintu lab', lock_status: 'LOCKED', last_uid: '-', access_alert: 'AMAN', updated_at: '-' }
    ],
    doorbell: { bell_pressed: false, last_ring_time: '-', updated_at: '-' },
    thermostat: { temperature: 25.0, humidity: 60, fan_status: 'OFF', mode: 'AUTO', auto_on: 32, auto_off: 30, updated_at: '-' },
    camera: { active: false, has_frame: false, updated_at: '-' },
    logs: []
  };

  let selectedLampId = 1;
  let isDraggingSlider = false;
  let dragIntensity = 0;
  let chartMode = 'telemetry'; // 'telemetry' atau 'power'
  let powerChart = null;
  let arOverlayVisible = true;
  let camStreamTimer = null;
  let camFetching = false;

  // --- DOM References ---
  const connDot = document.getElementById('connDot');
  const connStatusText = document.getElementById('connStatusText');
  const liveClock = document.getElementById('liveClock');
  const notifBadge = document.getElementById('notifBadge');
  const globalSearch = document.getElementById('globalSearch');

  // Weather & Humidity Widget
  const weatherDate = document.getElementById('weatherDate');
  const ambientTemp = document.getElementById('ambientTemp');
  const thermalConditionLabel = document.getElementById('thermalConditionLabel');
  const weatherHumidity = document.getElementById('weatherHumidity');
  const activeLampsSummary = document.getElementById('activeLampsSummary');
  const securitySummaryVal = document.getElementById('securitySummaryVal');
  const humidityStatusBadge = document.getElementById('humidityStatusBadge');
  const humidityGaugeArc = document.getElementById('humidityGaugeArc');
  const humidityGaugeVal = document.getElementById('humidityGaugeVal');
  const thermoLastSync = document.getElementById('thermoLastSync');
  const lastRfidUidBox = document.getElementById('lastRfidUidBox');
  const lastDoorbellNote = document.getElementById('lastDoorbellNote');

  // Thermostat Dial
  const ecoModePill = document.getElementById('ecoModePill');
  const thermoModeBadgeText = document.getElementById('thermoModeBadgeText');
  const thermoProgressArc = document.getElementById('thermoProgressArc');
  const thermoThumb = document.getElementById('thermoThumb');
  const thermoCurrentTemp = document.getElementById('thermoCurrentTemp');
  const thermoModeLabel = document.getElementById('thermoModeLabel');
  const thermoThresholdText = document.getElementById('thermoThresholdText');
  const btnTempMinus = document.getElementById('btnTempMinus');
  const btnTempPlus = document.getElementById('btnTempPlus');

  // Hero Camera & AR Nodes
  const cardCameraVisualizer = document.getElementById('cardCameraVisualizer');
  const esp32CamFeed = document.getElementById('esp32CamFeed');
  const iotNodeStage = document.getElementById('iotNodeStage');
  const btnToggleArOverlay = document.getElementById('btnToggleArOverlay');
  const camLiveDot = document.getElementById('camLiveDot');
  const camLiveLabel = document.getElementById('camLiveLabel');
  const btnCamPower = document.getElementById('btnCamPower');
  const btnCamPowerLabel = document.getElementById('btnCamPowerLabel');
  const btnCamFullscreen = document.getElementById('btnCamFullscreen');

  const nodeLight = document.getElementById('nodeLight');
  const nodeLightLabel = document.getElementById('nodeLightLabel');
  const nodeDoor = document.getElementById('nodeDoor');
  const nodeDoorLabel = document.getElementById('nodeDoorLabel');
  const nodeCam = document.getElementById('nodeCam');
  const nodeCamLabel = document.getElementById('nodeCamLabel');
  const nodeAC = document.getElementById('nodeAC');
  const nodeACLabel = document.getElementById('nodeACLabel');

  // Vertical Slider (3 Lamps)
  const sliderTrack = document.getElementById('sliderTrack');
  const sliderFillBar = document.getElementById('sliderFillBar');
  const sliderThumb = document.getElementById('sliderThumb');
  const sliderPctLabel = document.getElementById('sliderPctLabel');
  const btnSliderPower = document.getElementById('btnSliderPower');

  // 2x2 Quick Device Cards
  const devCardLighting = document.getElementById('devCardLighting');
  const switchLighting = document.getElementById('switchLighting');
  const lightingStatusText = document.getElementById('lightingStatusText');

  const devCardAC = document.getElementById('devCardAC');
  const switchAC = document.getElementById('switchAC');
  const acModeSubtitle = document.getElementById('acModeSubtitle');
  const acStatusText = document.getElementById('acStatusText');

  const devCardDoorlock = document.getElementById('devCardDoorlock');
  const switchDoorlock = document.getElementById('switchDoorlock');
  const doorCardTitle = document.getElementById('doorCardTitle');
  const doorlockUidBadge = document.getElementById('doorlockUidBadge');
  const doorlockStatusText = document.getElementById('doorlockStatusText');

  const devCardCamera = document.getElementById('devCardCamera');
  const switchCamera = document.getElementById('switchCamera');
  const cameraStatusText = document.getElementById('cameraStatusText');

  // Chart
  const btnModePower = document.getElementById('btnModePower');
  const btnModeTelemetry = document.getElementById('btnModeTelemetry');
  const powerPrimaryMetric = document.getElementById('powerPrimaryMetric');
  const powerUnitMetric = document.getElementById('powerUnitMetric');
  const powerTrendBadge = document.getElementById('powerTrendBadge');
  const powerChartCanvas = document.getElementById('powerChartCanvas');

  // Drawers, Modals & Banner
  const btnNotifications = document.getElementById('btnNotifications');
  const navSecurityBtn = document.getElementById('navSecurityBtn');
  const navSimBtn = document.getElementById('navSimBtn');
  const logsDrawerBackdrop = document.getElementById('logsDrawerBackdrop');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const btnRefreshLogs = document.getElementById('btnRefreshLogs');
  const logsListContainer = document.getElementById('logsListContainer');

  const btnSimulator = document.getElementById('btnSimulator');
  const simModalBackdrop = document.getElementById('simModalBackdrop');
  const btnCloseSimulator = document.getElementById('btnCloseSimulator');

  const doorbellAlertBanner = document.getElementById('doorbellAlertBanner');
  const doorbellRingTime = document.getElementById('doorbellRingTime');
  const btnDoorbellUnlock = document.getElementById('btnDoorbellUnlock');
  const btnAckDoorbell = document.getElementById('btnAckDoorbell');

  // Simulator Controls
  const simRfidUid = document.getElementById('simRfidUid');
  const simRfidAccess = document.getElementById('simRfidAccess');
  const btnSimTapRfid = document.getElementById('btnSimTapRfid');
  const btnSimRingBell = document.getElementById('btnSimRingBell');
  const btnSimSendCamFrame = document.getElementById('btnSimSendCamFrame');
  const simTempInp = document.getElementById('simTempInp');
  const simHumInp = document.getElementById('simHumInp');
  const btnSimSendDht = document.getElementById('btnSimSendDht');

  // --- Helpers ---
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getSelectedLamp() {
    const lamps = systemState.lamps || [];
    return lamps.find(l => l.id === selectedLampId) || lamps[0] || { id: selectedLampId, status: 'OFF', intensity: 0 };
  }

  function getMainDoor() {
    const doors = systemState.doors || [];
    return doors[0] || systemState.doorlock || { id: 1, name: 'Pintu lab', lock_status: 'LOCKED', last_uid: '-', access_alert: 'AMAN' };
  }

  // --- Clock & Date Updater (WITA) ---
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });
    const dateStr = now.toLocaleDateString('id-ID', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar'
    });
    if (liveClock) liveClock.textContent = `${timeStr} WITA`;
    if (weatherDate) weatherDate.textContent = dateStr;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // --- API Polling ---
  async function fetchSystemState() {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      systemState = data;
      renderUI(data);
      setConnectionStatus(true);
      if (chartMode === 'telemetry') {
        loadTelemetryChart();
      }
    } catch (err) {
      console.warn('Backend polling warning:', err.message);
      setConnectionStatus(false);
    }
  }

  function setConnectionStatus(online) {
    if (!connDot || !connStatusText) return;
    connDot.className = online ? 'status-indicator-dot online' : 'status-indicator-dot offline';
    connStatusText.textContent = online ? 'MySQL Connected' : 'Offline / Terputus';
  }

  // --- Dynamic SVG Arc Helpers ---
  function updateThermoArc(temp) {
    if (!thermoProgressArc || !thermoThumb) return;
    const totalLen = thermoProgressArc.getTotalLength();
    const minT = 16;
    const maxT = 42;
    const ratio = Math.max(0, Math.min(1, (temp - minT) / (maxT - minT)));

    thermoProgressArc.style.strokeDasharray = `${totalLen}`;
    thermoProgressArc.style.strokeDashoffset = `${totalLen * (1 - ratio)}`;

    const pt = thermoProgressArc.getPointAtLength(totalLen * ratio);
    thermoThumb.setAttribute('cx', pt.x.toFixed(1));
    thermoThumb.setAttribute('cy', pt.y.toFixed(1));
  }

  function updateHumidityGauge(hum) {
    if (!humidityGaugeArc) return;
    const totalLen = humidityGaugeArc.getTotalLength();
    const ratio = Math.max(0, Math.min(1, hum / 100));
    humidityGaugeArc.style.strokeDasharray = `${totalLen}`;
    humidityGaugeArc.style.strokeDashoffset = `${totalLen * (1 - ratio)}`;
  }

  // --- ESP32-CAM Live Frame Streamer ---
  function syncCameraStream(cam) {
    const isActive = Boolean(cam?.active);
    const hasFrame = Boolean(cam?.has_frame);

    if (!isActive) {
      if (camStreamTimer) {
        clearTimeout(camStreamTimer);
        camStreamTimer = null;
      }
      if (esp32CamFeed) {
        esp32CamFeed.classList.remove('visible');
        esp32CamFeed.removeAttribute('src');
      }
      if (camLiveDot) camLiveDot.className = 'live-dot-pulse off';
      if (camLiveLabel) camLiveLabel.textContent = 'Kamera OFF';
      if (btnCamPowerLabel) btnCamPowerLabel.textContent = 'Nyalakan Kamera';
      return;
    }

    if (btnCamPowerLabel) btnCamPowerLabel.textContent = 'Matikan Kamera';
    if (hasFrame) {
      if (camLiveDot) camLiveDot.className = 'live-dot-pulse';
      if (camLiveLabel) camLiveLabel.textContent = 'ESP32-CAM LIVE';
    } else {
      if (camLiveDot) camLiveDot.className = 'live-dot-pulse standby';
      if (camLiveLabel) camLiveLabel.textContent = 'Kamera ON (Menunggu Frame)';
    }

    if (!camStreamTimer && !camFetching) {
      pollCameraFrame();
    }
  }

  function pollCameraFrame() {
    if (!systemState.camera?.active) return;
    camFetching = true;

    const nextImg = new Image();
    nextImg.onload = () => {
      camFetching = false;
      if (systemState.camera?.active && esp32CamFeed) {
        esp32CamFeed.src = nextImg.src;
        esp32CamFeed.classList.add('visible');
        if (camLiveDot) camLiveDot.className = 'live-dot-pulse';
        if (camLiveLabel) camLiveLabel.textContent = 'ESP32-CAM LIVE';
      }
      camStreamTimer = setTimeout(pollCameraFrame, 450);
    };
    nextImg.onerror = () => {
      camFetching = false;
      camStreamTimer = setTimeout(pollCameraFrame, 900);
    };
    nextImg.src = `/api/camera/frame?t=${Date.now()}`;
  }

  // --- Main UI Render ---
  function renderUI(data) {
    if (!data) return;

    // 1. Smart Lamps (3 Channels)
    const lamps = Array.isArray(data.lamps) ? data.lamps : [];
    const activeLampCount = lamps.filter(l => l.status === 'ON').length;
    if (activeLampsSummary) activeLampsSummary.textContent = `${activeLampCount}/3 ON`;

    lamps.forEach(l => {
      const dot = document.getElementById(`lampDot${l.id}`);
      if (dot) dot.classList.toggle('on', l.status === 'ON');
    });

    const curLamp = getSelectedLamp();
    const isLampOn = curLamp.status === 'ON';
    const intensity = isDraggingSlider ? dragIntensity : Number(curLamp.intensity ?? 0);

    if (switchLighting) switchLighting.checked = isLampOn;
    if (devCardLighting) devCardLighting.classList.toggle('active', isLampOn);
    if (lightingStatusText) {
      lightingStatusText.textContent = isLampOn
        ? `L${curLamp.id}: ON • ${intensity}% PWM`
        : `L${curLamp.id}: OFF • 0% PWM`;
    }
    if (nodeLight) nodeLight.classList.toggle('node-active', isLampOn);
    if (nodeLightLabel) nodeLightLabel.textContent = `Lampu ${curLamp.id}`;

    // Sync Slider (jangan timpa saat user sedang drag)
    if (!isDraggingSlider) {
      updateSliderVisual(intensity, isLampOn);
    }

    // 2. Thermostat & Auto/Manual Fan
    if (data.thermostat) {
      const tempVal = Number(data.thermostat.temperature ?? 0);
      const humVal = Number(data.thermostat.humidity ?? 0);
      const isFanOn = data.thermostat.fan_status === 'ON';
      const mode = data.thermostat.mode || 'AUTO';
      const autoOn = Number(data.thermostat.auto_on ?? 32);
      const autoOff = Number(data.thermostat.auto_off ?? 30);

      if (ambientTemp) ambientTemp.textContent = tempVal.toFixed(1);
      if (weatherHumidity) weatherHumidity.textContent = `${Math.round(humVal)}%`;
      if (thermalConditionLabel) {
        thermalConditionLabel.textContent = tempVal > autoOn ? 'Panas (Kipas Aktif)' : (tempVal < 22 ? 'Sejuk' : 'Normal');
      }

      if (humidityGaugeVal) humidityGaugeVal.textContent = `${Math.round(humVal)}%`;
      if (humidityStatusBadge) {
        humidityStatusBadge.textContent = humVal > 75 ? 'Lembap' : (humVal < 40 ? 'Kering' : 'Ideal');
      }
      if (thermoLastSync) thermoLastSync.textContent = `Sync: ${data.thermostat.updated_at || '-'}`;
      updateHumidityGauge(humVal);

      if (thermoCurrentTemp) thermoCurrentTemp.innerHTML = `${tempVal.toFixed(1)}<small>°C</small>`;
      if (thermoModeLabel) thermoModeLabel.textContent = isFanOn ? 'Kipas Menyala' : 'Kipas Standby';
      if (thermoThresholdText) thermoThresholdText.textContent = `Auto ON > ${autoOn}°C • OFF < ${autoOff}°C`;
      updateThermoArc(tempVal);

      if (ecoModePill && thermoModeBadgeText) {
        ecoModePill.classList.toggle('manual', mode === 'MANUAL');
        thermoModeBadgeText.textContent = mode === 'AUTO' ? 'Mode AUTO' : 'MANUAL (Klik Auto)';
      }

      if (switchAC) switchAC.checked = isFanOn;
      if (devCardAC) devCardAC.classList.toggle('active', isFanOn);
      if (acModeSubtitle) acModeSubtitle.textContent = `Mode: ${mode} (> ${autoOn}°C)`;
      if (acStatusText) acStatusText.textContent = `${tempVal.toFixed(1)}°C | Fan ${isFanOn ? 'ON' : 'OFF'}`;
      if (nodeAC) nodeAC.classList.toggle('node-active', isFanOn);
      if (nodeACLabel) nodeACLabel.textContent = isFanOn ? 'Kipas ON' : 'Kipas OFF';
    }

    // 3. Smart Door Lock (Pintu Lab)
    const door = getMainDoor();
    const isLocked = door.lock_status === 'LOCKED';
    const alertStatus = door.access_alert || 'AMAN';
    const lastUid = door.last_uid || '-';

    if (doorCardTitle) doorCardTitle.textContent = door.name || 'Pintu Lab';
    if (doorlockUidBadge) doorlockUidBadge.textContent = `UID: ${lastUid}`;
    if (lastRfidUidBox) lastRfidUidBox.textContent = lastUid;
    if (switchDoorlock) switchDoorlock.checked = isLocked;
    if (devCardDoorlock) devCardDoorlock.classList.toggle('active', isLocked);
    if (doorlockStatusText) {
      doorlockStatusText.textContent = isLocked ? `LOCKED • ${alertStatus}` : `UNLOCKED • ${alertStatus}`;
    }
    if (securitySummaryVal) securitySummaryVal.textContent = isLocked ? alertStatus : 'TERBUKA';
    if (nodeDoor) nodeDoor.classList.toggle('node-active', !isLocked);
    if (nodeDoorLabel) nodeDoorLabel.textContent = isLocked ? 'Terkunci' : 'Terbuka';

    // 4. ESP32-CAM Card & Stream
    const cam = data.camera || { active: false, has_frame: false };
    const isCamActive = Boolean(cam.active);
    if (switchCamera) switchCamera.checked = isCamActive;
    if (devCardCamera) devCardCamera.classList.toggle('active', isCamActive);
    if (cameraStatusText) {
      cameraStatusText.textContent = isCamActive
        ? (cam.has_frame ? 'ON • Live Streaming' : 'ON • Menunggu Frame')
        : 'OFF • Standby';
    }
    if (nodeCam) nodeCam.classList.toggle('node-active', isCamActive);
    if (nodeCamLabel) nodeCamLabel.textContent = isCamActive ? 'Cam ON' : 'Cam OFF';
    syncCameraStream(cam);

    // 5. Doorbell Alert Banner
    if (data.doorbell) {
      const isRinging = Boolean(data.doorbell.bell_pressed);
      if (doorbellAlertBanner) doorbellAlertBanner.classList.toggle('active', isRinging);
      if (doorbellRingTime) doorbellRingTime.textContent = data.doorbell.last_ring_time || 'Baru Saja';
      if (lastDoorbellNote) lastDoorbellNote.textContent = `Bel terakhir: ${data.doorbell.last_ring_time || '-'}`;
    }

    // 6. Security Audit Logs
    if (Array.isArray(data.logs)) {
      if (notifBadge) notifBadge.textContent = data.logs.length > 9 ? '9+' : String(data.logs.length);
      renderLogsDrawer(data.logs);
    }
  }

  function updateSliderVisual(intensity, isOn) {
    const pct = Math.max(0, Math.min(100, Number(intensity) || 0));
    if (sliderPctLabel) sliderPctLabel.textContent = `${pct}%`;
    if (sliderFillBar) sliderFillBar.style.height = `${pct}%`;
    if (sliderThumb) sliderThumb.style.bottom = `${pct}%`;
    if (btnSliderPower) btnSliderPower.classList.toggle('on', Boolean(isOn && pct > 0));
  }

  // --- Safe Logs Drawer Rendering (Anti-XSS) ---
  function renderLogsDrawer(logs) {
    if (!logsListContainer) return;
    if (!logs || logs.length === 0) {
      logsListContainer.innerHTML = '<div class="empty-log-state">Belum ada riwayat aktivitas tersimpan.</div>';
      return;
    }

    const allowedTypes = new Set(['danger', 'warning', 'success', 'control']);
    logsListContainer.innerHTML = logs.map(log => {
      const type = allowedTypes.has(log.type) ? log.type : 'control';
      return `
        <div class="log-item-card">
          <div class="log-info-group">
            <span class="log-time">${escapeHtml(log.time || '--:--')}</span>
            <div class="log-msg"><strong>[${escapeHtml(log.module || 'SYS')}]</strong> ${escapeHtml(log.message || '')}</div>
          </div>
          <span class="log-badge-tag ${type}">${escapeHtml(type)}</span>
        </div>
      `;
    }).join('');
  }

  // --- Chart.js: Dual-Line Telemetry & Power ---
  function initChart() {
    if (!powerChartCanvas) return;
    const ctx = powerChartCanvas.getContext('2d');
    powerChart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 250 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E293B',
            titleColor: '#CBD5E1',
            bodyColor: '#FFFFFF',
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748B', font: { size: 10 }, maxTicksLimit: 7 }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#64748B', font: { size: 10 } }
          }
        }
      }
    });
  }

  async function loadTelemetryChart() {
    if (!powerChart) return;
    try {
      const res = await fetch('/api/history', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load history');
      const rows = await res.json();

      const tempRows = rows.filter(r => r.metric_name === 'temperature').slice(-15);
      const humRows = rows.filter(r => r.metric_name === 'humidity').slice(-15);

      const labels = (tempRows.length >= humRows.length ? tempRows : humRows).map(r => r.time);

      powerChart.config.type = 'line';
      powerChart.data.labels = labels.length ? labels : ['Belum ada data'];
      powerChart.data.datasets = [
        {
          label: 'Suhu (°C)',
          data: tempRows.map(r => Number(r.metric_value)),
          borderColor: '#F97316',
          backgroundColor: 'rgba(249, 115, 22, 0.14)',
          fill: true,
          tension: 0.35,
          pointRadius: 2.5
        },
        {
          label: 'Kelembapan (%)',
          data: humRows.map(r => Number(r.metric_value)),
          borderColor: '#38BDF8',
          backgroundColor: 'rgba(56, 189, 248, 0.10)',
          fill: true,
          tension: 0.35,
          pointRadius: 2.5
        }
      ];
      powerChart.options.scales.y.max = undefined;
      powerChart.update('none');

      const latestTemp = tempRows.length ? tempRows[tempRows.length - 1].metric_value : (systemState.thermostat?.temperature ?? 0);
      const latestHum = humRows.length ? humRows[humRows.length - 1].metric_value : (systemState.thermostat?.humidity ?? 0);
      if (powerPrimaryMetric) powerPrimaryMetric.textContent = Number(latestTemp).toFixed(1);
      if (powerUnitMetric) powerUnitMetric.textContent = `°C / ${Math.round(latestHum)}% RH`;
      if (powerTrendBadge) powerTrendBadge.innerHTML = '<span>Oranye: Suhu • Biru: Lembap</span>';
    } catch (err) {
      console.warn('Telemetry chart fetch error:', err.message);
    }
  }

  function showPowerChart() {
    if (!powerChart) return;
    powerChart.config.type = 'bar';
    powerChart.data.labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    powerChart.data.datasets = [{
      label: 'Estimasi (kWh)',
      data: [4.2, 5.8, 6.1, 9.2, 5.0, 7.3, 6.8],
      backgroundColor: ['#2DD4BF', '#2DD4BF', '#2DD4BF', '#F97316', '#2DD4BF', '#2DD4BF', '#2DD4BF'],
      borderRadius: 8,
      borderSkipped: false,
      barPercentage: 0.55
    }];
    powerChart.options.scales.y.max = 10;
    powerChart.update();

    if (powerPrimaryMetric) powerPrimaryMetric.textContent = '6.8';
    if (powerUnitMetric) powerUnitMetric.textContent = 'kWh';
    if (powerTrendBadge) powerTrendBadge.innerHTML = '<span>Estimasi Beban Mingguan</span>';
  }

  // --- API Action Senders ---
  async function sendLightingControl(id, status, intensity) {
    const payload = { id };
    if (status !== undefined) payload.status = status;
    if (intensity !== undefined) payload.intensity = intensity;
    await fetch('/api/lighting/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    fetchSystemState();
  }

  async function sendFanControl(payload) {
    await fetch('/api/thermostat/fan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    fetchSystemState();
  }

  async function sendDoorlockControl(lockStatus) {
    await fetch('/api/doorlock/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ door: 1, lock_status: lockStatus })
    });
    fetchSystemState();
  }

  async function sendCameraControl(active) {
    await fetch('/api/camera/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: Boolean(active) })
    });
    fetchSystemState();
  }

  // --- Select Active Lamp (Syncs Slider & Card Tabs) ---
  function selectLamp(lampId) {
    selectedLampId = Number(lampId);
    document.querySelectorAll('[data-lamp-id]').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.lampId) === selectedLampId);
    });
    renderUI(systemState);
  }

  document.querySelectorAll('[data-lamp-id]').forEach(btn => {
    btn.addEventListener('click', () => selectLamp(btn.dataset.lampId));
  });

  // --- Lighting Controls + Vertical Drag Slider ---
  if (switchLighting) {
    switchLighting.addEventListener('change', (e) => {
      sendLightingControl(selectedLampId, e.target.checked ? 'ON' : 'OFF', undefined);
    });
  }

  if (btnSliderPower) {
    btnSliderPower.addEventListener('click', () => {
      const cur = getSelectedLamp();
      const turningOn = cur.status !== 'ON';
      sendLightingControl(selectedLampId, turningOn ? 'ON' : 'OFF', turningOn ? (cur.intensity || 100) : 0);
    });
  }

  if (sliderTrack) {
    const calcPctFromPointer = (clientY) => {
      const rect = sliderTrack.getBoundingClientRect();
      const pct = Math.round(((rect.bottom - clientY) / rect.height) * 100);
      return Math.max(0, Math.min(100, pct));
    };

    sliderTrack.addEventListener('pointerdown', (e) => {
      isDraggingSlider = true;
      sliderTrack.setPointerCapture(e.pointerId);
      dragIntensity = calcPctFromPointer(e.clientY);
      updateSliderVisual(dragIntensity, dragIntensity > 0);
    });

    sliderTrack.addEventListener('pointermove', (e) => {
      if (!isDraggingSlider) return;
      dragIntensity = calcPctFromPointer(e.clientY);
      updateSliderVisual(dragIntensity, dragIntensity > 0);
    });

    const finishDrag = () => {
      if (!isDraggingSlider) return;
      isDraggingSlider = false;
      sendLightingControl(selectedLampId, dragIntensity > 0 ? 'ON' : 'OFF', dragIntensity);
    };

    sliderTrack.addEventListener('pointerup', finishDrag);
    sliderTrack.addEventListener('pointercancel', finishDrag);
  }

  // --- Thermostat Controls (AUTO/MANUAL & Threshold +/-) ---
  if (switchAC) {
    switchAC.addEventListener('change', (e) => {
      sendFanControl({ fan_status: e.target.checked ? 'ON' : 'OFF' });
    });
  }

  if (ecoModePill) {
    ecoModePill.addEventListener('click', () => {
      sendFanControl({ mode: 'AUTO' });
    });
  }

  if (btnTempMinus && btnTempPlus) {
    const adjustAutoLimit = (delta) => {
      const curOn = Number(systemState.thermostat?.auto_on ?? 32);
      const nextOn = Math.max(20, Math.min(45, curOn + delta));
      const nextOff = Math.max(18, nextOn - 2);
      sendFanControl({ mode: 'AUTO', auto_on: nextOn, auto_off: nextOff });
    };
    btnTempMinus.addEventListener('click', () => adjustAutoLimit(-1));
    btnTempPlus.addEventListener('click', () => adjustAutoLimit(1));
  }

  // --- Door Lock & Doorbell Controls ---
  if (switchDoorlock) {
    switchDoorlock.addEventListener('change', (e) => {
      sendDoorlockControl(e.target.checked ? 'LOCKED' : 'UNLOCKED');
    });
  }

  if (btnDoorbellUnlock) {
    btnDoorbellUnlock.addEventListener('click', async () => {
      await sendDoorlockControl('UNLOCKED');
      await fetch('/api/doorbell/ack', { method: 'POST' });
      fetchSystemState();
    });
  }

  if (btnAckDoorbell) {
    btnAckDoorbell.addEventListener('click', async () => {
      await fetch('/api/doorbell/ack', { method: 'POST' });
      if (doorbellAlertBanner) doorbellAlertBanner.classList.remove('active');
      fetchSystemState();
    });
  }

  // --- Camera Controls & AR Overlay Toggle ---
  if (switchCamera) {
    switchCamera.addEventListener('change', (e) => {
      sendCameraControl(e.target.checked);
    });
  }

  if (btnCamPower) {
    btnCamPower.addEventListener('click', () => {
      sendCameraControl(!systemState.camera?.active);
    });
  }

  if (btnToggleArOverlay && iotNodeStage) {
    btnToggleArOverlay.addEventListener('click', () => {
      arOverlayVisible = !arOverlayVisible;
      iotNodeStage.classList.toggle('hidden-overlay', !arOverlayVisible);
      btnToggleArOverlay.querySelector('span').textContent = arOverlayVisible ? 'AR Nodes: ON' : 'AR Nodes: OFF';
    });
  }

  if (btnCamFullscreen && cardCameraVisualizer) {
    btnCamFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        cardCameraVisualizer.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen();
      }
    });
  }

  // --- AR Satellite Nodes Quick Actions ---
  if (nodeLight) {
    nodeLight.addEventListener('click', () => {
      const cur = getSelectedLamp();
      sendLightingControl(selectedLampId, cur.status === 'ON' ? 'OFF' : 'ON');
    });
  }
  if (nodeDoor) {
    nodeDoor.addEventListener('click', () => {
      const isLocked = getMainDoor().lock_status === 'LOCKED';
      sendDoorlockControl(isLocked ? 'UNLOCKED' : 'LOCKED');
    });
  }
  if (nodeCam) {
    nodeCam.addEventListener('click', () => {
      sendCameraControl(!systemState.camera?.active);
    });
  }
  if (nodeAC) {
    nodeAC.addEventListener('click', () => {
      const isFanOn = systemState.thermostat?.fan_status === 'ON';
      sendFanControl({ fan_status: isFanOn ? 'OFF' : 'ON' });
    });
  }

  // --- Chart Mode Switch ---
  if (btnModeTelemetry && btnModePower) {
    btnModeTelemetry.addEventListener('click', () => {
      chartMode = 'telemetry';
      btnModeTelemetry.classList.add('active');
      btnModePower.classList.remove('active');
      loadTelemetryChart();
    });
    btnModePower.addEventListener('click', () => {
      chartMode = 'power';
      btnModePower.classList.add('active');
      btnModeTelemetry.classList.remove('active');
      showPowerChart();
    });
  }

  // --- Sidebar Navigation ---
  document.querySelectorAll('.sidebar-rail .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === 'security') {
        openLogsDrawer();
        return;
      }
      if (tab === 'simulator') {
        openSimulator();
        return;
      }
      document.querySelectorAll('.sidebar-rail .nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (tab === 'home') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tab === 'devices') {
        document.getElementById('deviceMatrixSection')?.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'energy') {
        btnModeTelemetry?.click();
        document.getElementById('cardPowerAnalytics')?.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // --- Drawer & Simulator Modals ---
  const openLogsDrawer = () => logsDrawerBackdrop?.classList.add('active');
  const closeLogsDrawer = () => logsDrawerBackdrop?.classList.remove('active');
  const openSimulator = () => simModalBackdrop?.classList.add('active');
  const closeSimulator = () => simModalBackdrop?.classList.remove('active');

  btnNotifications?.addEventListener('click', openLogsDrawer);
  btnCloseDrawer?.addEventListener('click', closeLogsDrawer);
  logsDrawerBackdrop?.addEventListener('click', (e) => { if (e.target === logsDrawerBackdrop) closeLogsDrawer(); });
  btnRefreshLogs?.addEventListener('click', fetchSystemState);

  btnSimulator?.addEventListener('click', openSimulator);
  btnCloseSimulator?.addEventListener('click', closeSimulator);
  simModalBackdrop?.addEventListener('click', (e) => { if (e.target === simModalBackdrop) closeSimulator(); });

  // --- Hardware Simulator Actions ---
  btnSimTapRfid?.addEventListener('click', async () => {
    const uid = simRfidUid.value.trim() || 'A1B2C3D4';
    const access = simRfidAccess.value;
    const lockStatus = access === 'DIIZINKAN' ? 'UNLOCKED' : 'LOCKED';
    await fetch('/api/doorlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ door: 1, last_uid: uid, lock_status: lockStatus, access_alert: access })
    });
    fetchSystemState();
  });

  btnSimRingBell?.addEventListener('click', async () => {
    await fetch('/api/doorbell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bell_pressed: true })
    });
    fetchSystemState();
  });

  btnSimSendDht?.addEventListener('click', async () => {
    const temperature = parseFloat(simTempInp.value) || 33.5;
    const humidity = parseInt(simHumInp.value, 10) || 65;
    await fetch('/api/thermostat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temperature, humidity })
    });
    fetchSystemState();
  });

  // Simulasi kirim 1 frame JPEG asli ke POST /api/camera/frame seperti ESP32-CAM
  btnSimSendCamFrame?.addEventListener('click', async () => {
    if (!systemState.camera?.active) {
      await fetch('/api/camera/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true })
      });
    }

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 640, 360);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 640, 360);

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 20, 600, 320);

    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(52, 52, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('ESP32-CAM • PINTU LAB (TEST FRAME)', 72, 59);

    ctx.fillStyle = '#38BDF8';
    ctx.font = '18px monospace';
    ctx.fillText(`WITA: ${new Date().toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' })}`, 44, 315);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      await fetch('/api/camera/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob
      });
      fetchSystemState();
    }, 'image/jpeg', 0.85);
  });

  // --- Global Search Filter ---
  globalSearch?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    document.querySelectorAll('.dev-card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(query) ? '' : 'none';
    });
  });

  // --- Boot ---
  initChart();
  fetchSystemState();
  setInterval(fetchSystemState, 2500);
});