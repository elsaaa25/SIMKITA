-- Jalankan satu kali melalui Supabase SQL Editor sebelum deploy kode terbaru.
-- Tidak menghapus atau mengubah data sensor_readings yang sudah ada.

CREATE TABLE IF NOT EXISTS sensor_latest_state (
  sensor_id                  VARCHAR(50)   PRIMARY KEY,
  temperature                NUMERIC(5, 2) NOT NULL,
  voltage                    NUMERIC(6, 2),
  current                    NUMERIC(6, 3),
  last_seen                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_history_at            TIMESTAMPTZ,
  history_temperature        NUMERIC(5, 2),
  history_voltage            NUMERIC(6, 2),
  temperature_status         VARCHAR(20)   NOT NULL DEFAULT 'Normal',
  voltage_status             VARCHAR(20)   NOT NULL DEFAULT 'Normal',
  updated_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sensor_latest_state_last_seen_idx
  ON sensor_latest_state (last_seen DESC);

-- Agar dashboard langsung mempunyai state awal sebelum paket ESP32 berikutnya.
INSERT INTO sensor_latest_state (
  sensor_id,
  temperature,
  voltage,
  current,
  last_seen,
  last_history_at,
  history_temperature,
  history_voltage,
  temperature_status,
  voltage_status,
  updated_at
)
SELECT DISTINCT ON (sensor_id)
  sensor_id,
  temperature,
  voltage,
  current,
  recorded_at,
  recorded_at,
  temperature,
  voltage,
  'Normal',
  CASE WHEN voltage IS NULL THEN 'Unavailable' ELSE 'Normal' END,
  NOW()
FROM sensor_readings
ORDER BY sensor_id, recorded_at DESC
ON CONFLICT (sensor_id) DO NOTHING;

-- Standar operasional: paket sekitar 15 detik, offline setelah 60 detik.
UPDATE monitoring_settings
SET offline_timeout = 60,
    updated_at = NOW()
WHERE id = 'global';
