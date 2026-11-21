// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function nowTime() {
  return new Date().toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Makassar' });
}

// Helper: Ambil state perangkat
async function getDeviceState(deviceId) {
  const [rows] = await db.query('SELECT state_json FROM device_states WHERE device_id = ?', [deviceId]);
  if (rows.length === 0) return null;
  return typeof rows[0].state_json === 'string' ? JSON.parse(rows[0].state_json) : rows[0].state_json;
}

// Helper: Update state perangkat
async function setDeviceState(deviceId, stateObj) {
  stateObj.updated_at = nowTime();
  await db.query(
    'UPDATE device_states SET state_json = ?, updated_at = NOW() WHERE device_id = ?',
    [JSON.stringify(stateObj), deviceId]
  );
  return stateObj;
}

// Helper: Catat audit keamanan / log aktivitas
async function insertLog(moduleName, identifier, status) {
  await db.query(
    'INSERT INTO security_logs (event_type, identifier, status) VALUES (?, ?, ?)',
    [moduleName, identifier, status]
  );
}

// === 1. ENDPOINT TELEMETRI UTAMA (FRONTEND DASHBOARD) ===
app.get('/api/state', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT device_id, state_json FROM device_states');
    const state = {};
    rows.forEach(r => {
      state[r.device_id] = typeof r.state_json === 'string' ? JSON.parse(r.state_json) : r.state_json;
    });

    // Ambil 25 aktivitas terakhir dari MySQL
    const [logs] = await db.query(
      `SELECT 
        DATE_FORMAT(recorded_at, '%H:%i:%s') AS time, 
        event_type AS module, 
        CONCAT(identifier, ' -> ', status) AS message,
        CASE 
          WHEN status LIKE '%DITOLAK%' THEN 'danger'
          WHEN status LIKE '%BEL DITEKAN%' OR status LIKE '%PENUH%' OR status LIKE '%RENDAH%' THEN 'warning'
          WHEN status LIKE '%DIIZINKAN%' OR status LIKE '%ON%' THEN 'success'
          ELSE 'control'
        END AS type
       FROM security_logs ORDER BY id DESC LIMIT 25`
    );

    res.json({ ...state, logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint data historis grafik sensor
app.get('/api/history', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT metric_name, metric_value, DATE_FORMAT(recorded_at, '%H:%i:%s') AS time 
       FROM telemetry_logs ORDER BY id DESC LIMIT 30`
    );
    res.json(rows.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 2. FITUR SMART LIGHTING (NO. 2) ===
app.get('/api/lighting', async (req, res) => {
  try {
    const data = await getDeviceState('lighting');
    res.json({ status: data.status, intensity: data.intensity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/lighting/control', async (req, res) => {
  try {
    const { status, intensity } = req.body;
    const current = await getDeviceState('lighting');

    if (intensity !== undefined) {
      current.intensity = Number(intensity);
      current.status = Number(intensity) > 0 ? 'ON' : 'OFF';
    } else if (status !== undefined) {
      current.status = status;
    }

    await setDeviceState('lighting', current);
    await insertLog('LIGHTING', 'Web Control', `Diatur ke ${current.status} (${current.intensity}%)`);
    res.json({ ok: true, lighting: current });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 3. FITUR SMART DOOR LOCK (NO. 4) ===
app.get('/api/doorlock', async (req, res) => {
  try {
    const data = await getDeviceState('doorlock');
    res.json({ lock_status: data.lock_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/doorlock', async (req, res) => {
  try {
    const { last_uid, lock_status, access_alert } = req.body;
    const current = await getDeviceState('doorlock');

    if (last_uid !== undefined) current.last_uid = String(last_uid);
    if (lock_status !== undefined) current.lock_status = lock_status;
    if (access_alert !== undefined) current.access_alert = access_alert;

    await setDeviceState('doorlock', current);
    await insertLog('DOORLOCK', `Kartu [${current.last_uid}]`, `${access_alert} (${lock_status})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/doorlock/control', async (req, res) => {
  try {
    const { lock_status } = req.body;
    const current = await getDeviceState('doorlock');

    current.lock_status = lock_status;
    current.access_alert = lock_status === 'LOCKED' ? 'AMAN' : 'DIIZINKAN';

    await setDeviceState('doorlock', current);
    await insertLog('DOORLOCK', 'Web Override', `Status gerendel: ${lock_status}`);
    res.json({ ok: true, doorlock: current });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 4. FITUR VIDEO DOORBELL (NO. 5) ===
app.post('/api/doorbell', async (req, res) => {
  try {
    const { bell_pressed } = req.body;
    const current = await getDeviceState('doorbell');
    current.bell_pressed = Boolean(bell_pressed);

    if (bell_pressed) {
      current.last_ring_time = nowTime();
      await insertLog('DOORBELL', 'Tamu Depan', 'BEL DITEKAN');
    }

    await setDeviceState('doorbell', current);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/doorbell/ack', async (req, res) => {
  try {
    const current = await getDeviceState('doorbell');
    current.bell_pressed = false;
    await setDeviceState('doorbell', current);
    await insertLog('DOORBELL', 'Web Dashboard', 'Notifikasi Direspon');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 5. FITUR SMART THERMOSTAT (NO. 6) ===
app.post('/api/thermostat', async (req, res) => {
  try {
    const { temperature, humidity } = req.body;
    const current = await getDeviceState('thermostat');

    if (temperature !== undefined) current.temperature = Number(temperature);
    if (humidity !== undefined) current.humidity = Number(humidity);

    await setDeviceState('thermostat', current);

    // Simpan ke riwayat telemetri
    if (temperature !== undefined && humidity !== undefined) {
      await db.query(
        'INSERT INTO telemetry_logs (device_id, metric_name, metric_value) VALUES ("thermostat", "temperature", ?), ("thermostat", "humidity", ?)',
        [temperature, humidity]
      );
    }

    res.json({ fan_status: current.fan_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/thermostat/fan', async (req, res) => {
  try {
    const { fan_status } = req.body;
    const current = await getDeviceState('thermostat');

    if (fan_status === 'ON' || fan_status === 'OFF') {
      current.fan_status = fan_status;
      await setDeviceState('thermostat', current);
      await insertLog('THERMOSTAT', 'Kipas DC', `Status diubah ke ${fan_status}`);
    }

    res.json({ ok: true, fan_status: current.fan_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 6. FITUR WATER MONITOR (NO. 7) ===
app.post('/api/water', async (req, res) => {
  try {
    const { level_value, category } = req.body;
    const current = await getDeviceState('water');
    const prevCat = current.category;

    if (level_value !== undefined) current.level_value = Number(level_value);
    if (category !== undefined) current.category = category;

    await setDeviceState('water', current);

    if (level_value !== undefined) {
      await db.query(
        'INSERT INTO telemetry_logs (device_id, metric_name, metric_value) VALUES ("water", "water_level", ?)',
        [level_value]
      );
    }

    if (category && category !== prevCat) {
      await insertLog('WATER', 'Sensor Tangki', `Status berubah ke ${category} (${level_value}%)`);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server Smart Home (MySQL Storage) aktif di port ${PORT}`);
});
