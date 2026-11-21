/**
 * NexHome — Smart Living, Simplified
 * Client-side Controller & Real-Time Sync (app.js)
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- Global State Cache ---
  let systemState = {
    lighting: { status: 'ON', intensity: 70 },
    doorlock: { lock_status: 'LOCKED', access_alert: 'AMAN', last_uid: '-' },
    doorbell: { bell_pressed: false, last_ring_time: '-' },
    thermostat: { temperature: 22.5, humidity: 62, fan_status: 'ON' },
    water: { level_value: 85, category: 'AMAN' },
    logs: []
  };

  let isConnected = true;
  let chartMode = 'power'; // 'power' or 'telemetry'
  let powerChart = null;

  // --- DOM Elements ---
  // Connection & Header
  const connDot = document.getElementById('connDot');
  const connStatusText = document.getElementById('connStatusText');
  const liveClock = document.getElementById('liveClock');
  const notifBadge = document.getElementById('notifBadge');
  const globalSearch = document.getElementById('globalSearch');

  // Widgets: Weather & Environment
  const ambientTemp = document.getElementById('ambientTemp');
  const weatherHumidity = document.getElementById('weatherHumidity');
  const aqiVal = document.getElementById('aqiVal');
  const aqiProgressArc = document.getElementById('aqiProgressArc');

  // Widgets: Thermostat Dial
  const thermoCurrentTemp = document.getElementById('thermoCurrentTemp');
  const thermoFanStatusChip = document.getElementById('thermoFanStatusChip');
  const thermoModeLabel = document.getElementById('thermoModeLabel');
  const btnTempMinus = document.getElementById('btnTempMinus');
  const btnTempPlus = document.getElementById('btnTempPlus');

  // Hero Camera & Vertical Slider
  const sliderTrack = document.getElementById('sliderTrack');
  const sliderFillBar = document.getElementById('sliderFillBar');
  const sliderPctLabel = document.getElementById('sliderPctLabel');
  const btnSliderPower = document.getElementById('btnSliderPower');
  const btnCamFullscreen = document.getElementById('btnCamFullscreen');
  const cardCameraVisualizer = document.getElementById('cardCameraVisualizer');

  // Quick Device Cards & Toggles
  const devCardLighting = document.getElementById('devCardLighting');
  const switchLighting = document.getElementById('switchLighting');
  const lightingStatusText = document.getElementById('lightingStatusText');

  const devCardAC = document.getElementById('devCardAC');
  const switchAC = document.getElementById('switchAC');
  const acStatusText = document.getElementById('acStatusText');

  const devCardDoorlock = document.getElementById('devCardDoorlock');
  const switchDoorlock = document.getElementById('switchDoorlock');
  const doorlockStatusText = document.getElementById('doorlockStatusText');

  const devCardWater = document.getElementById('devCardWater');
  const waterLevelBadge = document.getElementById('waterLevelBadge');
  const waterStatusText = document.getElementById('waterStatusText');

  // Power & Chart
  const btnModePower = document.getElementById('btnModePower');
  const btnModeTelemetry = document.getElementById('btnModeTelemetry');
  const powerPrimaryMetric = document.getElementById('powerPrimaryMetric');
  const powerUnitMetric = document.getElementById('powerUnitMetric');
  const powerTrendBadge = document.getElementById('powerTrendBadge');
  const powerChartCanvas = document.getElementById('powerChartCanvas');

  // Drawers & Modals
  const btnNotifications = document.getElementById('btnNotifications');
  const navSecurityBtn = document.getElementById('navSecurityBtn');
  const logsDrawerBackdrop = document.getElementById('logsDrawerBackdrop');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const btnRefreshLogs = document.getElementById('btnRefreshLogs');
  const logsListContainer = document.getElementById('logsListContainer');

  const btnSimulator = document.getElementById('btnSimulator');
  const simModalBackdrop = document.getElementById('simModalBackdrop');
  const btnCloseSimulator = document.getElementById('btnCloseSimulator');

  // Doorbell Alert Banner
  const doorbellAlertBanner = document.getElementById('doorbellAlertBanner');
  const doorbellRingTime = document.getElementById('doorbellRingTime');
  const btnAckDoorbell = document.getElementById('btnAckDoorbell');

  // Simulator Inputs
  const simRfidUid = document.getElementById('simRfidUid');
  const simRfidAccess = document.getElementById('simRfidAccess');
  const btnSimTapRfid = document.getElementById('btnSimTapRfid');
  const btnSimRingBell = document.getElementById('btnSimRingBell');
  const simTempInp = document.getElementById('simTempInp');
  const simHumInp = document.getElementById('simHumInp');
  const btnSimSendDht = document.getElementById('btnSimSendDht');
  const simWaterRange = document.getElementById('simWaterRange');
  const simWaterValLabel = document.getElementById('simWaterValLabel');
  const simWaterCat = document.getElementById('simWaterCat');
  const btnSimSendWater = document.getElementById('btnSimSendWater');

  // --- Clock Updater ---
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });
    if (liveClock) liveClock.textContent = `${timeStr} WITA`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // --- API: Fetch State ---
  async function fetchSystemState() {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      systemState = data;
      renderUI(data);
      setConnectionStatus(true);
    } catch (err) {
      console.warn('Backend polling warning:', err.message);
      setConnectionStatus(false);
    }
  }

  function setConnectionStatus(online) {
    isConnected = online;
    if (connDot && connStatusText) {
      if (online) {
        connDot.className = 'status-indicator-dot online';
        connStatusText.textContent = 'MySQL Connected';
      } else {
        connDot.className = 'status-indicator-dot offline';
        connStatusText.textContent = 'Offline / Standalone';
      }
    }
  }

  // --- UI Render Function ---
  function renderUI(data) {
    if (!data) return;

    // 1. Lighting
    if (data.lighting) {
      const isLightingOn = data.lighting.status === 'ON';
      const intensity = data.lighting.intensity !== undefined ? Number(data.lighting.intensity) : 70;

      if (switchLighting) switchLighting.checked = isLightingOn;
      if (devCardLighting) {
        devCardLighting.classList.toggle('active', isLightingOn);
      }
      if (lightingStatusText) {
        lightingStatusText.textContent = isLightingOn ? `ON • ${intensity}% PWM` : 'OFF • Terputus';
      }

      // Slider Sync
      if (sliderPctLabel) sliderPctLabel.textContent = `${intensity}%`;
      if (sliderFillBar) sliderFillBar.style.height = `${intensity}%`;
      if (btnSliderPower) {
        btnSliderPower.classList.toggle('on', isLightingOn);
      }
    }

    // 2. Thermostat & AC
    if (data.thermostat) {
      const temp = data.thermostat.temperature !== undefined ? Number(data.thermostat.temperature).toFixed(1) : '22.5';
      const hum = data.thermostat.humidity !== undefined ? `${data.thermostat.humidity}%` : '62%';
      const isFanOn = data.thermostat.fan_status === 'ON';

      if (ambientTemp) ambientTemp.textContent = Math.round(temp);
      if (weatherHumidity) weatherHumidity.textContent = hum;

      if (thermoCurrentTemp) {
        thermoCurrentTemp.innerHTML = `${temp}<small>°C</small>`;
      }

      if (thermoModeLabel) {
        thermoModeLabel.textContent = isFanOn ? 'Cooling Active' : 'Cooling Standby';
      }

      if (switchAC) switchAC.checked = isFanOn;
      if (devCardAC) {
        devCardAC.classList.toggle('active', isFanOn);
      }
      if (acStatusText) {
        acStatusText.textContent = isFanOn ? `${temp}°C | Cooling ON` : `${temp}°C | Fan OFF`;
      }
    }

    // 3. Smart Door Lock
    if (data.doorlock) {
      const isLocked = data.doorlock.lock_status === 'LOCKED';
      const alert = data.doorlock.access_alert || 'AMAN';

      if (switchDoorlock) switchDoorlock.checked = isLocked;
      if (devCardDoorlock) {
        devCardDoorlock.classList.toggle('active', isLocked);
      }
      if (doorlockStatusText) {
        doorlockStatusText.textContent = isLocked ? `LOCKED • ${alert}` : `UNLOCKED • ${alert}`;
      }
    }

    // 4. Water Level
    if (data.water) {
      const level = data.water.level_value !== undefined ? data.water.level_value : 85;
      const cat = data.water.category || 'AMAN';

      if (waterLevelBadge) waterLevelBadge.textContent = `${level}%`;
      if (waterStatusText) {
        waterStatusText.textContent = `Level: ${level}% • ${cat}`;
      }
    }

    // 5. Doorbell Notification
    if (data.doorbell) {
      const isRinging = Boolean(data.doorbell.bell_pressed);
      if (doorbellAlertBanner) {
        doorbellAlertBanner.classList.toggle('active', isRinging);
      }
      if (doorbellRingTime) {
        doorbellRingTime.textContent = data.doorbell.last_ring_time || 'Baru Saja';
      }
    }

    // 6. Security Logs
    if (data.logs && Array.isArray(data.logs)) {
      if (notifBadge) notifBadge.textContent = Math.min(data.logs.length, 9);
      renderLogsDrawer(data.logs);
    }
  }

  // --- Render Logs Drawer ---
  function renderLogsDrawer(logs) {
    if (!logsListContainer) return;
    if (!logs || logs.length === 0) {
      logsListContainer.innerHTML = '<div class="empty-log-state">Belum ada riwayat aktivitas tersimpan.</div>';
      return;
    }

    logsListContainer.innerHTML = logs.map(log => {
      const type = log.type || 'control';
      return `
        <div class="log-item-card">
          <div class="log-info-group">
            <span class="log-time">${log.time || '--:--'}</span>
            <div class="log-msg"><strong>[${log.module || 'SYS'}]</strong> ${log.message || ''}</div>
          </div>
          <span class="log-badge-tag ${type}">${type}</span>
        </div>
      `;
    }).join('');
  }

  // --- Chart.js: Power & Telemetry Analytics ---
  function initPowerChart() {
    if (!powerChartCanvas) return;
    const ctx = powerChartCanvas.getContext('2d');

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dataValues = [4.2, 5.8, 6.1, 9.2, 5.0, 7.3, 6.8];

    // Background colors: teal for regular days, bright orange for peak Thursday
    const bgColors = dataValues.map((v, i) => i === 3 ? '#F97316' : '#2DD4BF');

    powerChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues,
          backgroundColor: bgColors,
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.55
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1E293B',
            titleColor: '#CBD5E1',
            bodyColor: '#FFFFFF',
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} kWh`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748B', font: { size: 10 } }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: { color: '#64748B', font: { size: 10 }, stepSize: 2.5 },
            beginAtZero: true,
            max: 10
          }
        }
      }
    });
  }

  async function loadTelemetryChart() {
    if (!powerChart) return;
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('Failed to load history');
      const rows = await res.json();

      if (rows && rows.length > 0) {
        const labels = rows.map(r => r.time);
        const dataValues = rows.map(r => Number(r.metric_value));

        powerChart.config.type = 'line';
        powerChart.data.labels = labels.slice(-15);
        powerChart.data.datasets = [{
          label: 'Telemetry Value',
          data: dataValues.slice(-15),
          borderColor: '#38BDF8',
          backgroundColor: 'rgba(56, 189, 248, 0.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: '#38BDF8'
        }];
        powerChart.options.scales.y.max = undefined;
        powerChart.update();

        if (powerPrimaryMetric) powerPrimaryMetric.textContent = rows[rows.length - 1].metric_value;
        if (powerUnitMetric) powerUnitMetric.textContent = rows[rows.length - 1].metric_name;
        if (powerTrendBadge) powerTrendBadge.innerHTML = '<span>Live Time-Series Log</span>';
      }
    } catch (err) {
      console.warn('Telemetry chart fetch error:', err);
    }
  }

  function resetToPowerChart() {
    if (!powerChart) return;
    powerChart.config.type = 'bar';
    powerChart.data.labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    powerChart.data.datasets = [{
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
    if (powerTrendBadge) {
      powerTrendBadge.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px;">
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline>
          <polyline points="17 18 23 18 23 12"></polyline>
        </svg>
        <span>18% vs last week</span>
      `;
    }
  }

  // --- Controls Interaction ---
  // 1. Lighting Control
  async function sendLightingControl(status, intensity) {
    try {
      const payload = {};
      if (status !== undefined) payload.status = status;
      if (intensity !== undefined) payload.intensity = intensity;

      await fetch('/api/lighting/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      fetchSystemState();
    } catch (err) {
      console.error('Failed to control lighting:', err);
    }
  }

  if (switchLighting) {
    switchLighting.addEventListener('change', (e) => {
      const status = e.target.checked ? 'ON' : 'OFF';
      sendLightingControl(status, undefined);
    });
  }

  // Vertical Slider Click / Drag
  if (sliderTrack) {
    function handleSliderTrack(e) {
      const rect = sliderTrack.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      let pct = Math.round(((rect.height - clickY) / rect.height) * 100);
      pct = Math.max(0, Math.min(100, pct));
      sendLightingControl(pct > 0 ? 'ON' : 'OFF', pct);
    }

    sliderTrack.addEventListener('click', handleSliderTrack);
  }

  if (btnSliderPower) {
    btnSliderPower.addEventListener('click', () => {
      const isCurrentlyOn = btnSliderPower.classList.contains('on');
      sendLightingControl(isCurrentlyOn ? 'OFF' : 'ON', isCurrentlyOn ? 0 : 70);
    });
  }

  // 2. Thermostat AC / Fan Control
  async function sendFanControl(fanStatus) {
    try {
      await fetch('/api/thermostat/fan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fan_status: fanStatus })
      });
      fetchSystemState();
    } catch (err) {
      console.error('Failed to control AC fan:', err);
    }
  }

  if (switchAC) {
    switchAC.addEventListener('change', (e) => {
      sendFanControl(e.target.checked ? 'ON' : 'OFF');
    });
  }

  // Thermostat Temp Adjust (+ / -)
  if (btnTempMinus && btnTempPlus) {
    btnTempMinus.addEventListener('click', () => {
      let cur = parseFloat(systemState.thermostat?.temperature || 22.5);
      cur = Math.max(16.0, cur - 0.5);
      if (thermoCurrentTemp) thermoCurrentTemp.innerHTML = `${cur.toFixed(1)}<small>°C</small>`;
    });

    btnTempPlus.addEventListener('click', () => {
      let cur = parseFloat(systemState.thermostat?.temperature || 22.5);
      cur = Math.min(32.0, cur + 0.5);
      if (thermoCurrentTemp) thermoCurrentTemp.innerHTML = `${cur.toFixed(1)}<small>°C</small>`;
    });
  }

  // 3. Door Lock Control
  async function sendDoorlockControl(lockStatus) {
    try {
      await fetch('/api/doorlock/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_status: lockStatus })
      });
      fetchSystemState();
    } catch (err) {
      console.error('Failed to control door lock:', err);
    }
  }

  if (switchDoorlock) {
    switchDoorlock.addEventListener('change', (e) => {
      sendDoorlockControl(e.target.checked ? 'LOCKED' : 'UNLOCKED');
    });
  }

  // 4. Doorbell Ack
  if (btnAckDoorbell) {
    btnAckDoorbell.addEventListener('click', async () => {
      try {
        await fetch('/api/doorbell/ack', { method: 'POST' });
        if (doorbellAlertBanner) doorbellAlertBanner.classList.remove('active');
        fetchSystemState();
      } catch (err) {
        console.error('Failed to ack doorbell:', err);
      }
    });
  }

  // 5. Interactive IoT Nodes Click
  const nodeLight = document.getElementById('nodeLight');
  if (nodeLight) {
    nodeLight.addEventListener('click', () => {
      const isCurrentlyOn = systemState.lighting?.status === 'ON';
      sendLightingControl(isCurrentlyOn ? 'OFF' : 'ON');
    });
  }

  const nodeDoor = document.getElementById('nodeDoor');
  if (nodeDoor) {
    nodeDoor.addEventListener('click', () => {
      const isLocked = systemState.doorlock?.lock_status === 'LOCKED';
      sendDoorlockControl(isLocked ? 'UNLOCKED' : 'LOCKED');
    });
  }

  const nodeAC = document.getElementById('nodeAC');
  if (nodeAC) {
    nodeAC.addEventListener('click', () => {
      const isFanOn = systemState.thermostat?.fan_status === 'ON';
      sendFanControl(isFanOn ? 'OFF' : 'ON');
    });
  }

  // 6. Camera Fullscreen Toggle
  if (btnCamFullscreen && cardCameraVisualizer) {
    btnCamFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        cardCameraVisualizer.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
      } else {
        document.exitFullscreen();
      }
    });
  }

  // 7. Chart Mode Switching
  if (btnModePower && btnModeTelemetry) {
    btnModePower.addEventListener('click', () => {
      btnModePower.classList.add('active');
      btnModeTelemetry.classList.remove('active');
      chartMode = 'power';
      resetToPowerChart();
    });

    btnModeTelemetry.addEventListener('click', () => {
      btnModeTelemetry.classList.add('active');
      btnModePower.classList.remove('active');
      chartMode = 'telemetry';
      loadTelemetryChart();
    });
  }

  // 8. Navigation Drawer (Security Logs)
  function openLogsDrawer() {
    if (logsDrawerBackdrop) logsDrawerBackdrop.classList.add('active');
  }

  function closeLogsDrawer() {
    if (logsDrawerBackdrop) logsDrawerBackdrop.classList.remove('active');
  }

  if (btnNotifications) btnNotifications.addEventListener('click', openLogsDrawer);
  if (navSecurityBtn) navSecurityBtn.addEventListener('click', openLogsDrawer);
  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeLogsDrawer);
  if (logsDrawerBackdrop) {
    logsDrawerBackdrop.addEventListener('click', (e) => {
      if (e.target === logsDrawerBackdrop) closeLogsDrawer();
    });
  }
  if (btnRefreshLogs) btnRefreshLogs.addEventListener('click', fetchSystemState);

  // 9. Simulator Modal
  function openSimulator() {
    if (simModalBackdrop) simModalBackdrop.classList.add('active');
  }

  function closeSimulator() {
    if (simModalBackdrop) simModalBackdrop.classList.remove('active');
  }

  if (btnSimulator) btnSimulator.addEventListener('click', openSimulator);
  if (btnCloseSimulator) btnCloseSimulator.addEventListener('click', closeSimulator);
  if (simModalBackdrop) {
    simModalBackdrop.addEventListener('click', (e) => {
      if (e.target === simModalBackdrop) closeSimulator();
    });
  }

  // Hardware Simulator Actions
  if (btnSimTapRfid) {
    btnSimTapRfid.addEventListener('click', async () => {
      const uid = simRfidUid.value.trim() || 'E2 8A 1F 09';
      const access = simRfidAccess.value;
      const lockStatus = access === 'DIIZINKAN' ? 'UNLOCKED' : 'LOCKED';
      await fetch('/api/doorlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ last_uid: uid, lock_status: lockStatus, access_alert: access })
      });
      fetchSystemState();
    });
  }

  if (btnSimRingBell) {
    btnSimRingBell.addEventListener('click', async () => {
      await fetch('/api/doorbell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bell_pressed: true })
      });
      fetchSystemState();
    });
  }

  if (btnSimSendDht) {
    btnSimSendDht.addEventListener('click', async () => {
      const temp = parseFloat(simTempInp.value) || 28.0;
      const hum = parseInt(simHumInp.value) || 60;
      await fetch('/api/thermostat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temperature: temp, humidity: hum })
      });
      fetchSystemState();
    });
  }

  if (simWaterRange && simWaterValLabel) {
    simWaterRange.addEventListener('input', (e) => {
      simWaterValLabel.textContent = `${e.target.value}%`;
    });
  }

  if (btnSimSendWater) {
    btnSimSendWater.addEventListener('click', async () => {
      const val = parseInt(simWaterRange.value) || 80;
      const cat = simWaterCat.value;
      await fetch('/api/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level_value: val, category: cat })
      });
      fetchSystemState();
    });
  }

  // 10. Global Search filter
  if (globalSearch) {
    globalSearch.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const cards = document.querySelectorAll('.dev-card');
      cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query) ? '' : 'none';
      });
    });
  }

  // Initial Boot
  initPowerChart();
  fetchSystemState();
  setInterval(fetchSystemState, 2500); // Polling every 2.5s
});
