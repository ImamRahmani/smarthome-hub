/*
  NODE 1 (ESP32 DevKit) - 3 lampu + 1 pintu RFID + bel pintu depan + thermostat
  Versi Fase 3: Terintegrasi dengan Docker Backend Lokal (server.js)

  Endpoint yang dipakai:
    GET  /api/lamps                 -> {"lamps":[{"id":1..3,"status":"ON"|"OFF","intensity":0-100}]}
    GET  /api/doors                 -> {"doors":[{"id":1,"lock_status":"LOCKED"|"UNLOCKED"}]}
    POST /api/doorlock              {"door":1,"last_uid":"..","lock_status":"..","access_alert":".."}
    POST /api/doorbell              {"bell_pressed":true}
    POST /api/thermostat            {"temperature":..,"humidity":..} -> {"fan_status":"ON"|"OFF"}

  Pin:
    Lampu 1/2/3 (PWM)      : 25 / 33 / 22
    Servo pintu            : 13
    RC522 bersama          : SCK=18, MOSI=23, MISO=19, RST=27
    RC522 pintu            : SDA(SS)=5
    Buzzer=26, Tombol bel=14, DHT=4, Kipas (BC337)=16 (RX2), Trig=17 (TX2), Echo=34

  Library: ArduinoJson (v7), ESP32Servo, MFRC522, DHT sensor library (Adafruit) + Adafruit Unified Sensor
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <DHT.h>

// 0 = MODE ONLINE (terhubung WiFi & server Docker lokal)
#define OFFLINE_TEST 0
// 1 = pakai modul RC522 asli, 0 = hanya simulasi lewat Serial Monitor
#define USE_RFID_HW 1
// 0 = water monitor nonaktif
#define ENABLE_WATER 0

#if USE_RFID_HW
#include <SPI.h>
#include <MFRC522.h>
#endif

// ---------- Konfigurasi WiFi & Server Lokal ----------
const char* WIFI_SSID   = "realme 6";
const char* WIFI_PASS   = "imamrahmani";
const char* SERVER_BASE = "http://10.145.70.13:3000";

// ---------- Lampu ----------
const int NUM_LAMPS = 3;
const int LAMP_PINS[NUM_LAMPS]     = {25, 33, 22};
const int LAMP_CHANNELS[NUM_LAMPS] = {8, 9, 10};   // channel PWM terpisah dari servo

// ---------- Pintu ----------
const int NUM_DOORS = 1;
const int DOOR_SERVO_PINS[NUM_DOORS] = {13};
const int PIN_RC_SS1 = 5;
const int PIN_RC_SCK = 18, PIN_RC_MOSI = 23, PIN_RC_MISO = 19, PIN_RC_RST = 27;

#if USE_RFID_HW
MFRC522 rfid1(PIN_RC_SS1, MFRC522::UNUSED_PIN);   // RST dikendalikan manual
MFRC522* readers[NUM_DOORS] = { &rfid1 };
bool readerOk[NUM_DOORS] = { false };
#endif

// Daftar kartu yang sah
const char* AUTHORIZED_UIDS[] = {"A1B2C3D4", "6028A01A"};
const int AUTH_COUNT = sizeof(AUTHORIZED_UIDS) / sizeof(AUTHORIZED_UIDS[0]);
const unsigned long RELOCK_MS = 5000;
const int SERVO_LOCK_ANGLE = 0, SERVO_OPEN_ANGLE = 90;

struct Door {
  Servo servo;
  bool unlocked = false;
  bool byDashboard = false;
  unsigned long unlockedAt = 0;
  String lastUid = "-";
  String lastAlert = "AMAN";
};
Door doors[NUM_DOORS];

// ---------- Pin lain ----------
const int PIN_BUZZER = 26;
const int PIN_BELL   = 14;   // bel pintu depan
const int PIN_DHT    = 4;
const int PIN_FAN    = 16;   // RX2 -> resistor 1k -> Base BC337
const int PIN_TRIG   = 17;   // TX2
const int PIN_ECHO   = 34;

// ---------- Thermostat ----------
#define DHTTYPE DHT22
DHT dht(PIN_DHT, DHTTYPE);
#define FAN_ACTIVE_HIGH 1
// 0 = aturan AUTO/MANUAL kipas dikendalikan penuh oleh server.js
#define LOCAL_AUTO_FAN 0
float TEMP_ON_C  = 32.0;
float TEMP_OFF_C = 30.0;
int fanOverride  = 0;        // 0 = auto, 1 = paksa ON, 2 = paksa OFF (hanya uji manual)
bool serverFanOn = false;
bool localFanOn  = false;

// ---------- Water monitor ----------
const float WATER_CRITICAL_CM = 100.0;
const float WATER_FULL_CM     = 20.0;

// ---------- Bel (interrupt) ----------
volatile bool bellFlag = false;
volatile unsigned long bellIsrMs = 0;

void IRAM_ATTR onBell() {
  unsigned long now = millis();
  if (now - bellIsrMs > 300) { bellIsrMs = now; bellFlag = true; }
}

// ================== UMUM ==================
void beep(int ms) {
  digitalWrite(PIN_BUZZER, HIGH);
  delay(ms);
  digitalWrite(PIN_BUZZER, LOW);
  delay(60);
}

void connectWiFi() {
  Serial.print("Menghubungkan WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) { delay(250); Serial.print("."); tries++; }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf(" OK (IP ESP32: %s)\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(" GAGAL");
  }
}

WiFiClientSecure secureClient;
WiFiClient plainClient;
bool secureReady = false;

int sendHttp(bool isPost, const String& path, const String& body, String& resp) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  String url = String(SERVER_BASE) + path;
  bool isHttps = url.startsWith("https");
  HTTPClient http;
  if (isHttps) {
    if (!secureReady) { secureClient.setInsecure(); secureReady = true; }
    http.begin(secureClient, url);
  } else {
    http.begin(plainClient, url);
  }
  http.setReuse(true);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  int code = isPost ? http.POST(body) : http.GET();
  if (code > 0) {
    resp = http.getString();
  } else {
    if (isHttps) secureClient.stop();
    else plainClient.stop();
  }
  http.end();
  return code;
}

// ================== 3 LAMPU ==================
void setLamp(int i, bool on, int intensity) {
  intensity = constrain(intensity, 0, 100);
  int duty = on ? map(intensity, 0, 100, 0, 255) : 0;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(LAMP_PINS[i], duty);
#else
  ledcWrite(LAMP_CHANNELS[i], duty);
#endif
}

void pollLamps() {
  String resp;
  int code = sendHttp(false, "/api/lamps", "", resp);

  if (code == 404) {
    code = sendHttp(false, "/api/lighting", "", resp);
    if (code != 200) { Serial.printf("[LAMP] GET gagal, code=%d\n", code); return; }
    JsonDocument d;
    if (deserializeJson(d, resp)) { Serial.println("[LAMP] JSON tidak valid"); return; }
    const char* st = d["status"] | "OFF";
    int inten = d["intensity"] | 0;
    setLamp(0, strcmp(st, "ON") == 0, inten);
    Serial.printf("[LAMP] (server lama) L1=%s/%d\n", st, inten);
    return;
  }
  if (code != 200) { Serial.printf("[LAMP] GET gagal, code=%d\n", code); return; }

  JsonDocument doc;
  if (deserializeJson(doc, resp)) { Serial.println("[LAMP] JSON tidak valid"); return; }
  Serial.print("[LAMP]");
  for (JsonObject l : doc["lamps"].as<JsonArray>()) {
    int id = l["id"] | 0;
    if (id < 1 || id > NUM_LAMPS) continue;
    const char* st = l["status"] | "OFF";
    int inten = l["intensity"] | 0;
    setLamp(id - 1, strcmp(st, "ON") == 0, inten);
    Serial.printf(" L%d=%s/%d", id, st, inten);
  }
  Serial.println();
}

// ================== PINTU RFID ==================
void driveDoor(int i, bool open) {
  doors[i].servo.write(open ? SERVO_OPEN_ANGLE : SERVO_LOCK_ANGLE);
}

void postDoorlock(int i, const String& uid, const char* lockStatus, const char* alert) {
#if OFFLINE_TEST
  return;
#endif
  JsonDocument doc;
  doc["door"] = i + 1;
  doc["last_uid"] = uid;
  doc["lock_status"] = lockStatus;
  doc["access_alert"] = alert;
  String body; serializeJson(doc, body);
  String resp;
  int code = sendHttp(true, "/api/doorlock", body, resp);
  Serial.printf("[DOOR%d] POST %s -> code=%d\n", i + 1, body.c_str(), code);
}

void applyDoorCommand(int i, const char* st) {
  Door& d = doors[i];
  if (strcmp(st, "UNLOCKED") == 0 && !d.unlocked) {
    Serial.printf("[DOOR%d] Dashboard: BUKA\n", i + 1);
    driveDoor(i, true);
    d.unlocked = true;
    d.byDashboard = true;
    beep(150);
  } else if (strcmp(st, "LOCKED") == 0 && d.unlocked &&
             (d.byDashboard || millis() - d.unlockedAt > 2000)) {
    Serial.printf("[DOOR%d] Dashboard: KUNCI\n", i + 1);
    driveDoor(i, false);
    d.unlocked = false;
    d.byDashboard = false;
    beep(80);
  }
}

void pollDoors() {
  String resp;
  int code = sendHttp(false, "/api/doors", "", resp);

  if (code == 404) {
    code = sendHttp(false, "/api/doorlock", "", resp);
    if (code != 200) { Serial.printf("[DOOR] GET gagal, code=%d\n", code); return; }
    JsonDocument d;
    if (deserializeJson(d, resp)) { Serial.println("[DOOR] JSON tidak valid"); return; }
    applyDoorCommand(0, d["lock_status"] | "");
    return;
  }
  if (code != 200) { Serial.printf("[DOOR] GET gagal, code=%d\n", code); return; }

  JsonDocument doc;
  if (deserializeJson(doc, resp)) { Serial.println("[DOOR] JSON tidak valid"); return; }
  for (JsonObject d : doc["doors"].as<JsonArray>()) {
    int id = d["id"] | 0;
    if (id < 1 || id > NUM_DOORS) continue;
    applyDoorCommand(id - 1, d["lock_status"] | "");
  }
}

bool isAuthorized(const String& uid) {
  for (int i = 0; i < AUTH_COUNT; i++)
    if (uid.equalsIgnoreCase(AUTHORIZED_UIDS[i])) return true;
  return false;
}

void handleCard(int i, const String& uid) {
  Door& d = doors[i];
  Serial.printf("[DOOR%d] Kartu terbaca: %s\n", i + 1, uid.c_str());
  d.lastUid = uid;
  if (isAuthorized(uid)) {
    Serial.printf("[DOOR%d] >>> DIIZINKAN (UID terdaftar), pintu dibuka\n", i + 1);
    d.lastAlert = "DIIZINKAN";
    driveDoor(i, true);
    d.unlocked = true;
    d.byDashboard = false;
    d.unlockedAt = millis();
    beep(150);
    postDoorlock(i, uid, "UNLOCKED", "DIIZINKAN");
  } else {
    Serial.printf("[DOOR%d] >>> DITOLAK (UID %s tidak terdaftar)\n", i + 1, uid.c_str());
    d.lastAlert = "DITOLAK";
    driveDoor(i, false);
    d.unlocked = false;
    d.byDashboard = false;
    for (int k = 0; k < 3; k++) beep(120);
    postDoorlock(i, uid, "LOCKED", "DITOLAK");
  }
}

void checkAutoRelock() {
  for (int i = 0; i < NUM_DOORS; i++) {
    Door& d = doors[i];
    if (d.unlocked && !d.byDashboard && millis() - d.unlockedAt >= RELOCK_MS) {
      driveDoor(i, false);
      d.unlocked = false;
      d.lastAlert = "AMAN";
      Serial.printf("[DOOR%d] Auto-lock -> AMAN\n", i + 1);
      postDoorlock(i, d.lastUid, "LOCKED", "AMAN");
    }
  }
}

void setFan(bool on);
void taskThermostat();

// ================== MODE UJI MANUAL (Serial) ==================
#if OFFLINE_TEST
void printHelp() {
  Serial.println("=== PERINTAH UJI MANUAL (akhiri dengan Enter) ===");
  Serial.println("L1 ON | L1 OFF | L1 50   -> lampu 1 (juga L2, L3; angka = kecerahan 0-100)");
  Serial.println("BUKA | KUNCI            -> servo pintu (seperti perintah dari web)");
  Serial.println("<UID>                   -> simulasi kartu, contoh A1B2C3D4 (sah) / FFFFFFFF (ditolak)");
  Serial.println("BEL                     -> simulasi tombol bel (buzzer bunyi)");
  Serial.println("KIPAS ON | OFF | AUTO   -> kipas manual / otomatis");
  Serial.println("BATAS 30 28             -> ubah batas suhu ON/OFF kipas (untuk uji)");
  Serial.println("SUHU                    -> baca DHT22 sekarang");
  Serial.println("HELP                    -> tampilkan daftar ini");
}

bool handleTestCommand(const String& line) {
  if (line == "HELP" || line == "?") { printHelp(); return true; }

  if (line.length() >= 2 && line[0] == 'L' && line[1] >= '1' && line[1] <= '3') {
    int i = line[1] - '1';
    String arg = line.substring(2); arg.trim();
    if (arg == "ON")       { setLamp(i, true, 100); Serial.printf("[LAMP] L%d ON 100%%\n", i + 1); }
    else if (arg == "OFF") { setLamp(i, false, 0);  Serial.printf("[LAMP] L%d OFF\n", i + 1); }
    else if (arg.length() > 0 && arg[0] >= '0' && arg[0] <= '9') {
      int v = constrain(arg.toInt(), 0, 100);
      setLamp(i, v > 0, v); Serial.printf("[LAMP] L%d %d%%\n", i + 1, v);
    } else Serial.println("Contoh: L1 ON, L2 OFF, L3 50");
    return true;
  }

  if (line == "BUKA")  { applyDoorCommand(0, "UNLOCKED"); return true; }
  if (line == "KUNCI") { applyDoorCommand(0, "LOCKED");   return true; }
  if (line == "BEL")   { bellFlag = true; return true; }

  if (line == "KIPAS ON")   { fanOverride = 1; setFan(true);  Serial.println("[FAN] MANUAL ON");  return true; }
  if (line == "KIPAS OFF")  { fanOverride = 2; setFan(false); Serial.println("[FAN] MANUAL OFF"); return true; }
  if (line == "KIPAS AUTO") { fanOverride = 0; Serial.println("[FAN] AUTO (ikut suhu)"); taskThermostat(); return true; }

  if (line.startsWith("BATAS")) {
    float on = 0, off = 0;
    if (sscanf(line.c_str(), "BATAS %f %f", &on, &off) == 2 && on > off) {
      TEMP_ON_C = on; TEMP_OFF_C = off;
      Serial.printf("[FAN] batas diubah: ON > %.0f, OFF < %.0f\n", on, off);
    } else Serial.println("Contoh: BATAS 30 28 (angka pertama harus lebih besar)");
    return true;
  }

  if (line == "SUHU") { taskThermostat(); return true; }

  bool allHex = true;
  for (unsigned k = 0; k < line.length(); k++) {
    char c = line[k];
    if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F'))) { allHex = false; break; }
  }
  int n = line.length();
  if (allHex && (n == 8 || n == 14 || n == 20)) return false;
  Serial.printf("[?] '%s' bukan perintah dan bukan UID kartu. Ketik HELP.\n", line.c_str());
  return true;
}
#endif

void readRfid() {
#if USE_RFID_HW
  for (int i = 0; i < NUM_DOORS; i++) {
    if (!readerOk[i]) continue;
    MFRC522* r = readers[i];
    if (r->PICC_IsNewCardPresent() && r->PICC_ReadCardSerial()) {
      String uid = "";
      for (byte k = 0; k < r->uid.size; k++) {
        if (r->uid.uidByte[k] < 0x10) uid += "0";
        uid += String(r->uid.uidByte[k], HEX);
      }
      uid.toUpperCase();
      r->PICC_HaltA();
      handleCard(i, uid);
    }
  }
#endif
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim(); line.toUpperCase();
    if (line.length() > 0) {
#if OFFLINE_TEST
      if (handleTestCommand(line)) return;
#endif
      handleCard(0, line);
    }
  }
}

// ================== BEL PINTU DEPAN ==================
void postDoorbell() {
#if OFFLINE_TEST
  return;
#endif
  String resp;
  int code = sendHttp(true, "/api/doorbell", "{\"bell_pressed\":true}", resp);
  Serial.printf("[BELL] POST -> code=%d\n", code);
}

void checkDoorbell() {
  if (bellFlag) {
    bellFlag = false;
    Serial.println("[BELL] Tombol ditekan");
    beep(200);
    beep(300);
    postDoorbell();
  }
}

// ================== SMART THERMOSTAT ==================
void setFan(bool on) {
#if FAN_ACTIVE_HIGH
  digitalWrite(PIN_FAN, on ? HIGH : LOW);
#else
  digitalWrite(PIN_FAN, on ? LOW : HIGH);
#endif
}

void taskThermostat() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) {
    Serial.println("[THERMO] Gagal baca DHT (cek kabel DATA ke GPIO 4 dan jenis sensor DHT22/DHT11)");
    return;
  }
  t = round(t * 10.0f) / 10.0f;
  h = round(h * 10.0f) / 10.0f;

#if LOCAL_AUTO_FAN
  if (t > TEMP_ON_C) localFanOn = true;
  else if (t < TEMP_OFF_C) localFanOn = false;
#endif

  JsonDocument doc;
  doc["temperature"] = t;
  doc["humidity"] = h;
  String body; serializeJson(doc, body);
  String resp;
  int code = sendHttp(true, "/api/thermostat", body, resp);
  if (code == 200) {
    JsonDocument r;
    if (!deserializeJson(r, resp)) {
      const char* fs = r["fan_status"] | "OFF";
      serverFanOn = (strcmp(fs, "ON") == 0);
    }
  }

  bool fanOn = serverFanOn || localFanOn;
  if (fanOverride == 1) fanOn = true;
  if (fanOverride == 2) fanOn = false;
  setFan(fanOn);
#if OFFLINE_TEST
  Serial.printf("[THERMO] suhu=%.1f lembap=%.1f batas=%.0f/%.0f mode=%s KIPAS=%s\n",
                t, h, TEMP_ON_C, TEMP_OFF_C, fanOverride == 0 ? "AUTO" : (fanOverride == 1 ? "MANUAL-ON" : "MANUAL-OFF"), fanOn ? "ON" : "OFF");
#else
  Serial.printf("[THERMO] suhu=%.1f lembap=%.1f server_fan=%s KIPAS=%s code=%d\n",
                t, h, serverFanOn ? "ON" : "OFF", fanOn ? "ON" : "OFF", code);
#endif
}

// ================== WATER MONITOR (ULTRASONIK) ==================
#if ENABLE_WATER
float readDistanceCm() {
  float s[3];
  int n = 0;
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_TRIG, LOW);  delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);
    unsigned long d = pulseIn(PIN_ECHO, HIGH, 30000UL);
    if (d > 0) s[n++] = d * 0.0343f / 2.0f;
    delay(40);
  }
  if (n == 0) return -1;
  for (int i = 1; i < n; i++) {
    float key = s[i]; int j = i - 1;
    while (j >= 0 && s[j] > key) { s[j + 1] = s[j]; j--; }
    s[j + 1] = key;
  }
  return s[n / 2];
}

void taskWater() {
  float dist = readDistanceCm();
  if (dist < 0) {
    Serial.println("[WATER] Tidak ada gema (cek kabel, daya, atau tegangan Echo)");
    return;
  }
  if (dist < 2.0) {
    Serial.println("[WATER] Jarak di luar jangkauan (<2 cm), bacaan diabaikan");
    return;
  }
  int level = constrain((int)round(dist), 0, 100);
  const char* cat = (dist >= WATER_CRITICAL_CM) ? "RENDAH" : (dist <= WATER_FULL_CM ? "PENUH" : "NORMAL");

  JsonDocument doc;
  doc["level_value"] = level;
  doc["category"] = cat;
  String body; serializeJson(doc, body);
  String resp;
  int code = sendHttp(true, "/api/water", body, resp);
  Serial.printf("[WATER] jarak=%.1f cm level_value=%d category=%s%s code=%d\n",
                dist, level, cat, dist >= WATER_CRITICAL_CM ? " (KRITIS)" : "", code);
}
#endif

// ================== PENJADWAL TUGAS JARINGAN ==================
struct Task { void (*fn)(); unsigned long interval; unsigned long nextDue; };
Task tasks[] = {
#if !OFFLINE_TEST
  { pollLamps,      1000, 0 },
  { pollDoors,      1000, 0 },
#endif
  { taskThermostat, 3000, 0 },
#if ENABLE_WATER
  { taskWater,      3000, 0 },
#endif
};
const int NUM_TASKS = sizeof(tasks) / sizeof(tasks[0]);
int lastTask = -1;

void runNextTask() {
  unsigned long now = millis();
  for (int k = 1; k <= NUM_TASKS; k++) {
    int i = (lastTask + k) % NUM_TASKS;
    if ((long)(now - tasks[i].nextDue) >= 0) {
      lastTask = i;
      tasks[i].fn();
      tasks[i].nextDue = millis() + tasks[i].interval;
      return;
    }
  }
}

// ================== SETUP & LOOP ==================
void setup() {
  Serial.begin(115200);

  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);

  pinMode(PIN_BELL, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_BELL), onBell, FALLING);

  pinMode(PIN_FAN, OUTPUT);
  setFan(false);
  dht.begin();

#if ENABLE_WATER
  pinMode(PIN_TRIG, OUTPUT);
  digitalWrite(PIN_TRIG, LOW);
  pinMode(PIN_ECHO, INPUT);
#endif

  // Servo dulu, supaya timernya dipesan sebelum LED
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  for (int i = 0; i < NUM_DOORS; i++) {
    doors[i].servo.setPeriodHertz(50);
    doors[i].servo.attach(DOOR_SERVO_PINS[i], 500, 2400);
    doors[i].servo.write(SERVO_LOCK_ANGLE);
  }

  // Lampu di channel terpisah dari servo
  for (int i = 0; i < NUM_LAMPS; i++) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttachChannel(LAMP_PINS[i], 5000, 8, LAMP_CHANNELS[i]);
#else
    ledcSetup(LAMP_CHANNELS[i], 5000, 8);
    ledcAttachPin(LAMP_PINS[i], LAMP_CHANNELS[i]);
#endif
    setLamp(i, false, 0);
  }

#if USE_RFID_HW
  pinMode(PIN_RC_RST, OUTPUT);
  digitalWrite(PIN_RC_RST, LOW);
  delay(10);
  digitalWrite(PIN_RC_RST, HIGH);
  delay(60);
  SPI.begin(PIN_RC_SCK, PIN_RC_MISO, PIN_RC_MOSI, -1);
  for (int i = 0; i < NUM_DOORS; i++) {
    readers[i]->PCD_Init();
    delay(50);
    byte v = readers[i]->PCD_ReadRegister(MFRC522::VersionReg);
    readerOk[i] = (v != 0x00 && v != 0xFF);
    Serial.printf("[RFID%d] versi=0x%02X %s\n", i + 1, v,
                  readerOk[i] ? "terdeteksi" : "TIDAK TERDETEKSI (cek kabel / modul belum dipasang)");
  }
#else
  Serial.println("Mode simulasi RFID");
#endif
  Serial.println("Uji kartu lewat Serial: ketik UID, contoh 'A1B2C3D4'");

#if OFFLINE_TEST
  Serial.println("*** MODE UJI MANUAL: WiFi & server tidak dipakai ***");
  printHelp();
#else
  connectWiFi();
#endif

  unsigned long now = millis();
  for (int i = 0; i < NUM_TASKS; i++) tasks[i].nextDue = now + 500UL * (i + 1);
}

void loop() {
#if !OFFLINE_TEST
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
#endif

  checkDoorbell();
  readRfid();
  checkAutoRelock();
  runNextTask();
}