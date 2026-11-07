-- Tabel untuk menyimpan konfigurasi pengaturan sistem secara global
CREATE TABLE IF NOT EXISTS monitoring_settings (
  id VARCHAR(20) PRIMARY KEY DEFAULT 'global',
  warning_temperature NUMERIC(4, 2) NOT NULL DEFAULT 27.00,
  danger_temperature NUMERIC(4, 2) NOT NULL DEFAULT 30.00,
  warning_temperature_l5 NUMERIC(4, 2) NOT NULL DEFAULT 27.00,
  danger_temperature_l5 NUMERIC(4, 2) NOT NULL DEFAULT 30.00,
  voltage_min NUMERIC(5, 2) NOT NULL DEFAULT 200.00,
  voltage_max NUMERIC(5, 2) NOT NULL DEFAULT 240.00,
  refresh_interval INT NOT NULL DEFAULT 4,
  offline_timeout INT NOT NULL DEFAULT 60,
  sensor_name VARCHAR(100) NOT NULL DEFAULT 'Sensor Ruang Server',
  sensor_id VARCHAR(50) NOT NULL DEFAULT 'esp32-01',
  browser_notification BOOLEAN NOT NULL DEFAULT TRUE,
  sound_alert BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Menyisipkan konfigurasi default jika tabel masih kosong
INSERT INTO monitoring_settings (
  id, warning_temperature, danger_temperature,
  warning_temperature_l5, danger_temperature_l5,
  voltage_min, voltage_max,
  refresh_interval, offline_timeout, sensor_name, sensor_id,
  browser_notification, sound_alert
)
VALUES (
  'global', 27.00, 30.00, 27.00, 30.00, 200.00, 240.00, 4, 
  60, 'Sensor Ruang Server', 'esp32-01', TRUE, FALSE
)
ON CONFLICT (id) DO NOTHING;
