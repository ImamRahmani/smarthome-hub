-- database/init.sql
CREATE DATABASE IF NOT EXISTS smarthome_db;
USE smarthome_db;

CREATE TABLE IF NOT EXISTS device_states (
  device_id VARCHAR(50) PRIMARY KEY,
  state_json JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS security_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  identifier VARCHAR(100) NOT NULL,
  status VARCHAR(255) NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telemetry_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(50) NOT NULL,
  metric_name VARCHAR(50) NOT NULL,
  metric_value DOUBLE NOT NULL,
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed data awal (sinkron dengan node1.4.ino, ESP32-CAM, dan dashboard)
INSERT IGNORE INTO device_states (device_id, state_json) VALUES
('lamps',      '[{"id":1,"status":"OFF","intensity":0,"updated_at":"-"},{"id":2,"status":"OFF","intensity":0,"updated_at":"-"},{"id":3,"status":"OFF","intensity":0,"updated_at":"-"}]'),
('doors',      '[{"id":1,"name":"Pintu lab","lock_status":"LOCKED","last_uid":"-","access_alert":"AMAN","updated_at":"-"}]'),
('doorbell',   '{"bell_pressed":false,"last_ring_time":"-","updated_at":"-"}'),
('thermostat', '{"temperature":25.0,"humidity":60,"fan_status":"OFF","mode":"AUTO","auto_on":32,"auto_off":30,"updated_at":"-"}'),
('camera',     '{"active":false,"has_frame":false,"updated_at":"-"}'),
('water',      '{"level_value":85,"category":"AMAN","critical":false,"updated_at":"-"}');

INSERT INTO security_logs (event_type, identifier, status)
VALUES ('SISTEM', 'Server Smart IoT', 'Backend Terpadu & MySQL Siap');