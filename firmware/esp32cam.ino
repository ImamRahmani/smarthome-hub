/*
  ESP32-CAM (AI Thinker) - kamera Video Doorbell
  GET  /api/camera        -> {"active":true|false}
  POST /api/camera/frame  (body JPEG, Content-Type: image/jpeg) -> {"active":true|false}

  Arduino IDE: Board = AI Thinker ESP32-CAM, Partition Scheme = Huge APP, PSRAM = Enabled
  Library: ArduinoJson (esp_camera sudah bawaan board)
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"

const char* WIFI_SSID = "WLC_CNAP";
const char* WIFI_PASS = "s4y4b1s4";
const char* SERVER_BASE = "https://smarthome-7ocnz8wld-imams-projects-2e4fc7f5.vercel.app";

// Pin kamera AI Thinker ESP32-CAM
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

const unsigned long IDLE_POLL_MS = 1500;
bool camActive = false;
bool camReady = false;   // true = kamera sedang menyala (hanya saat aktif, supaya tidak FB-OVF saat standby)
unsigned long lastIdlePoll = 0;

WiFiClientSecure secureClient;   // dipakai ulang supaya tidak handshake tiap frame

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
#else
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
#endif
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_QVGA;   // 320x240, ringan dikirim lewat internet
  config.jpeg_quality = 12;             // 10 = bagus tapi besar, 15 = lebih kecil
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init gagal 0x%x (cek kabel pita kamera / PSRAM)\n", err);
    return false;
  }
  return true;
}

void connectWiFi() {
  Serial.print("Menghubungkan WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) { delay(250); Serial.print("."); tries++; }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK" : " GAGAL");
}

bool pollActive() {
  HTTPClient http;
  http.begin(secureClient, String(SERVER_BASE) + "/api/camera");
  http.setTimeout(5000);
  int code = http.GET();
  bool active = camActive;
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) active = doc["active"] | false;
  } else {
    Serial.printf("[CAM] GET gagal, code=%d\n", code);
  }
  http.end();
  return active;
}

// Kirim 1 frame. Mengembalikan false kalau server minta berhenti.
bool sendFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { Serial.println("[CAM] Gagal ambil gambar"); return true; }

  HTTPClient http;
  http.begin(secureClient, String(SERVER_BASE) + "/api/camera/frame");
  http.setReuse(true);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "image/jpeg");
  int code = http.POST(fb->buf, fb->len);
  bool keepGoing = true;
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) keepGoing = doc["active"] | false;
    Serial.printf("[CAM] frame %u byte terkirim\n", (unsigned)fb->len);
  } else {
    Serial.printf("[CAM] POST frame gagal, code=%d\n", code);
  }
  http.end();
  esp_camera_fb_return(fb);
  return keepGoing;
}

void stopCamera() {
  if (camReady) { esp_camera_deinit(); camReady = false; }
}

void setup() {
  Serial.begin(115200);
  // Tes kamera sekali saat boot, lalu matikan lagi (standby tanpa menumpuk frame)
  if (!initCamera()) { delay(3000); ESP.restart(); }
  camReady = true;   // kamera sedang menyala, supaya stopCamera() benar-benar mematikannya
  Serial.println("[CAM] Kamera terbaca, standby");
  stopCamera();
  connectWiFi();
  secureClient.setInsecure();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();

  if (camActive) {
    if (!camReady) {
      camReady = initCamera();
      if (!camReady) { Serial.println("[CAM] Gagal menyalakan kamera, coba lagi"); delay(2000); return; }
    }
    if (!sendFrame()) {
      camActive = false;
      stopCamera();
      Serial.println("[CAM] Dimatikan dari dashboard, standby");
    }
  } else if (millis() - lastIdlePoll >= IDLE_POLL_MS) {
    lastIdlePoll = millis();
    camActive = pollActive();
    if (camActive) Serial.println("[CAM] Aktif, mulai kirim gambar");
  }
}
