import { Buffer } from "node:buffer"
import ExcelJS from "exceljs"

export type MonthlySensorReading = {
  id: number | string
  sensorId: string
  sensorName?: string | null
  metric: string
  value: number
  unit: string
  recordedAt: string | Date
}

export type MonthlyDatabaseReading = {
  id: number
  sensor_id: string
  temperature: string | number | null
  voltage: string | number | null
  current: string | number | null
  recorded_at: string | Date
}

type CreateMonthlyExcelOptions = {
  archiveMonth: string
  readings: MonthlySensorReading[]
}

type MeasurementRow = {
  timestamp: number
  temperatureL4: number | null
  temperatureL5: number | null
  voltage: number | null
  current: number | null
}

type NumberSummary = {
  count: number
  total: number
  minimum: number
  maximum: number
}

type DailySummary = {
  date: string
  sampleCount: number
  temperatureL4: NumberSummary
  temperatureL5: NumberSummary
  voltage: NumberSummary
  current: NumberSummary
}

const SAMPLE_INTERVAL_MS = 15_000

function parseDate(value: string | Date): Date {
  const date =
    value instanceof Date
      ? value
      : new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error(
      `Tanggal pembacaan tidak valid: ${String(value)}`,
    )
  }

  return date
}

function getWibDateParts(value: string | Date) {
  const date = parseDate(value)

  const parts = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    },
  ).formatToParts(date)

  const values: Record<string, string> = {}

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value
    }
  }

  const year = values.year
  const month = values.month
  const day = values.day
  const hour = values.hour
  const minute = values.minute
  const second = values.second

  if (
    !year ||
    !month ||
    !day ||
    !hour ||
    !minute ||
    !second
  ) {
    throw new Error(
      `Gagal memformat tanggal: ${date.toISOString()}`,
    )
  }

  return {
    date: `${year}-${month}-${day}`,
    dateTime:
      `${year}-${month}-${day} ` +
      `${hour}:${minute}:${second}`,
  }
}

function createEmptyMeasurementRow(
  timestamp: number,
): MeasurementRow {
  return {
    timestamp,
    temperatureL4: null,
    temperatureL5: null,
    voltage: null,
    current: null,
  }
}

function createEmptyNumberSummary(): NumberSummary {
  return {
    count: 0,
    total: 0,
    minimum: Number.POSITIVE_INFINITY,
    maximum: Number.NEGATIVE_INFINITY,
  }
}

function createEmptyDailySummary(
  date: string,
): DailySummary {
  return {
    date,
    sampleCount: 0,
    temperatureL4:
      createEmptyNumberSummary(),
    temperatureL5:
      createEmptyNumberSummary(),
    voltage: createEmptyNumberSummary(),
    current: createEmptyNumberSummary(),
  }
}

function addSummaryValue(
  summary: NumberSummary,
  value: number | null,
): void {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return
  }

  summary.count += 1
  summary.total += value
  summary.minimum = Math.min(
    summary.minimum,
    value,
  )
  summary.maximum = Math.max(
    summary.maximum,
    value,
  )
}

function getAverage(
  summary: NumberSummary,
): number | null {
  if (summary.count === 0) {
    return null
  }

  return summary.total / summary.count
}

function getMinimum(
  summary: NumberSummary,
): number | null {
  if (summary.count === 0) {
    return null
  }

  return summary.minimum
}

function getMaximum(
  summary: NumberSummary,
): number | null {
  if (summary.count === 0) {
    return null
  }

  return summary.maximum
}

/**
 * Membulatkan waktu ke interval 15 detik.
 *
 * Tujuannya agar pembacaan suhu, tegangan,
 * dan arus yang dikirim dalam waktu hampir
 * bersamaan berada pada satu baris Excel.
 */
function getTimeBucket(timestamp: number): number {
  return (
    Math.floor(
      timestamp / SAMPLE_INTERVAL_MS,
    ) * SAMPLE_INTERVAL_MS
  )
}

function insertReadingIntoRow(
  row: MeasurementRow,
  reading: MonthlySensorReading,
): void {
  const value = Number(reading.value)

  if (!Number.isFinite(value)) {
    return
  }

  const sensorId =
    reading.sensorId.trim().toUpperCase()

  const metric =
    reading.metric.trim().toLowerCase()

  if (
    sensorId === "TEMP-L4" ||
    metric.includes("suhu lantai 4")
  ) {
    row.temperatureL4 = value
    return
  }

  if (
    sensorId === "TEMP-L5" ||
    metric.includes("suhu lantai 5")
  ) {
    row.temperatureL5 = value
    return
  }

  if (
    sensorId === "VOLT-01" ||
    metric.includes("tegangan")
  ) {
    row.voltage = value
    return
  }

  if (
    sensorId === "CURRENT-01" ||
    metric.includes("arus")
  ) {
    row.current = value
  }
}

function createMeasurementRows(
  readings: MonthlySensorReading[],
): MeasurementRow[] {
  const groupedRows =
    new Map<number, MeasurementRow>()

  for (const reading of readings) {
    const recordedAt =
      parseDate(reading.recordedAt)

    const bucket = getTimeBucket(
      recordedAt.getTime(),
    )

    let row = groupedRows.get(bucket)

    if (!row) {
      row = createEmptyMeasurementRow(bucket)
      groupedRows.set(bucket, row)
    }

    insertReadingIntoRow(row, reading)
  }

  return Array.from(
    groupedRows.values(),
  ).sort(
    (a, b) => a.timestamp - b.timestamp,
  )
}

function createDailySummaries(
  rows: MeasurementRow[],
): DailySummary[] {
  const summaries =
    new Map<string, DailySummary>()

  for (const row of rows) {
    const { date } =
      getWibDateParts(
        new Date(row.timestamp),
      )

    let summary = summaries.get(date)

    if (!summary) {
      summary =
        createEmptyDailySummary(date)

      summaries.set(date, summary)
    }

    summary.sampleCount += 1

    addSummaryValue(
      summary.temperatureL4,
      row.temperatureL4,
    )

    addSummaryValue(
      summary.temperatureL5,
      row.temperatureL5,
    )

    addSummaryValue(
      summary.voltage,
      row.voltage,
    )

    addSummaryValue(
      summary.current,
      row.current,
    )
  }

  return Array.from(
    summaries.values(),
  ).sort((a, b) =>
    a.date.localeCompare(b.date),
  )
}

function styleHeader(
  worksheet: ExcelJS.Worksheet,
): void {
  const header = worksheet.getRow(1)

  header.font = {
    bold: true,
  }

  header.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  }

  header.height = 35
}

function setNumberFormat(
  worksheet: ExcelJS.Worksheet,
  columns: string[],
): void {
  for (const column of columns) {
    worksheet.getColumn(column).numFmt =
      "0.00"
  }
}

export async function createMonthlyExcel({
  archiveMonth,
  readings,
}: CreateMonthlyExcelOptions): Promise<Buffer> {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(
      archiveMonth,
    )
  ) {
    throw new Error(
      "archiveMonth harus berformat YYYY-MM",
    )
  }

  const measurementRows =
    createMeasurementRows(readings)

  const dailySummaries =
    createDailySummaries(measurementRows)

  const workbook = new ExcelJS.Workbook()

  workbook.creator =
    "Monitoring Ruang Server"

  workbook.lastModifiedBy =
    "Monitoring Ruang Server"

  workbook.created = new Date()
  workbook.modified = new Date()

  /*
   * ==================================
   * SHEET 1: DATA SENSOR
   * ==================================
   */

  const dataSheet =
    workbook.addWorksheet("Data Sensor", {
      views: [
        {
          state: "frozen",
          ySplit: 1,
        },
      ],
    })

  dataSheet.columns = [
    {
      header: "No.",
      key: "number",
      width: 8,
    },
    {
      header: "Tanggal dan Waktu (WIB)",
      key: "recordedAt",
      width: 24,
    },
    {
      header: "Suhu Lantai 4 (°C)",
      key: "temperatureL4",
      width: 20,
    },
    {
      header: "Suhu Lantai 5 (°C)",
      key: "temperatureL5",
      width: 20,
    },
    {
      header: "Tegangan (V)",
      key: "voltage",
      width: 16,
    },
  ]

  styleHeader(dataSheet)

  measurementRows.forEach(
    (row, index) => {
      const { dateTime } =
        getWibDateParts(
          new Date(row.timestamp),
        )

      dataSheet.addRow({
        number: index + 1,
        recordedAt: dateTime,
        temperatureL4:
          row.temperatureL4,
        temperatureL5:
          row.temperatureL5,
        voltage: row.voltage,
      })
    },
  )

  setNumberFormat(dataSheet, [
    "temperatureL4",
    "temperatureL5",
    "voltage",
  ])

  dataSheet.autoFilter = {
    from: "A1",
    to: "E1",
  }

  /*
   * ==================================
   * SHEET 2: RINGKASAN HARIAN
   * ==================================
   */

  const summarySheet =
    workbook.addWorksheet(
      "Ringkasan Harian",
      {
        views: [
          {
            state: "frozen",
            ySplit: 1,
          },
        ],
      },
    )

  summarySheet.columns = [
    {
      header: "Tanggal",
      key: "date",
      width: 15,
    },
    {
      header: "Jumlah Sampel",
      key: "sampleCount",
      width: 16,
    },

    {
      header: "Rata-rata Suhu L4 (°C)",
      key: "temperatureL4Average",
      width: 22,
    },
    {
      header: "Minimum Suhu L4 (°C)",
      key: "temperatureL4Minimum",
      width: 22,
    },
    {
      header: "Maksimum Suhu L4 (°C)",
      key: "temperatureL4Maximum",
      width: 22,
    },

    {
      header: "Rata-rata Suhu L5 (°C)",
      key: "temperatureL5Average",
      width: 22,
    },
    {
      header: "Minimum Suhu L5 (°C)",
      key: "temperatureL5Minimum",
      width: 22,
    },
    {
      header: "Maksimum Suhu L5 (°C)",
      key: "temperatureL5Maximum",
      width: 22,
    },

    {
      header: "Rata-rata Tegangan (V)",
      key: "voltageAverage",
      width: 22,
    },
    {
      header: "Minimum Tegangan (V)",
      key: "voltageMinimum",
      width: 22,
    },
    {
      header: "Maksimum Tegangan (V)",
      key: "voltageMaximum",
      width: 22,
    },

  ]

  styleHeader(summarySheet)

  for (const summary of dailySummaries) {
    summarySheet.addRow({
      date: summary.date,
      sampleCount: summary.sampleCount,

      temperatureL4Average:
        getAverage(
          summary.temperatureL4,
        ),
      temperatureL4Minimum:
        getMinimum(
          summary.temperatureL4,
        ),
      temperatureL4Maximum:
        getMaximum(
          summary.temperatureL4,
        ),

      temperatureL5Average:
        getAverage(
          summary.temperatureL5,
        ),
      temperatureL5Minimum:
        getMinimum(
          summary.temperatureL5,
        ),
      temperatureL5Maximum:
        getMaximum(
          summary.temperatureL5,
        ),

      voltageAverage:
        getAverage(summary.voltage),
      voltageMinimum:
        getMinimum(summary.voltage),
      voltageMaximum:
        getMaximum(summary.voltage),
    })
  }

  setNumberFormat(summarySheet, [
    "temperatureL4Average",
    "temperatureL4Minimum",
    "temperatureL4Maximum",
    "temperatureL5Average",
    "temperatureL5Minimum",
    "temperatureL5Maximum",
    "voltageAverage",
    "voltageMinimum",
    "voltageMaximum",
  ])

  summarySheet.autoFilter = {
    from: "A1",
    to: "K1",
  }

  const output =
    await workbook.xlsx.writeBuffer()

  return Buffer.from(
    output as unknown as ArrayBuffer,
  )
}

type CreateMonthlyExcelFileOptions = {
  archiveMonth: string
  databaseRows: AsyncIterable<MonthlyDatabaseReading>
  outputPath: string
}

export type MonthlyExcelFileResult = {
  rowCount: number
  readingCount: number
  measurementRowCount: number
}

function addMeasurementToDailySummary(
  summaries: Map<string, DailySummary>,
  row: MeasurementRow,
): void {
  const { date } =
    getWibDateParts(new Date(row.timestamp))

  let summary = summaries.get(date)

  if (!summary) {
    summary = createEmptyDailySummary(date)
    summaries.set(date, summary)
  }

  summary.sampleCount += 1
  addSummaryValue(
    summary.temperatureL4,
    row.temperatureL4,
  )
  addSummaryValue(
    summary.temperatureL5,
    row.temperatureL5,
  )
  addSummaryValue(
    summary.voltage,
    row.voltage,
  )
  addSummaryValue(
    summary.current,
    row.current,
  )
}

function toFiniteNumber(
  value: string | number | null,
): number | null {
  if (value === null) {
    return null
  }

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Membuat laporan XLSX dengan memori konstan.
 *
 * Baris database diterima sebagai AsyncIterable dan langsung
 * ditulis ke worksheet. Hanya bucket 15 detik yang sedang aktif
 * serta ringkasan harian yang dipertahankan di memori.
 */
export async function createMonthlyExcelFile({
  archiveMonth,
  databaseRows,
  outputPath,
}: CreateMonthlyExcelFileOptions): Promise<MonthlyExcelFileResult> {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(
      archiveMonth,
    )
  ) {
    throw new Error(
      "archiveMonth harus berformat YYYY-MM",
    )
  }

  const workbook =
    new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: outputPath,
      useSharedStrings: false,
      useStyles: true,
    })

  workbook.creator = "Monitoring Ruang Server"
  workbook.lastModifiedBy = "Monitoring Ruang Server"
  workbook.created = new Date()
  workbook.modified = new Date()

  const dataSheet =
    workbook.addWorksheet("Data Sensor", {
      views: [
        {
          state: "frozen",
          ySplit: 1,
        },
      ],
    })

  dataSheet.columns = [
    {
      header: "No.",
      key: "number",
      width: 8,
    },
    {
      header: "Tanggal dan Waktu (WIB)",
      key: "recordedAt",
      width: 24,
    },
    {
      header: "Suhu Lantai 4 (°C)",
      key: "temperatureL4",
      width: 20,
    },
    {
      header: "Suhu Lantai 5 (°C)",
      key: "temperatureL5",
      width: 20,
    },
    {
      header: "Tegangan (V)",
      key: "voltage",
      width: 16,
    },
  ]

  styleHeader(dataSheet)
  setNumberFormat(dataSheet, [
    "temperatureL4",
    "temperatureL5",
    "voltage",
  ])

  dataSheet.autoFilter = {
    from: "A1",
    to: "E1",
  }

  dataSheet.getRow(1).commit()

  const dailySummaries =
    new Map<string, DailySummary>()

  let currentMeasurement: MeasurementRow | null = null
  let rowCount = 0
  let readingCount = 0
  let measurementRowCount = 0

  const commitMeasurement = () => {
    if (!currentMeasurement) {
      return
    }

    measurementRowCount += 1

    const { dateTime } =
      getWibDateParts(
        new Date(currentMeasurement.timestamp),
      )

    dataSheet
      .addRow({
        number: measurementRowCount,
        recordedAt: dateTime,
        temperatureL4:
          currentMeasurement.temperatureL4,
        temperatureL5:
          currentMeasurement.temperatureL5,
        voltage: currentMeasurement.voltage,
      })
      .commit()

    addMeasurementToDailySummary(
      dailySummaries,
      currentMeasurement,
    )
  }

  for await (const databaseRow of databaseRows) {
    rowCount += 1

    const timestamp =
      parseDate(databaseRow.recorded_at).getTime()

    const bucket = getTimeBucket(timestamp)

    if (
      currentMeasurement &&
      currentMeasurement.timestamp !== bucket
    ) {
      commitMeasurement()
      currentMeasurement = null
    }

    if (!currentMeasurement) {
      currentMeasurement =
        createEmptyMeasurementRow(bucket)
    }

    const sensorId =
      databaseRow.sensor_id
        .trim()
        .toUpperCase()

    const temperature =
      toFiniteNumber(databaseRow.temperature)

    if (temperature !== null) {
      readingCount += 1

      if (sensorId === "TEMP-L5") {
        currentMeasurement.temperatureL5 =
          temperature
      } else {
        currentMeasurement.temperatureL4 =
          temperature
      }
    }

    const voltage =
      toFiniteNumber(databaseRow.voltage)

    if (voltage !== null) {
      readingCount += 1
      currentMeasurement.voltage = voltage
    }

  }

  commitMeasurement()
  dataSheet.commit()

  const summarySheet =
    workbook.addWorksheet(
      "Ringkasan Harian",
      {
        views: [
          {
            state: "frozen",
            ySplit: 1,
          },
        ],
      },
    )

  summarySheet.columns = [
    {
      header: "Tanggal",
      key: "date",
      width: 15,
    },
    {
      header: "Jumlah Sampel",
      key: "sampleCount",
      width: 16,
    },
    {
      header: "Rata-rata Suhu L4 (°C)",
      key: "temperatureL4Average",
      width: 22,
    },
    {
      header: "Minimum Suhu L4 (°C)",
      key: "temperatureL4Minimum",
      width: 22,
    },
    {
      header: "Maksimum Suhu L4 (°C)",
      key: "temperatureL4Maximum",
      width: 22,
    },
    {
      header: "Rata-rata Suhu L5 (°C)",
      key: "temperatureL5Average",
      width: 22,
    },
    {
      header: "Minimum Suhu L5 (°C)",
      key: "temperatureL5Minimum",
      width: 22,
    },
    {
      header: "Maksimum Suhu L5 (°C)",
      key: "temperatureL5Maximum",
      width: 22,
    },
    {
      header: "Rata-rata Tegangan (V)",
      key: "voltageAverage",
      width: 22,
    },
    {
      header: "Minimum Tegangan (V)",
      key: "voltageMinimum",
      width: 22,
    },
    {
      header: "Maksimum Tegangan (V)",
      key: "voltageMaximum",
      width: 22,
    },
  ]

  styleHeader(summarySheet)
  setNumberFormat(summarySheet, [
    "temperatureL4Average",
    "temperatureL4Minimum",
    "temperatureL4Maximum",
    "temperatureL5Average",
    "temperatureL5Minimum",
    "temperatureL5Maximum",
    "voltageAverage",
    "voltageMinimum",
    "voltageMaximum",
  ])

  summarySheet.autoFilter = {
    from: "A1",
    to: "K1",
  }

  summarySheet.getRow(1).commit()

  const orderedSummaries =
    Array.from(dailySummaries.values()).sort(
      (a, b) => a.date.localeCompare(b.date),
    )

  for (const summary of orderedSummaries) {
    summarySheet
      .addRow({
        date: summary.date,
        sampleCount: summary.sampleCount,
        temperatureL4Average:
          getAverage(summary.temperatureL4),
        temperatureL4Minimum:
          getMinimum(summary.temperatureL4),
        temperatureL4Maximum:
          getMaximum(summary.temperatureL4),
        temperatureL5Average:
          getAverage(summary.temperatureL5),
        temperatureL5Minimum:
          getMinimum(summary.temperatureL5),
        temperatureL5Maximum:
          getMaximum(summary.temperatureL5),
        voltageAverage:
          getAverage(summary.voltage),
        voltageMinimum:
          getMinimum(summary.voltage),
        voltageMaximum:
          getMaximum(summary.voltage),
      })
      .commit()
  }

  summarySheet.commit()
  await workbook.commit()

  return {
    rowCount,
    readingCount,
    measurementRowCount,
  }
}
