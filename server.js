// server.js — Backend Terpadu Smart Home IoT (MySQL + Kontrak node1.4.ino & ESP32-CAM)
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
//  KONSTANTA & DEFAULT STATE (Anti-crash jika baris DB kosong)
// ============================================================
const DEFAULT_FAN_ON_C = 32;
const DEFAULT_FAN_OFF_C = 30;
const TELEMETRY_THROTTLE_MS = 30000; // Catat histori sensor rutin maks tiap 30 detik

const DEFAULT_STATES = {
  lamps: [1, 2, 3].map(id => ({ id, status: 'OFF', intensity: 0, updated_at: '-' })),
  doors: [
    { id: 1, name: 'Pintu lab', lock_status: 'LOCKED', last_uid: '-', access_alert: 'AMAN', updated_at: '-' }
  ],
  doorbell: { bell_pressed: false, last_ring_time: '-', updated_at: '-' },
  thermostat: {
    temperature: 0,
    humidity: 0,
    fan_status: 'OFF',
    mode: 'AUTO',
    auto_on: DEFAULT_FAN_ON_C,
    auto_off: DEFAULT_FAN_OFF_C,
    updated_at: '-'
  },
  camera: { active: false, has_frame: false, updated_at: '-' },
  water: { level_value: 0, category: '-', critical: false, updated_at: '-' }
};

// Cache RAM untuk streaming ESP32-CAM & throttling telemetri
let latestFrame = null;
let cameraStateCache = { active: false, has_frame: false, updated_at: '-' };
let lastThermoLog = { time: 0, temp: null, hum: null };
let lastWaterLog = { time: 0, level: null };

// ============================================================
//  HELPER UMUM & DATABASE
// ============================================================
const nowTime = () =>
  new Date().toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });

const noCache = (res) => res.set('Cache-Control', 'no-store');

const cloneDefault = (deviceId) => JSON.parse(JSON.stringify(DEFAULT_STATES[deviceId]));

async function getDeviceState(deviceId) {
  const [rows] = await db.query(
    'SELECT state_json FROM device_states WHERE device_id = ?',
    [deviceId]
  );
  if (rows.length === 0) return cloneDefault(deviceId);
  return typeof rows[0].state_json === 'string'
    ? JSON.parse(rows[0].state_json)
    : rows[0].state_json;
}

async function setDeviceState(deviceId, stateObj) {
  if (!Array.isArray(stateObj)) {
    stateObj.updated_at = nowTime();
  }
  await db.query(
    `INSERT INTO device_states (device_id, state_json, updated_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = NOW()`,
    [deviceId, JSON.stringify(stateObj)]
  );
  return stateObj;
}

async function insertLog(moduleName, identifier, status) {
  await db.query(
    'INSERT INTO security_logs (event_type, identifier, status) VALUES (?, ?, ?)',
    [moduleName, identifier, status]
  );
}

function findById(list, rawId, fallbackId = 1) {
  const numId = Number(rawId === undefined || rawId === '' ? fallbackId : rawId);
  return list.find(item => item.id === numId) || null;
}

// ============================================================
//  1. DASHBOARD TELEMETRI & RIWAYAT
// ============================================================
app.get('/api/state', async (req, res) => {
  noCache(res);
  try {
    const [rows] = await db.query('SELECT device_id, state_json FROM device_states');
    const raw = {};
    rows.forEach(r => {
      raw[r.device_id] = typeof r.state_json === 'string' ? JSON.parse(r.state_json) : r.state_json;
    });

    const lamps = Array.isArray(raw.lamps) ? raw.lamps : cloneDefault('lamps');
    const doors = Array.isArray(raw.doors) ? raw.doors : cloneDefault('doors');
    const doorbell = raw.doorbell || cloneDefault('doorbell');
    const thermostat = { ...cloneDefault('thermostat'), ...(raw.thermostat || {}) };
    const water = { ...cloneDefault('water'), ...(raw.water || {}) };
    const camera = {
      ...cameraStateCache,
      has_frame: latestFrame !== null
    };

    const [logs] = await db.query(
      `SELECT
        DATE_FORMAT(recorded_at, '%H:%i:%s') AS time,
        event_type AS module,
        CONCAT(identifier, ' -> ', status) AS message,
        CASE
          WHEN status LIKE '%DITOLAK%' THEN 'danger'
          WHEN status LIKE '%BEL DITEKAN%' OR status LIKE '%otomatis ON%' OR status LIKE '%PENUH%' OR status LIKE '%RENDAH%' THEN 'warning'
          WHEN status LIKE '%DIIZINKAN%' OR status LIKE '%ON%' THEN 'success'
          ELSE 'control'
        END AS type
       FROM security_logs ORDER BY id DESC LIMIT 25`
    );

    res.json({
      lighting: lamps[0],   // kompatibel dengan kontrak lama & dashboard saat ini
      lamps,
      doorlock: doors[0],   // kompatibel dengan kontrak lama & dashboard saat ini
      doors,
      doorbell,
      thermostat,
      camera,
      water,
      logs
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  noCache(res);
  try {
    const [rows] = await db.query(
      `SELECT metric_name, metric_value, DATE_FORMAT(recorded_at, '%H:%i:%s') AS time
       FROM telemetry_logs ORDER BY id DESC LIMIT 40`
    );
    res.json(rows.reverse());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  2. SMART LAMP (3 LAMPU PWM — node1.4.ino)
// ============================================================
app.get('/api/lamps', async (req, res) => {
  noCache(res);
  try {
    const lamps = await getDeviceState('lamps');
    res.json({
      lamps: lamps.map(l => ({ id: l.id, status: l.status, intensity: l.intensity }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Kontrak lama: default lampu 1, bisa ?id=2 atau ?id=3
app.get('/api/lighting', async (req, res) => {
  noCache(res);
  try {
    const lamps = await getDeviceState('lamps');
    const lamp = findById(lamps, req.query.id, 1);
    if (!lamp) return res.status(400).json({ ok: false, error: 'id lampu tidak valid (1-3)' });
    res.json({ status: lamp.status, intensity: lamp.intensity });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Dashboard: {"id":1|2|3, "status":"ON"|"OFF", "intensity":0-100} (id opsional, default 1)
app.post('/api/lighting/control', async (req, res) => {
  try {
    const lamps = await getDeviceState('lamps');
    const lamp = findById(lamps, req.body.id, 1);
    if (!lamp) return res.status(400).json({ ok: false, error: 'id lampu tidak valid (1-3)' });

    const { status, intensity } = req.body;
    if (status === 'ON' || status === 'OFF') {
      lamp.status = status;
    }
    if (intensity !== undefined) {
      lamp.intensity = Math.max(0, Math.min(100, Number(intensity) || 0));
      lamp.status = lamp.intensity > 0 ? 'ON' : 'OFF';
    } else if (lamp.status === 'ON' && lamp.intensity === 0) {
      lamp.intensity = 100; // Fix: jangan biarkan status ON dengan PWM 0%
    }
    lamp.updated_at = nowTime();

    await setDeviceState('lamps', lamps);
    await insertLog('LAMPU', `Lampu ${lamp.id}`, `Diatur ke ${lamp.status} (${lamp.intensity}%)`);
    res.json({ ok: true, lighting: lamp, lamps });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  3. SMART DOOR LOCK RFID (1 PINTU — node1.4.ino)
// ============================================================
app.get('/api/doors', async (req, res) => {
  noCache(res);
  try {
    const doors = await getDeviceState('doors');
    res.json({
      doors: doors.map(d => ({ id: d.id, lock_status: d.lock_status }))
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Kontrak lama
app.get('/api/doorlock', async (req, res) => {
  noCache(res);
  try {
    const doors = await getDeviceState('doors');
    const door = findById(doors, req.query.door, 1);
    if (!door) return res.status(400).json({ ok: false, error: 'nomor pintu tidak valid (1)' });
    res.json({ lock_status: door.lock_status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ESP32 melapor saat kartu ditempel / auto-lock
app.post('/api/doorlock', async (req, res) => {
  try {
    const doors = await getDeviceState('doors');
    const door = findById(doors, req.body.door, 1);
    if (!door) return res.status(400).json({ ok: false, error: 'nomor pintu tidak valid (1)' });

    const { last_uid, lock_status, access_alert } = req.body;
    if (last_uid !== undefined) door.last_uid = String(last_uid);
    if (lock_status === 'LOCKED' || lock_status === 'UNLOCKED') door.lock_status = lock_status;
    if (access_alert !== undefined) door.access_alert = String(access_alert);
    door.updated_at = nowTime();

    await setDeviceState('doors', doors);
    await insertLog(
      'PINTU',
      `${door.name} [${door.last_uid}]`,
      `${door.access_alert} (${door.lock_status})`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Dashboard override: {"door":1, "lock_status":"LOCKED"|"UNLOCKED"}
app.post('/api/doorlock/control', async (req, res) => {
  try {
    const doors = await getDeviceState('doors');
    const door = findById(doors, req.body.door, 1);
    if (!door) return res.status(400).json({ ok: false, error: 'nomor pintu tidak valid (1)' });

    const { lock_status } = req.body;
    if (lock_status !== 'LOCKED' && lock_status !== 'UNLOCKED') {
      return res.status(400).json({ ok: false, error: 'lock_status harus LOCKED atau UNLOCKED' });
    }

    door.lock_status = lock_status;
    door.access_alert = lock_status === 'LOCKED' ? 'AMAN' : 'DIIZINKAN';
    door.updated_at = nowTime();

    await setDeviceState('doors', doors);
    await insertLog(
      'PINTU',
      door.name,
      `${lock_status === 'UNLOCKED' ? 'Dibuka' : 'Dikunci'} dari website (${lock_status})`
    );
    res.json({ ok: true, doorlock: door, doors });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  4. VIDEO DOORBELL + KAMERA ESP32-CAM
// ============================================================
app.post('/api/doorbell', async (req, res) => {
  try {
    const bell = await getDeviceState('doorbell');
    bell.bell_pressed = Boolean(req.body.bell_pressed);

    if (bell.bell_pressed) {
      bell.last_ring_time = nowTime();
      await insertLog('BEL', 'Pintu Depan', 'BEL DITEKAN! Ada orang di depan lab');

      // Bel ditekan -> aktifkan ESP32-CAM otomatis
      latestFrame = null;
      cameraStateCache = { active: true, has_frame: false, updated_at: nowTime() };
      await setDeviceState('camera', cameraStateCache);
      await insertLog('KAMERA', 'ESP32-CAM', 'Kamera diaktifkan otomatis oleh bel pintu');
    }

    await setDeviceState('doorbell', bell);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/doorbell/ack', async (req, res) => {
  try {
    const bell = await getDeviceState('doorbell');
    bell.bell_pressed = false;
    await setDeviceState('doorbell', bell);
    await insertLog('BEL', 'Web Dashboard', 'Status bel di-reset');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ESP32-CAM polling: cek apakah kamera harus aktif (langsung dari RAM agar cepat)
app.get('/api/camera', (req, res) => {
  noCache(res);
  res.json({ active: cameraStateCache.active });
});

// Dashboard menyalakan / mematikan kamera. Body: {"active":true|false}
app.post('/api/camera/control', async (req, res) => {
  try {
    const { active } = req.body;
    if (typeof active !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'active harus boolean (true/false)' });
    }

    cameraStateCache.active = active;
    cameraStateCache.updated_at = nowTime();

    if (!active) {
      latestFrame = null;
      cameraStateCache.has_frame = false;

      // Kamera ditutup = notifikasi bel dianggap selesai
      const bell = await getDeviceState('doorbell');
      if (bell.bell_pressed) {
        bell.bell_pressed = false;
        await setDeviceState('doorbell', bell);
      }
    }

    await setDeviceState('camera', cameraStateCache);
    await insertLog('KAMERA', 'Web Dashboard', `Kamera ${active ? 'ON' : 'OFF'} dari website`);
    res.json({ ok: true, camera: cameraStateCache });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ESP32-CAM mengirim 1 frame JPEG mentah (simpan di RAM, tanpa query MySQL tiap frame)
app.post('/api/camera/frame', express.raw({ type: 'image/jpeg', limit: '2mb' }), (req, res) => {
  if (Buffer.isBuffer(req.body) && req.body.length > 0 && cameraStateCache.active) {
    latestFrame = req.body;
    cameraStateCache.has_frame = true;
    cameraStateCache.updated_at = nowTime();
  }
  res.json({ active: cameraStateCache.active });
});

// Dashboard mengambil frame JPEG terbaru
app.get('/api/camera/frame', (req, res) => {
  if (!latestFrame) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  res.send(latestFrame);
});

// ============================================================
//  5. SMART THERMOSTAT (KIPAS AUTO / MANUAL — node1.4.ino)
// ============================================================
async function applyAutoFan(thermo) {
  if (thermo.mode !== 'AUTO') return;
  const onLimit = Number(thermo.auto_on ?? DEFAULT_FAN_ON_C);
  const offLimit = Number(thermo.auto_off ?? DEFAULT_FAN_OFF_C);

  if (thermo.temperature > onLimit && thermo.fan_status !== 'ON') {
    thermo.fan_status = 'ON';
    await insertLog('SUHU', 'Auto Thermostat', `Suhu ${thermo.temperature}°C > ${onLimit}°C, kipas otomatis ON`);
  } else if (thermo.temperature < offLimit && thermo.fan_status !== 'OFF') {
    thermo.fan_status = 'OFF';
    await insertLog('SUHU', 'Auto Thermostat', `Suhu ${thermo.temperature}°C < ${offLimit}°C, kipas otomatis OFF`);
  }
}

// ESP32 mengirim suhu & kelembapan; balasan = status kipas
app.post('/api/thermostat', async (req, res) => {
  try {
    const { temperature, humidity } = req.body;
    const current = { ...cloneDefault('thermostat'), ...(await getDeviceState('thermostat')) };

    if (temperature !== undefined) current.temperature = Number(temperature);
    if (humidity !== undefined) current.humidity = Number(humidity);

    await applyAutoFan(current);
    await setDeviceState('thermostat', current);

    // Throttling insert telemetry_logs: simpan jika lewat 30 detik atau ada perubahan signifikan
    const now = Date.now();
    const significantChange =
      lastThermoLog.temp === null ||
      Math.abs(current.temperature - lastThermoLog.temp) >= 0.5 ||
      Math.abs(current.humidity - lastThermoLog.hum) >= 2;

    if (
      temperature !== undefined &&
      humidity !== undefined &&
      (now - lastThermoLog.time >= TELEMETRY_THROTTLE_MS || significantChange)
    ) {
      await db.query(
        `INSERT INTO telemetry_logs (device_id, metric_name, metric_value)
         VALUES ('thermostat', 'temperature', ?), ('thermostat', 'humidity', ?)`,
        [current.temperature, current.humidity]
      );
      lastThermoLog = { time: now, temp: current.temperature, hum: current.humidity };
    }

    res.json({ fan_status: current.fan_status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Dashboard: {"fan_status":"ON"|"OFF"} (MANUAL), {"mode":"AUTO"}, atau {"auto_on":32,"auto_off":30}
app.post('/api/thermostat/fan', async (req, res) => {
  try {
    const { fan_status, mode, auto_on, auto_off } = req.body;
    const current = { ...cloneDefault('thermostat'), ...(await getDeviceState('thermostat')) };

    if (auto_on !== undefined && auto_off !== undefined && Number(auto_on) > Number(auto_off)) {
      current.auto_on = Number(auto_on);
      current.auto_off = Number(auto_off);
      await insertLog('SUHU', 'Web Dashboard', `Batas suhu AUTO diubah: ON > ${current.auto_on}°C, OFF < ${current.auto_off}°C`);
    }

    if (mode === 'AUTO') {
      current.mode = 'AUTO';
      await applyAutoFan(current);
      await insertLog('SUHU', 'Kipas DC', 'Mode diubah ke AUTO');
    } else if (fan_status === 'ON' || fan_status === 'OFF') {
      current.mode = 'MANUAL';
      current.fan_status = fan_status;
      await insertLog('SUHU', 'Kipas DC', `Diatur MANUAL ke ${fan_status}`);
    } else if (current.mode === 'AUTO') {
      await applyAutoFan(current);
    }

    await setDeviceState('thermostat', current);
    res.json({
      ok: true,
      fan_status: current.fan_status,
      mode: current.mode,
      auto_on: current.auto_on,
      auto_off: current.auto_off
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  6. WATER MONITOR (Opsional — dipertahankan untuk kompatibilitas)
// ============================================================
app.post('/api/water', async (req, res) => {
  try {
    const { level_value, category } = req.body;
    const current = { ...cloneDefault('water'), ...(await getDeviceState('water')) };
    const prevCat = current.category;

    if (level_value !== undefined) current.level_value = Number(level_value);
    if (category !== undefined) {
      current.category = String(category);
      current.critical = current.category === 'RENDAH';
    }

    await setDeviceState('water', current);

    const now = Date.now();
    if (
      level_value !== undefined &&
      (now - lastWaterLog.time >= TELEMETRY_THROTTLE_MS || Math.abs(current.level_value - (lastWaterLog.level ?? -999)) >= 2)
    ) {
      await db.query(
        `INSERT INTO telemetry_logs (device_id, metric_name, metric_value)
         VALUES ('water', 'water_level', ?)`,
        [current.level_value]
      );
      lastWaterLog = { time: now, level: current.level_value };
    }

    if (category && category !== prevCat) {
      await insertLog('WATER', 'Sensor Tangki', `Status berubah ke ${current.category} (${current.level_value}%)`);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server Smart Home Terpadu (MySQL Storage) aktif di port ${PORT}`);
});