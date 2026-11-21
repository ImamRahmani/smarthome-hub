const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));   // dipakai saat dijalankan lokal / di Render

// ============================================================
//  PENGATURAN
// ============================================================
const FAN_ON_C  = 32;   // mode AUTO: kipas menyala di atas suhu ini
const FAN_OFF_C = 30;   // mode AUTO: kipas mati di bawah suhu ini

// ============================================================
//  STATE TERPUSAT
//  lighting = lampu 1 dan doorlock = pintu 1 (kompatibel dengan kontrak lama)
// ============================================================
const lamps = [1, 2, 3].map(id => ({ id, status: 'OFF', intensity: 0, updated_at: '-' }));
const doors = [
  { id: 1, name: 'Pintu lab', lock_status: 'LOCKED', last_uid: '-', access_alert: 'AMAN', updated_at: '-' }
];

const systemState = {
  lighting: lamps[0],
  lamps,
  doorlock: doors[0],
  doors,
  doorbell:   { bell_pressed: false, last_ring_time: '-', updated_at: '-' },
  thermostat: { temperature: 0, humidity: 0, fan_status: 'OFF', mode: 'AUTO', auto_on: FAN_ON_C, auto_off: FAN_OFF_C, updated_at: '-' },
  camera:     { active: false, has_frame: false, updated_at: '-' },
  water:      { level_value: 0, category: '-', critical: false }   // tidak dipakai lagi; dipertahankan agar dashboard lama tidak error
};

let latestFrame = null;   // JPEG terakhir dari ESP32-CAM

const logs = [];
const nowTime = () => new Date().toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });
function addLog(module, message, type = 'info') {
  logs.unshift({ time: nowTime(), module, message, type });
  if (logs.length > 30) logs.pop();
}

const getLamp = id => lamps[Number(id === undefined ? 1 : id) - 1] || null;
const getDoor = id => doors[Number(id === undefined ? 1 : id) - 1] || null;
const noCache = (res) => res.set('Cache-Control', 'no-store');

// ============================================================
//  DASHBOARD
// ============================================================
app.get('/api/state', (req, res) => {
  noCache(res);
  res.json({ ...systemState, logs });
});

// ============================================================
//  SMART LAMP (3 lampu)
// ============================================================
// ESP32 membaca ketiga lampu sekaligus
app.get('/api/lamps', (req, res) => {
  noCache(res);
  res.json({ lamps: lamps.map(l => ({ id: l.id, status: l.status, intensity: l.intensity })) });
});

// Kontrak lama: lampu 1 (boleh ?id=2 / ?id=3)
app.get('/api/lighting', (req, res) => {
  noCache(res);
  const lamp = getLamp(req.query.id);
  if (!lamp) return res.status(400).json({ ok: false, error: 'id lampu tidak valid (1-3)' });
  res.json({ status: lamp.status, intensity: lamp.intensity });
});

// Dashboard. Body: {"id":1|2|3, "status":"ON"|"OFF", "intensity":0-100}
app.post('/api/lighting/control', (req, res) => {
  const lamp = getLamp(req.body.id);
  if (!lamp) return res.status(400).json({ ok: false, error: 'id lampu tidak valid (1-3)' });
  const { status, intensity } = req.body;
  if (status === 'ON' || status === 'OFF') lamp.status = status;
  if (intensity !== undefined) {
    lamp.intensity = Math.max(0, Math.min(100, Number(intensity) || 0));
    lamp.status = lamp.intensity > 0 ? 'ON' : 'OFF';
  } else if (lamp.status === 'ON' && lamp.intensity === 0) {
    lamp.intensity = 100;
  }
  lamp.updated_at = nowTime();
  addLog('LAMPU', `Lampu ${lamp.id} diatur ke ${lamp.status} (${lamp.intensity}%)`, 'control');
  res.json({ ok: true, lamps });
});

// ============================================================
//  SMART DOOR LOCK RFID (1 pintu)
// ============================================================
// ESP32 membaca perintah kunci pintu
app.get('/api/doors', (req, res) => {
  noCache(res);
  res.json({ doors: doors.map(d => ({ id: d.id, lock_status: d.lock_status })) });
});

// Kontrak lama
app.get('/api/doorlock', (req, res) => {
  noCache(res);
  const door = getDoor(req.query.door);
  if (!door) return res.status(400).json({ ok: false, error: 'nomor pintu tidak valid (1)' });
  res.json({ lock_status: door.lock_status });
});

// ESP32 melapor saat kartu ditempel / auto-lock. Body: {"door":1, "last_uid","lock_status","access_alert"}
app.post('/api/doorlock', (req, res) => {
  const door = getDoor(req.body.door);
  if (!door) return res.status(400).json({ ok: false, error: 'nomor pintu tidak valid (1)' });
  const { last_uid, lock_status, access_alert } = req.body;
  if (last_uid !== undefined) door.last_uid = String(last_uid);
  if (lock_status !== undefined) door.lock_status = lock_status;
  if (access_alert !== undefined) door.access_alert = access_alert;
  door.updated_at = nowTime();
  addLog('PINTU', `${door.name}: kartu [${door.last_uid}] -> ${access_alert} (${lock_status})`,
         access_alert === 'DITOLAK' ? 'danger' : 'success');
  res.json({ ok: true });
});

// Dashboard. Body: {"door":1, "lock_status":"LOCKED"|"UNLOCKED"}
app.post('/api/doorlock/control', (req, res) => {
  const door = getDoor(req.body.door);
  if (!door) return res.status(400).json({ ok: false, error: 'nomor pintu tidak valid (1)' });
  const { lock_status } = req.body;
  if (lock_status === 'LOCKED' || lock_status === 'UNLOCKED') {
    door.lock_status = lock_status;
    door.access_alert = lock_status === 'LOCKED' ? 'AMAN' : 'DIIZINKAN';
    door.updated_at = nowTime();
    addLog('PINTU', `${door.name}: ${lock_status === 'UNLOCKED' ? 'dibuka' : 'dikunci'} dari website`, 'control');
  }
  res.json({ ok: true, doors });
});

// ============================================================
//  VIDEO DOORBELL (pintu lab) + KAMERA
// ============================================================
app.post('/api/doorbell', (req, res) => {
  const bell = systemState.doorbell;
  bell.bell_pressed = Boolean(req.body.bell_pressed);
  bell.updated_at = nowTime();
  if (bell.bell_pressed) {
    bell.last_ring_time = nowTime();
    addLog('BEL', 'Bel pintu ditekan! Ada orang di depan lab.', 'warning');

    // bel ditekan -> kamera menyala otomatis
    latestFrame = null;
    systemState.camera.has_frame = false;
    systemState.camera.active = true;
    systemState.camera.updated_at = nowTime();
    addLog('KAMERA', 'Kamera diaktifkan oleh bel pintu.', 'info');
  }
  res.json({ ok: true });
});

app.post('/api/doorbell/ack', (req, res) => {
  systemState.doorbell.bell_pressed = false;
  addLog('BEL', 'Status bel di-reset dari website.', 'info');
  res.json({ ok: true });
});

// ESP32-CAM bertanya: harus aktif atau tidak
app.get('/api/camera', (req, res) => {
  noCache(res);
  res.json({ active: systemState.camera.active });
});

// Dashboard menyalakan / mematikan kamera. Body: {"active":true|false}
app.post('/api/camera/control', (req, res) => {
  const { active } = req.body;
  if (typeof active === 'boolean') {
    systemState.camera.active = active;
    systemState.camera.updated_at = nowTime();
    if (!active) {
      latestFrame = null;
      systemState.camera.has_frame = false;
      systemState.doorbell.bell_pressed = false;   // kamera ditutup = notifikasi bel selesai
    }
    addLog('KAMERA', `Kamera ${active ? 'dinyalakan' : 'dimatikan'} dari website.`, 'control');
  }
  res.json({ ok: true, camera: systemState.camera });
});

// ESP32-CAM mengirim 1 frame JPEG (body mentah). Balasan: apakah masih harus aktif
app.post('/api/camera/frame', express.raw({ type: 'image/jpeg', limit: '2mb' }), (req, res) => {
  if (Buffer.isBuffer(req.body) && req.body.length > 0 && systemState.camera.active) {
    latestFrame = req.body;
    systemState.camera.has_frame = true;
    systemState.camera.updated_at = nowTime();
  }
  res.json({ active: systemState.camera.active });
});

// Dashboard mengambil frame terbaru
app.get('/api/camera/frame', (req, res) => {
  if (!latestFrame) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  res.send(latestFrame);
});

// ============================================================
//  SMART THERMOSTAT (kipas = pengganti AC)
//  Mode AUTO  : kipas ON jika suhu > FAN_ON_C, OFF jika suhu < FAN_OFF_C
//  Mode MANUAL: kipas mengikuti tombol ON/OFF di website
// ============================================================
function applyAutoFan() {
  const t = systemState.thermostat;
  if (t.mode !== 'AUTO') return;
  if (t.temperature > FAN_ON_C && t.fan_status !== 'ON') {
    t.fan_status = 'ON';
    addLog('SUHU', `Suhu ${t.temperature}°C > ${FAN_ON_C}°C, kipas otomatis ON`, 'warning');
  } else if (t.temperature < FAN_OFF_C && t.fan_status !== 'OFF') {
    t.fan_status = 'OFF';
    addLog('SUHU', `Suhu ${t.temperature}°C < ${FAN_OFF_C}°C, kipas otomatis OFF`, 'info');
  }
}

// ESP32 mengirim suhu; balasan = status kipas
app.post('/api/thermostat', (req, res) => {
  const { temperature, humidity } = req.body;
  const t = systemState.thermostat;
  if (temperature !== undefined) t.temperature = Number(temperature);
  if (humidity !== undefined) t.humidity = Number(humidity);
  t.updated_at = nowTime();
  applyAutoFan();
  res.json({ fan_status: t.fan_status });
});

// Dashboard. Body: {"fan_status":"ON"|"OFF"} (mode MANUAL) atau {"mode":"AUTO"}
app.post('/api/thermostat/fan', (req, res) => {
  const { fan_status, mode } = req.body;
  const t = systemState.thermostat;
  if (mode === 'AUTO') {
    t.mode = 'AUTO';
    applyAutoFan();
    addLog('SUHU', 'Kipas kembali ke mode AUTO.', 'control');
  } else if (fan_status === 'ON' || fan_status === 'OFF') {
    t.mode = 'MANUAL';
    t.fan_status = fan_status;
    addLog('SUHU', `Kipas diatur manual ke ${fan_status}.`, 'control');
  }
  res.json({ ok: true, fan_status: t.fan_status, mode: t.mode });
});

// Water monitor sudah tidak dipakai. Endpoint dibiarkan agar kode lama tidak error.
app.post('/api/water', (req, res) => res.json({ ok: true }));

// ============================================================
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    addLog('SISTEM', 'Server Smart IoT Lab aktif.', 'info');
    console.log(`Smart IoT Lab berjalan di http://localhost:${PORT}`);
  });
}
