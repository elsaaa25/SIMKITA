const SAMPLE_INTERVAL_MS = 15_000

export type SensorCsvInputItem = {
  recordedAt: string | Date | number
  sensorId?: string
  temperature?: number | string | null
  temperatureL4?: number | string | null
  temperatureL5?: number | string | null
  voltage?: number | string | null
  current?: number | string | null
}

type MeasurementBucket = {
  timestamp: number
  temperatureL4: number | null
  temperatureL5: number | null
  voltage: number | null
}

export function formatWibDateTime(dateInput: Date | number | string): string {
  const date = new Date(dateInput)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const values: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value
    }
  }

  return (
    `${values.year}-${values.month}-${values.day} ` +
    `${values.hour}:${values.minute}:${values.second}`
  )
}

function toValidNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

export function generateSensorCsv(items: SensorCsvInputItem[]): string {
  if (!items.length) {
    return ""
  }

  // Urutkan berdasarkan waktu kronologis (terlama ke terbaru)
  const sorted = [...items].sort((a, b) => {
    const timeA = new Date(a.recordedAt).getTime()
    const timeB = new Date(b.recordedAt).getTime()
    return timeA - timeB
  })

  const buckets: MeasurementBucket[] = []
  let currentBucket: MeasurementBucket | null = null

  for (const item of sorted) {
    const timestamp = new Date(item.recordedAt).getTime()
    if (Number.isNaN(timestamp)) {
      continue
    }

    // Kelompokkan dalam interval 15 detik (sama seperti cron ekspor bulanan otomatis)
    const bucketTime =
      Math.floor(timestamp / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS

    if (currentBucket && currentBucket.timestamp !== bucketTime) {
      buckets.push(currentBucket)
      currentBucket = null
    }

    if (!currentBucket) {
      currentBucket = {
        timestamp: bucketTime,
        temperatureL4: null,
        temperatureL5: null,
        voltage: null,
      }
    }

    const sensorId = item.sensorId?.trim().toUpperCase()

    // Penentuan Suhu L4 & L5
    if (sensorId === "TEMP-L5") {
      const temp = toValidNumber(item.temperature ?? item.temperatureL5)
      if (temp !== null) currentBucket.temperatureL5 = temp
    } else if (sensorId === "TEMP-L4") {
      const temp = toValidNumber(item.temperature ?? item.temperatureL4)
      if (temp !== null) currentBucket.temperatureL4 = temp
    } else {
      // Jika item sudah memiliki property terpisah (misalnya dari halaman grafik)
      const t4 = toValidNumber(item.temperatureL4)
      if (t4 !== null) currentBucket.temperatureL4 = t4

      const t5 = toValidNumber(item.temperatureL5)
      if (t5 !== null) currentBucket.temperatureL5 = t5

      if (t4 === null && t5 === null) {
        const rawTemp = toValidNumber(item.temperature)
        if (rawTemp !== null) {
          currentBucket.temperatureL4 = rawTemp
        }
      }
    }

    // Tegangan
    const voltage = toValidNumber(item.voltage)
    if (voltage !== null) {
      currentBucket.voltage = voltage
    }
  }

  if (currentBucket) {
    buckets.push(currentBucket)
  }

  // Format 5 kolom persis seperti file laporan otomatis:
  // No., Tanggal dan Waktu (WIB), Suhu Lantai 4 (°C), Suhu Lantai 5 (°C), Tegangan (V)
  const headers = [
    "No.",
    "Tanggal dan Waktu (WIB)",
    "Suhu Lantai 4 (°C)",
    "Suhu Lantai 5 (°C)",
    "Tegangan (V)",
  ].join(",")

  const rows = buckets.map((bucket, index) => {
    const no = index + 1
    const timeFormatted = `"${formatWibDateTime(bucket.timestamp)}"`
    const tempL4 =
      bucket.temperatureL4 !== null ? bucket.temperatureL4.toFixed(2) : ""
    const tempL5 =
      bucket.temperatureL5 !== null ? bucket.temperatureL5.toFixed(2) : ""
    const voltage =
      bucket.voltage !== null ? bucket.voltage.toFixed(2) : ""

    return `${no},${timeFormatted},${tempL4},${tempL5},${voltage}`
  })

  return [headers, ...rows].join("\n")
}

export function downloadCsv(filename: string, csvContent: string): void {
  const utf8BOM = "\uFEFF"
  const blob = new Blob(
    [csvContent.startsWith(utf8BOM) ? csvContent : utf8BOM + csvContent],
    {
      type: "text/csv;charset=utf-8;",
    },
  )

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
