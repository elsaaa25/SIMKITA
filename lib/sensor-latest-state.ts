import "server-only"
import { db } from "@/lib/db"

let initializationPromise: Promise<boolean> | null = null

async function initializeSensorLatestState(): Promise<boolean> {
  const client = await db.connect()

  try {
    await client.query("BEGIN")
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('simkita_sensor_latest_state_v1'))",
    )

    await client.query(`
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
      )
    `)

    await client.query(`
      CREATE INDEX IF NOT EXISTS sensor_latest_state_last_seen_idx
        ON sensor_latest_state (last_seen DESC)
    `)

    await client.query(`
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
      ON CONFLICT (sensor_id) DO NOTHING
    `)

    await client.query(`
      UPDATE monitoring_settings
      SET offline_timeout = 60,
          updated_at = NOW()
      WHERE id = 'global'
        AND offline_timeout <> 60
    `)

    await client.query("COMMIT")
    return true
  } catch (error) {
    await client.query("ROLLBACK")
    console.error(
      "Inisialisasi sensor_latest_state gagal; memakai penyimpanan kompatibilitas:",
      error,
    )
    return false
  } finally {
    client.release()
  }
}

export function ensureSensorLatestState(): Promise<boolean> {
  if (!initializationPromise) {
    initializationPromise = initializeSensorLatestState()
  }

  return initializationPromise
}
