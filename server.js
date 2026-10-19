const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// === 1. STATE TERPUSAT SESUAI KONTRAK MASTER ===
const systemState = {
  lighting: { status: "OFF", intensity: 0, updated_at: "-" },
  doorlock: { lock_status: "LOCKED", last_uid: "-", access_alert: "AMAN", updated_at: "-" },
  doorbell: { bell_pressed: false, last_ring_time: "-", updated_at: "-" },
  thermostat: { temperature: 28.5, humidity: 65.0, fan_status: "OFF", updated_at: "-" },
  water: { level_value: 50, category: "NORMAL", updated_at: "-" },
  camera: { stream_url: "" }
};

const activityLogs = [];
function addLog(module, message, type = "info") {
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });
  activityLogs.unshift({ time, module, message, type });
  if (activityLogs.length > 25) activityLogs.pop();
}

function nowTime() {
  return new Date().toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });
}

// === 2. ENDPOINT UNTUK FRONTEND DASHBOARD ===
app.get('/api/state', (req, res) => {
  res.json({ ...systemState, logs: activityLogs });
});

// === 3. FITUR A: SMART LIGHTING (NO. 2) ===
app.get('/api/lighting', (req, res) => {
  systemState.lighting.updated_at = nowTime();
  res.json({
    status: systemState.lighting.status,
    intensity: systemState.lighting.intensity
  });
});

app.post('/api/lighting/control', (req, res) => {
  const { status, intensity } = req.body;
  if (status !== undefined) systemState.lighting.status = status;
  if (intensity !== undefined) {
    systemState.lighting.intensity = Number(intensity);
    systemState.lighting.status = Number(intensity) > 0 ? "ON" : "OFF";
  }
  addLog("LIGHTING", `Lampu diatur ke ${systemState.lighting.status} (${systemState.lighting.intensity}%)`, "control");
  res.json({ ok: true, lighting: systemState.lighting });
});

// === 4. FITUR B: SMART DOOR LOCK RFID (NO. 4) ===
app.post('/api/doorlock', (req, res) => {
  const { last_uid, lock_status, access_alert } = req.body;
  if (last_uid !== undefined) systemState.doorlock.last_uid = String(last_uid);
  if (lock_status !== undefined) systemState.doorlock.lock_status = lock_status;
  if (access_alert !== undefined) systemState.doorlock.access_alert = access_alert;
  systemState.doorlock.updated_at = nowTime();

  const logType = access_alert === "DITOLAK" ? "danger" : "success";
  addLog("DOORLOCK", `Kartu [${systemState.doorlock.last_uid}] -> ${access_alert} (${lock_status})`, logType);
  res.json({ ok: true });
});

app.post('/api/doorlock/control', (req, res) => {
  const { lock_status } = req.body;
  if (lock_status) {
    systemState.doorlock.lock_status = lock_status;
    systemState.doorlock.access_alert = lock_status === "LOCKED" ? "AMAN" : "DIIZINKAN";
    addLog("DOORLOCK", `Override manual via Web: ${lock_status}`, "control");
  }
  res.json({ ok: true, doorlock: systemState.doorlock });
});

// === 5. FITUR C: VIDEO DOORBELL (NO. 5) ===
app.post('/api/doorbell', (req, res) => {
  const { bell_pressed } = req.body;
  systemState.doorbell.bell_pressed = Boolean(bell_pressed);
  systemState.doorbell.updated_at = nowTime();

  if (bell_pressed) {
    systemState.doorbell.last_ring_time = nowTime();
    addLog("DOORBELL", "Bel pintu ditekan! Ada pengunjung di depan pintu.", "warning");
  }
  res.json({ ok: true });
});

app.post('/api/doorbell/ack', (req, res) => {
  systemState.doorbell.bell_pressed = false;
  addLog("DOORBELL", "Notifikasi bel diterima oleh pemilik rumah.", "info");
  res.json({ ok: true });
});

// === 6. FITUR D: SMART THERMOSTAT (NO. 6) ===
app.post('/api/thermostat', (req, res) => {
  const { temperature, humidity } = req.body;
  if (temperature !== undefined) systemState.thermostat.temperature = Number(temperature);
  if (humidity !== undefined) systemState.thermostat.humidity = Number(humidity);
  systemState.thermostat.updated_at = nowTime();

  res.json({ fan_status: systemState.thermostat.fan_status });
});

app.post('/api/thermostat/fan', (req, res) => {
  const { fan_status } = req.body;
  if (fan_status === "ON" || fan_status === "OFF") {
    systemState.thermostat.fan_status = fan_status;
    addLog("THERMOSTAT", `Kipas pendingin diatur ke ${fan_status}`, "control");
  }
  res.json({ ok: true, fan_status: systemState.thermostat.fan_status });
});

// === 7. FITUR E: WATER MONITOR (NO. 7) ===
app.post('/api/water', (req, res) => {
  const { level_value, category } = req.body;
  const prevCategory = systemState.water.category;

  if (level_value !== undefined) systemState.water.level_value = Number(level_value);
  if (category !== undefined) systemState.water.category = category;
  systemState.water.updated_at = nowTime();

  if (category && category !== prevCategory) {
    const logType = (category === "RENDAH" || category === "PENUH") ? "warning" : "info";
    addLog("WATER", `Status tangki air berubah menjadi ${category} (${systemState.water.level_value}%)`, logType);
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  addLog("SYSTEM", "Smart Home Hub Server aktif dan siap menerima koneksi ESP32.", "info");
  console.log(`Server Smart Home berjalan di port ${PORT}`);
});