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

-- Seed data awal agar endpoint /api/* tidak crash (HTTP 500) saat start pertama
INSERT IGNORE INTO device_states (device_id, state_json) VALUES
('lighting',   '{"status":"OFF","intensity":0,"updated_at":"-"}'),
('doorlock',   '{"lock_status":"LOCKED","last_uid":"-","access_alert":"AMAN","updated_at":"-"}'),
('doorbell',   '{"bell_pressed":false,"last_ring_time":"-","updated_at":"-"}'),
('thermostat', '{"temperature":25.0,"humidity":60,"fan_status":"OFF","updated_at":"-"}'),
('water',      '{"level_value":85,"category":"AMAN","updated_at":"-"}');

INSERT INTO security_logs (event_type, identifier, status)
VALUES ('SYSTEM', 'Docker Hub', 'Database & Server Siap');