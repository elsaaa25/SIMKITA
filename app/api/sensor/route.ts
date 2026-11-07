import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { sendEmail } from "@/lib/email"

export const runtime = "nodejs"

const readingSchema = z.object({
  sensorId: z.enum([
    "TEMP-L4",
    "TEMP-L5",
  ]),

  temperature: z
    .number()
    .finite()
    .min(-40)
    .max(100),

  voltage: z
    .number()
    .finite()
    .min(0)
    .max(300)
    .optional(),

  current: z
    .number()
    .finite()
    .min(0)
    .max(999)
    .optional(),
})

type AlertLevel = "Waspada" | "Bahaya"

type VoltageAnomalyType = "Drop" | "Surge"

type OpenAlert = {
  id: number
  level: AlertLevel
  status: "Aktif" | "Ditangani"
  createdAt: Date
  resolvedAt: Date | null
}

type OpenVoltageAlert = {
  id: number
  anomalyType: VoltageAnomalyType
  level: AlertLevel
  status: "Aktif" | "Ditangani"
  createdAt: Date
  resolvedAt: Date | null
}

type DbSettings = {
  warningTemperature: number
  dangerTemperature: number
  warningTemperatureL5: number
  dangerTemperatureL5: number
  voltageMin: number
  voltageMax: number
}

type SensorState = {
  historyTemperature: number | string | null
  lastHistoryAt: Date | string | null
  temperatureStatus: string
  voltageStatus: string
}

const TEMPERATURE_CHANGE_THRESHOLD = 0.2
const HISTORY_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

// Default threshold jika tabel monitoring_settings kosong
const DEFAULT_SETTINGS: DbSettings = {
  warningTemperature: 27,
  dangerTemperature: 30,
  warningTemperatureL5: 27,
  dangerTemperatureL5: 30,
  voltageMin: 200,
  voltageMax: 240,
}

function getSensorLocation(sensorId: string): string {
  if (sensorId === "TEMP-L4") return "Lantai 4 (Ruang Server)"
  if (sensorId === "TEMP-L5") return "Lantai 5 (Ruang ATC)"
  return sensorId
}

function getAlertLevel(
  temperature: number,
  warningTemperature: number,
  dangerTemperature: number,
): AlertLevel | null {
  if (temperature >= dangerTemperature) return "Bahaya"
  if (temperature >= warningTemperature) return "Waspada"
  return null
}

function getAlertContent(
  sensorId: string,
  level: AlertLevel,
  temperature: number,
  warningTemperature: number,
  dangerTemperature: number,
) {
  const location = getSensorLocation(sensorId)

  if (level === "Bahaya") {
    return {
      title: `Suhu ${location} berada pada level bahaya`,
      detail:
        `Suhu ${temperature.toFixed(2)}°C ` +
        `telah mencapai atau melewati batas bahaya ` +
        `${dangerTemperature.toFixed(2)}°C. ` +
        `Segera periksa AC dan kondisi ruangan.`,
    }
  }

  return {
    title: `Suhu ${location} berada pada level waspada`,
    detail:
      `Suhu ${temperature.toFixed(2)}°C ` +
      `telah melewati batas waspada ` +
      `${warningTemperature.toFixed(2)}°C. ` +
      `Periksa pendingin dan sirkulasi udara.`,
  }
}

function getVoltageAnomalyType(
  voltage: number,
  voltageMin: number,
  voltageMax: number,
): VoltageAnomalyType | null {
  if (voltage < voltageMin) return "Drop"
  if (voltage > voltageMax) return "Surge"
  return null
}

function getVoltageAlertContent(
  sensorId: string,
  anomalyType: VoltageAnomalyType,
  voltage: number,
  voltageMin: number,
  voltageMax: number,
) {
  const location = getSensorLocation(sensorId)

  if (anomalyType === "Drop") {
    return {
      title: `Tegangan Drop di ${location}`,
      detail:
        `Tegangan terdeteksi ${voltage.toFixed(1)} V, ` +
        `di bawah batas minimum ${voltageMin.toFixed(1)} V. ` +
        `Periksa sumber listrik dan stabilizer.`,
    }
  }

  return {
    title: `Tegangan Surge di ${location}`,
    detail:
      `Tegangan terdeteksi ${voltage.toFixed(1)} V, ` +
      `melebihi batas maksimum ${voltageMax.toFixed(1)} V. ` +
      `Segera periksa UPS dan jalur listrik.`,
  }
}

// Ambil semua email pengguna aktif untuk notifikasi
async function getRecipientEmails(): Promise<string[]> {
  try {
    const result = await db.query<{ email: string }>(
      `SELECT email FROM users WHERE is_active = TRUE ORDER BY created_at ASC`,
    )
    return result.rows.map((r) => r.email)
  } catch {
    return []
  }
}

// Ambil threshold dari database, fallback ke default jika gagal
async function getSettings(): Promise<DbSettings> {
  try {
    const result = await db.query<DbSettings>(
      `SELECT
        warning_temperature::float8   AS "warningTemperature",
        danger_temperature::float8    AS "dangerTemperature",
        warning_temperature_l5::float8 AS "warningTemperatureL5",
        danger_temperature_l5::float8  AS "dangerTemperatureL5",
        voltage_min::float8           AS "voltageMin",
        voltage_max::float8           AS "voltageMax"
       FROM monitoring_settings
       WHERE id = 'global'
       LIMIT 1`,
    )
    if (result.rows.length === 0) return DEFAULT_SETTINGS
    return result.rows[0]
  } catch (err) {
    console.error("Gagal mengambil monitoring_settings, pakai default:", err)
    return DEFAULT_SETTINGS
  }
}

// ============================================================
// Logika alert suhu — buat / eskalasi / resolve
// ============================================================

async function handleTemperatureAlert(
  sensorId: string,
  readingId: number | null,
  temperature: number,
  warningTemp: number,
  dangerTemp: number,
): Promise<void> {
  const newLevel = getAlertLevel(temperature, warningTemp, dangerTemp)

  // Cari alert aktif yang ada untuk sensor ini
  const existingResult = await db.query<OpenAlert>(
    `SELECT id, level, status, created_at AS "createdAt", resolved_at AS "resolvedAt"
     FROM temperature_alerts
     WHERE sensor_id = $1 AND status = 'Aktif'
     LIMIT 1`,
    [sensorId],
  )
  const existing = existingResult.rows[0] ?? null

  // Suhu normal — resolve alert aktif jika ada
  if (!newLevel) {
    if (existing) {
      await db.query(
        `UPDATE temperature_alerts
         SET status = 'Ditangani', resolved_at = NOW()
         WHERE id = $1`,
        [existing.id],
      )
      console.log(`[Alert Suhu] Resolved alert #${existing.id} (${sensorId}) — suhu kembali normal`)
    }
    return
  }

  // Suhu di atas batas — buat alert baru jika belum ada
  if (!existing) {
    const content = getAlertContent(sensorId, newLevel, temperature, warningTemp, dangerTemp)

    await db.query(
      `INSERT INTO temperature_alerts
         (reading_id, sensor_id, level, status, temperature, title, detail, created_at)
       VALUES ($1, $2, $3, 'Aktif', $4, $5, $6, NOW())`,
      [readingId, sensorId, newLevel, temperature, content.title, content.detail],
    )
    console.log(`[Alert Suhu] Dibuat alert ${newLevel} untuk ${sensorId} (${temperature}°C)`)

    // Kirim email notifikasi
    void sendAlertEmail(content.title, content.detail).catch((err) =>
      console.error("[Alert Suhu] Gagal kirim email:", err),
    )
    return
  }

  // Alert sudah ada — eskalasi jika naik dari Waspada ke Bahaya
  if (existing.level === "Waspada" && newLevel === "Bahaya") {
    const content = getAlertContent(sensorId, newLevel, temperature, warningTemp, dangerTemp)

    await db.query(
      `UPDATE temperature_alerts
       SET level = $1, temperature = $2, title = $3, detail = $4, reading_id = $5
       WHERE id = $6`,
      [newLevel, temperature, content.title, content.detail, readingId, existing.id],
    )
    console.log(`[Alert Suhu] Eskalasi alert #${existing.id} (${sensorId}) ke Bahaya`)

    void sendAlertEmail(content.title, content.detail).catch((err) =>
      console.error("[Alert Suhu] Gagal kirim email eskalasi:", err),
    )
  }
  // Level sama atau turun — tidak perlu tindakan
}

// ============================================================
// Logika alert tegangan — buat / resolve
// ============================================================

async function handleVoltageAlert(
  sensorId: string,
  readingId: number | null,
  voltage: number,
  voltageMin: number,
  voltageMax: number,
): Promise<void> {
  const anomalyType = getVoltageAnomalyType(voltage, voltageMin, voltageMax)

  // Cari voltage alert aktif
  const existingResult = await db.query<OpenVoltageAlert>(
    `SELECT id, anomaly_type AS "anomalyType", level, status,
            created_at AS "createdAt", resolved_at AS "resolvedAt"
     FROM voltage_alerts
     WHERE sensor_id = $1 AND status = 'Aktif'
     LIMIT 1`,
    [sensorId],
  )
  const existing = existingResult.rows[0] ?? null

  // Tegangan normal — resolve alert aktif jika ada
  if (!anomalyType) {
    if (existing) {
      await db.query(
        `UPDATE voltage_alerts
         SET status = 'Ditangani', resolved_at = NOW()
         WHERE id = $1`,
        [existing.id],
      )
      console.log(`[Alert Tegangan] Resolved alert #${existing.id} (${sensorId}) — tegangan normal`)
    }
    return
  }

  // Ada anomali dan belum ada alert aktif — buat baru
  if (!existing) {
    const content = getVoltageAlertContent(sensorId, anomalyType, voltage, voltageMin, voltageMax)
    // Waspada jika deviasi kecil, Bahaya jika > 10% dari batas
    const deviation =
      anomalyType === "Drop"
        ? ((voltageMin - voltage) / voltageMin) * 100
        : ((voltage - voltageMax) / voltageMax) * 100
    const level: AlertLevel = deviation > 10 ? "Bahaya" : "Waspada"

    await db.query(
      `INSERT INTO voltage_alerts
         (reading_id, sensor_id, anomaly_type, level, status, voltage, title, detail, created_at)
       VALUES ($1, $2, $3, $4, 'Aktif', $5, $6, $7, NOW())`,
      [readingId, sensorId, anomalyType, level, voltage, content.title, content.detail],
    )
    console.log(`[Alert Tegangan] Dibuat alert ${anomalyType} ${level} untuk ${sensorId} (${voltage} V)`)

    void sendAlertEmail(content.title, content.detail).catch((err) =>
      console.error("[Alert Tegangan] Gagal kirim email:", err),
    )
  }
  // Sudah ada alert aktif — tidak buat duplikat
}

// ============================================================
// Kirim email ke semua pengguna aktif
// ============================================================

async function sendAlertEmail(subject: string, detail: string): Promise<void> {
  const emails = await getRecipientEmails()
  if (emails.length === 0) {
    console.warn("[Email] Tidak ada penerima email aktif.")
    return
  }

  const appUrl = process.env.APP_URL ?? ""
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto">
      <div style="background:#dc2626;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">⚠️ ${subject}</h2>
      </div>
      <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e5e5;border-top:none">
        <p style="margin:0 0 16px;color:#374151;font-size:15px">${detail}</p>
        ${
          appUrl
            ? `<a href="${appUrl}/alerts"
                 style="display:inline-block;background:#dc2626;color:#fff;padding:10px 20px;
                        border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">
                 Lihat Dashboard
               </a>`
            : ""
        }
        <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">
          Pesan ini dikirim otomatis oleh Sistem Monitoring Ruang Server.
        </p>
      </div>
    </div>
  `

  await sendEmail({ to: emails, subject, html })
  console.log(`[Email] Terkirim ke ${emails.length} penerima: "${subject}"`)
}

// ============================================================
// POST Handler — Menerima data dari ESP32
// ============================================================

export async function POST(request: Request) {
  try {
    // 1. Validasi API Key
    const sensorApiKey = process.env.SENSOR_API_KEY

    if (!sensorApiKey) {
      console.error("SENSOR_API_KEY belum tersedia.")
      return NextResponse.json(
        { success: false, error: "Konfigurasi server belum lengkap" },
        { status: 500 },
      )
    }

    const authorization = request.headers.get("authorization")

    if (authorization !== `Bearer ${sensorApiKey}`) {
      return NextResponse.json(
        { success: false, error: "Perangkat tidak diizinkan" },
        { status: 401 },
      )
    }

    // 2. Parse JSON Body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: "JSON tidak valid" },
        { status: 400 },
      )
    }

    // 3. Validasi Schema
    const result = readingSchema.safeParse(body)
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: "Data tidak valid", details: result.error.format() },
        { status: 400 },
      )
    }

    const { sensorId, temperature, voltage, current } = result.data

    // 4. Ambil threshold sebelum menentukan perubahan status.
    const settings = await getSettings()

    const warningTemp =
      sensorId === "TEMP-L5"
        ? settings.warningTemperatureL5
        : settings.warningTemperature

    const dangerTemp =
      sensorId === "TEMP-L5"
        ? settings.dangerTemperatureL5
        : settings.dangerTemperature

    const temperatureStatus =
      getAlertLevel(
        temperature,
        warningTemp,
        dangerTemp,
      ) ?? "Normal"

    const voltageStatus =
      sensorId === "TEMP-L4" &&
      typeof voltage === "number"
        ? getVoltageAnomalyType(
            voltage,
            settings.voltageMin,
            settings.voltageMax,
          ) ?? "Normal"
        : "Unavailable"

    // 5. Selalu perbarui heartbeat/latest-state. Riwayat hanya
    //    ditambah saat ada perubahan penting atau snapshot 5 menit.
    const client = await db.connect()
    let readingId: number | null = null
    let stored = false
    const storageReasons: string[] = []

    try {
      await client.query("BEGIN")

      await client.query(
        `INSERT INTO sensor_latest_state
           (sensor_id, temperature, voltage, current, last_seen,
            temperature_status, voltage_status, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), $5, $6, NOW())
         ON CONFLICT (sensor_id) DO NOTHING`,
        [
          sensorId,
          temperature,
          voltage ?? null,
          current ?? null,
          temperatureStatus,
          voltageStatus,
        ],
      )

      const stateResult = await client.query<SensorState>(
        `SELECT
           history_temperature AS "historyTemperature",
           last_history_at AS "lastHistoryAt",
           temperature_status AS "temperatureStatus",
           voltage_status AS "voltageStatus"
         FROM sensor_latest_state
         WHERE sensor_id = $1
         FOR UPDATE`,
        [sensorId],
      )

      const state = stateResult.rows[0]
      const historyTemperature =
        state.historyTemperature === null
          ? null
          : Number(state.historyTemperature)
      const lastHistoryAt = state.lastHistoryAt
        ? new Date(state.lastHistoryAt).getTime()
        : null

      if (
        historyTemperature === null ||
        lastHistoryAt === null
      ) {
        storageReasons.push("first-reading")
      } else {
        if (
          Math.abs(
            temperature - historyTemperature,
          ) >= TEMPERATURE_CHANGE_THRESHOLD
        ) {
          storageReasons.push("temperature-change")
        }

        if (
          state.temperatureStatus !==
          temperatureStatus
        ) {
          storageReasons.push("temperature-status")
        }

        if (
          state.voltageStatus !== voltageStatus
        ) {
          storageReasons.push("voltage-status")
        }

        if (
          Date.now() - lastHistoryAt >=
          HISTORY_SNAPSHOT_INTERVAL_MS
        ) {
          storageReasons.push("periodic-snapshot")
        }
      }

      stored = storageReasons.length > 0

      if (stored) {
        const insertResult =
          await client.query<{ id: number }>(
            `INSERT INTO sensor_readings
               (sensor_id, temperature, voltage, current, recorded_at)
             VALUES ($1, $2, $3, $4, NOW())
             RETURNING id`,
            [
              sensorId,
              temperature,
              voltage ?? null,
              current ?? null,
            ],
          )

        readingId = insertResult.rows[0].id
      }

      await client.query(
        `UPDATE sensor_latest_state
         SET temperature = $2,
             voltage = $3,
             current = $4,
             last_seen = NOW(),
             temperature_status = $5,
             voltage_status = $6,
             last_history_at = CASE WHEN $7 THEN NOW() ELSE last_history_at END,
             history_temperature = CASE WHEN $7 THEN $2 ELSE history_temperature END,
             history_voltage = CASE WHEN $7 THEN $3 ELSE history_voltage END,
             updated_at = NOW()
         WHERE sensor_id = $1`,
        [
          sensorId,
          temperature,
          voltage ?? null,
          current ?? null,
          temperatureStatus,
          voltageStatus,
          stored,
        ],
      )

      await client.query("COMMIT")
    } catch (storageError) {
      await client.query("ROLLBACK")
      throw storageError
    } finally {
      client.release()
    }

    console.log(
      stored
        ? `[Sensor] Riwayat disimpan: id=${readingId} sensorId=${sensorId} alasan=${storageReasons.join(",")}`
        : `[Sensor] Heartbeat diperbarui tanpa riwayat baru: sensorId=${sensorId}`,
    )

    // 6. Pencatatan alarm harus selesai sebelum response dikirim.
    //    Ini mencegah pekerjaan terputus setelah function Vercel selesai.
    const alertPromises: Promise<void>[] = [
      handleTemperatureAlert(sensorId, readingId, temperature, warningTemp, dangerTemp),
    ]

    // Alert tegangan hanya dari TEMP-L4 (yang punya sensor ZMPT101B)
    if (sensorId === "TEMP-L4" && typeof voltage === "number") {
      alertPromises.push(
        handleVoltageAlert(sensorId, readingId, voltage, settings.voltageMin, settings.voltageMax),
      )
    }

    await Promise.all(alertPromises)

    // 7. Response sukses ke ESP32
    return NextResponse.json({
      success: true,
      readingId,
      stored,
      storageReasons,
      message: stored
        ? "Data sensor disimpan sebagai riwayat"
        : "Heartbeat dan nilai terbaru berhasil diperbarui",
    })
  } catch (error) {
    console.error("Gagal menyimpan data sensor:", error)
    return NextResponse.json(
      { success: false, error: "Gagal menyimpan data sensor" },
      { status: 500 },
    )
  }
}
