"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import {
  Activity,
  CircleAlert,
  Cpu,
  LayoutGrid,
  Radio,
  Server,
  ShieldCheck,
  Thermometer,
  TrendingUp,
  Zap,
  LoaderCircle,
  X,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { AlertHeaderButton } from "@/components/alert-header-button"
import { AppShell } from "@/components/app-shell"
import { UnderlineTabs } from "@/components/shadcn-space/tabs/tabs-05"
import { AnimatedTabs, AnimatedTabsNoIcon } from "@/components/shadcn-space/tabs/tabs-08"
import { Badge } from "@/components/ui/badge"

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  defaultMonitoringSettings,
  type MonitoringSettings,
} from "@/lib/monitoring-settings"

type Floor = "4" | "5"
type Period = "1" | "6" | "24"
type ChartTab =
  | "all"
  | "suhu"
  | "tegangan"
  | "arus"

type ChartMetric = Exclude<ChartTab, "all">

const FLOOR_CHART_METRICS: Record<Floor, ChartMetric[]> = {
  "4": ["suhu", "tegangan", "arus"],
  "5": ["suhu"],
}

const VOLTAGE_TARGET = 220
const CURRENT_CAPACITY = 25

type RawReading = {
  id: number | string
  sensorId: string
  temperature: number
  voltage: number | null
  current: number | null
  recordedAt: string
}

type ChartReading = {
  time: string
  timestamp: number
  temperature: number
  voltage: number | null
  current: number | null
}

type Status =
  | "Normal"
  | "Waspada"
  | "Bahaya"

type HistoryResponse = {
  success?: boolean
  data?: unknown[]
  error?: string
  details?: string
}

type SettingsResponse = {
  success?: boolean
  data?: Partial<MonitoringSettings>
}

const SENSOR_L4 = "TEMP-L4"
const SENSOR_L5 = "TEMP-L5"

const MAX_CHART_POINTS = 300

const periodConfigs: Record<
  Period,
  {
    hours: number
    limit: number
    label: string
  }
> = {
  "1": {
    hours: 1,
    limit: 300,
    label: "1 Jam Terakhir",
  },
  "6": {
    hours: 6,
    limit: 1_500,
    label: "6 Jam Terakhir",
  },
  "24": {
    hours: 24,
    limit: 6_000,
    label: "24 Jam Terakhir",
  },
}

function parseFiniteNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null
  }

  const result = Number(value)

  return Number.isFinite(result)
    ? result
    : null
}

function getNumberSetting(
  value: unknown,
  fallback: number,
): number {
  const parsed = parseFiniteNumber(value)

  return parsed ?? fallback
}

function clock(
  value: string | number | Date,
  seconds = false,
): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      second: seconds
        ? "2-digit"
        : undefined,
      hourCycle: "h23",
    },
  ).format(date)
}



function fullDate(
  value: string | Date,
): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "long",
      year: "numeric",
    },
  ).format(date)
}

function fullDateTime(
  value: string | number | Date,
): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(
    "id-ID",
    {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    },
  ).format(date)
}

function normalizeReading(
  value: unknown,
): RawReading | null {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return null
  }

  const reading = value as Record<
    string,
    unknown
  >

  const sensorId =
    typeof reading.sensorId === "string"
      ? reading.sensorId.trim()
      : ""

  const temperature =
    parseFiniteNumber(
      reading.temperature,
    )

  const voltage =
    parseFiniteNumber(
      reading.voltage,
    )

  const current =
    parseFiniteNumber(
      reading.current,
    )

  const recordedAt =
    typeof reading.recordedAt ===
      "string"
      ? reading.recordedAt
      : ""

  const date = new Date(recordedAt)

  if (
    !sensorId ||
    temperature === null ||
    !recordedAt ||
    Number.isNaN(date.getTime())
  ) {
    return null
  }

  const id =
    typeof reading.id === "number" ||
      typeof reading.id === "string"
      ? reading.id
      : `${sensorId}-${recordedAt}`

  return {
    id,
    sensorId,
    temperature,
    voltage,
    current,
    recordedAt: date.toISOString(),
  }
}

function normalizeReadings(
  values: unknown[],
): RawReading[] {
  return values
    .map(normalizeReading)
    .filter(
      (
        reading,
      ): reading is RawReading =>
        reading !== null,
    )
    .sort(
      (first, second) =>
        new Date(
          second.recordedAt,
        ).getTime() -
        new Date(
          first.recordedAt,
        ).getTime(),
    )
}

function mergeHistoryReadings({
  previous,
  incoming,
  hours,
  limitPerSensor,
}: {
  previous: RawReading[]
  incoming: RawReading[]
  hours: number
  limitPerSensor: number
}): RawReading[] {
  const cutoff =
    Date.now() -
    hours * 60 * 60 * 1000

  const readingMap = new Map<
    string,
    RawReading
  >()

  for (const reading of [
    ...incoming,
    ...previous,
  ]) {
    const timestamp = new Date(
      reading.recordedAt,
    ).getTime()

    if (
      Number.isNaN(timestamp) ||
      timestamp < cutoff
    ) {
      continue
    }

    const key =
      `${reading.sensorId}-${String(
        reading.id,
      )}`

    if (!readingMap.has(key)) {
      readingMap.set(key, reading)
    }
  }

  const readings = Array.from(
    readingMap.values(),
  )
    .sort(
      (first, second) =>
        new Date(
          second.recordedAt,
        ).getTime() -
        new Date(
          first.recordedAt,
        ).getTime(),
    )
  const sensorCounts = new Map<string, number>()

  return readings.filter(reading => {
    const currentCount =
      sensorCounts.get(reading.sensorId) ?? 0

    if (currentCount >= limitPerSensor) {
      return false
    }

    sensorCounts.set(
      reading.sensorId,
      currentCount + 1,
    )

    return true
  })
}

function downsampleChartData(
  data: ChartReading[],
  maximumPoints: number,
): ChartReading[] {
  if (data.length <= maximumPoints) {
    return data
  }

  const result: ChartReading[] = []

  const step =
    (data.length - 1) /
    (maximumPoints - 1)

  for (
    let index = 0;
    index < maximumPoints;
    index += 1
  ) {
    const sourceIndex = Math.round(
      index * step,
    )

    result.push(data[sourceIndex])
  }

  return result
}

function getTemperatureDomain(
  data: ChartReading[],
  warning: number,
  danger: number,
): [number, number] {
  const values = data
    .map(item => item.temperature)
    .filter(Number.isFinite)

  values.push(warning, danger)

  const minimum = Math.min(...values)
  const maximum = Math.max(...values)

  const difference =
    maximum - minimum

  const padding = Math.max(
    difference * 0.15,
    1,
  )

  return [
    Math.floor(
      (minimum - padding) * 10,
    ) / 10,
    Math.ceil(
      (maximum + padding) * 10,
    ) / 10,
  ]
}

function getVoltageDomain(
  data: ChartReading[],
  voltageMin = 200,
  voltageMax = 240,
): [number, number] {
  const values = data
    .map(item => item.voltage)
    .filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(value),
    )

  values.push(voltageMin, 220, voltageMax)

  const minimum = Math.min(...values)
  const maximum = Math.max(...values)

  const difference =
    maximum - minimum

  const padding = Math.max(
    difference * 0.1,
    5,
  )

  return [
    Math.floor(minimum - padding),
    Math.ceil(maximum + padding),
  ]
}

function getCurrentDomain(
  data: ChartReading[],
): [number, number] {
  const values = data
    .map(item => item.current)
    .filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(value),
    )

  values.push(CURRENT_CAPACITY)

  const minimum = Math.min(...values)
  const maximum = Math.max(...values)

  const difference = maximum - minimum
  const padding = Math.max(difference * 0.15, 0.5)

  return [
    Math.max(0, Math.floor((minimum - padding) * 10) / 10),
    Math.ceil((maximum + padding) * 10) / 10,
  ]
}

function formatAxisClock(value: number): string {
  return clock(value).replace(":", ".")
}

function getChartTimeline(
  data: ChartReading[],
  period: Period,
): {
  domain: [number, number]
  ticks: number[]
  latestTimestamp?: number
} {
  const latestTimestamp =
    data.at(-1)?.timestamp ?? Date.now()
  const intervalMinutes =
    period === "24"
      ? 240
      : period === "6"
        ? 60
        : 15
  const interval = intervalMinutes * 60 * 1000
  const timezoneOffset = 7 * 60 * 60 * 1000
  const periodStart =
    latestTimestamp -
    periodConfigs[period].hours * 60 * 60 * 1000
  const firstRegularTick =
    Math.ceil(
      (periodStart + timezoneOffset) /
      interval,
    ) * interval - timezoneOffset
  const lastRegularTick =
    Math.ceil(
      (latestTimestamp + timezoneOffset) /
      interval,
    ) * interval - timezoneOffset
  const ticks: number[] = []

  for (
    let tick = firstRegularTick;
    tick <= lastRegularTick;
    tick += interval
  ) {
    ticks.push(tick)
  }

  const latestMinute = Math.floor(
    latestTimestamp / 60_000,
  )
  const latestAlreadyIncluded = ticks.some(
    tick =>
      Math.floor(tick / 60_000) ===
      latestMinute,
  )

  if (!latestAlreadyIncluded) {
    ticks.push(latestTimestamp)
    ticks.sort((first, second) => first - second)
  }

  return {
    domain: [periodStart, lastRegularTick],
    ticks,
    latestTimestamp,
  }
}

function getIntegerAxisTicks(
  domain: [number, number],
): number[] {
  const minimum = Math.floor(domain[0])
  const maximum = Math.ceil(domain[1])
  const step = Math.max(
    1,
    Math.ceil((maximum - minimum) / 4),
  )
  const ticks: number[] = []

  for (
    let value = minimum;
    value <= maximum;
    value += step
  ) {
    ticks.push(value)
  }

  if (ticks.at(-1) !== maximum) {
    ticks.push(maximum)
  }

  return ticks.reverse()
}

function getSensorId(
  floor: Floor,
): string {
  return floor === "4"
    ? SENSOR_L4
    : SENSOR_L5
}

function getSensorLabel(
  sensorId: string,
): string {
  if (sensorId === SENSOR_L4) {
    return "Lantai 4 (Ruang Server)"
  }

  if (sensorId === SENSOR_L5) {
    return "Lantai 5 (Ruang ATC)"
  }

  return sensorId
}

function getStatusColor(
  status: Status,
): string {
  if (status === "Bahaya") {
    return "text-rose-600 dark:text-rose-400"
  }

  if (status === "Waspada") {
    return "text-amber-500 dark:text-amber-400"
  }

  return "text-emerald-600 dark:text-emerald-400"
}

function getStatusBackground(
  status: Status,
): string {
  if (status === "Bahaya") {
    return (
      "bg-rose-500/10 text-rose-600 dark:text-rose-400 " +
      "hover:bg-rose-500/15"
    )
  }

  if (status === "Waspada") {
    return (
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 " +
      "hover:bg-amber-500/15"
    )
  }

  return (
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 " +
    "hover:bg-emerald-500/15"
  )
}

async function readHistoryResponse(
  response: Response,
): Promise<RawReading[]> {
  const result =
    (await response.json()) as HistoryResponse

  if (
    !response.ok ||
    result.success === false
  ) {
    throw new Error(
      result.error ||
      result.details ||
      `Gagal mengambil data (${response.status})`,
    )
  }

  return normalizeReadings(
    Array.isArray(result.data)
      ? result.data
      : [],
  )
}

export function Dashboard() {
  const [
    activeFloor,
    setActiveFloor,
  ] = useState<Floor>("4")

  const [period, setPeriod] =
    useState<Period>("24")

  const [chartTab, setChartTab] =
    useState<ChartTab>("suhu")

  const [
    historyReadings,
    setHistoryReadings,
  ] = useState<RawReading[]>([])

  const [
    latestReadings,
    setLatestReadings,
  ] = useState<RawReading[]>([])

  const [settings, setSettings] =
    useState<MonitoringSettings>(
      defaultMonitoringSettings,
    )

  const [
    loadingHistory,
    setLoadingHistory,
  ] = useState(true)

  const [error, setError] =
    useState<string | null>(null)



  const latestRequestRunning =
    useRef(false)

  const activeSensorId =
    getSensorId(activeFloor)

  // Batas suhu Lantai 4 (global)
  const warningTemperature =
    getNumberSetting(
      settings.warningTemperature,
      getNumberSetting(
        defaultMonitoringSettings
          .warningTemperature,
        27,
      ),
    )

  const dangerTemperature =
    getNumberSetting(
      settings.dangerTemperature,
      getNumberSetting(
        defaultMonitoringSettings
          .dangerTemperature,
        30,
      ),
    )

  // Batas suhu Lantai 5 (khusus)
  const warningTemperatureL5 =
    getNumberSetting(
      settings.warningTemperatureL5,
      getNumberSetting(
        defaultMonitoringSettings
          .warningTemperatureL5,
        27,
      ),
    )

  const dangerTemperatureL5 =
    getNumberSetting(
      settings.dangerTemperatureL5,
      getNumberSetting(
        defaultMonitoringSettings
          .dangerTemperatureL5,
        30,
      ),
    )

  // Batas suhu lantai aktif (untuk grafik/chart)
  const activeWarningTemperature =
    activeFloor === "5"
      ? warningTemperatureL5
      : warningTemperature

  const activeDangerTemperature =
    activeFloor === "5"
      ? dangerTemperatureL5
      : dangerTemperature

  const refreshInterval =
    Math.max(
      getNumberSetting(
        settings.refreshInterval,
        3,
      ),
      3,
    )

  const offlineTimeout =
    Math.max(
      getNumberSetting(
        settings.offlineTimeout,
        300,
      ),
      1,
    )

  const voltageMin =
    getNumberSetting(
      settings.voltageMin,
      getNumberSetting(
        defaultMonitoringSettings
          .voltageMin,
        200,
      ),
    )

  const voltageMax =
    getNumberSetting(
      settings.voltageMax,
      getNumberSetting(
        defaultMonitoringSettings
          .voltageMax,
        240,
      ),
    )

  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch(
          "/api/settings",
          {
            cache: "no-store",
          },
        )

        if (!response.ok) {
          return
        }

        const result =
          (await response.json()) as SettingsResponse

        if (
          result.success &&
          result.data
        ) {
          setSettings(previous => ({
            ...previous,
            ...result.data,
          }))
        }
      } catch (settingsError) {
        console.error(
          "Gagal mengambil pengaturan:",
          settingsError,
        )
      }
    }

    void fetchSettings()

    function handleSettingsChanged(
      event: Event,
    ) {
      const customEvent =
        event as CustomEvent<
          MonitoringSettings
        >

      if (customEvent.detail) {
        setSettings(
          customEvent.detail,
        )
      }
    }

    window.addEventListener(
      "monitoring-settings-changed",
      handleSettingsChanged,
    )

    return () => {
      window.removeEventListener(
        "monitoring-settings-changed",
        handleSettingsChanged,
      )
    }
  }, [])



  // Muat data utama 24 jam sekali saat dashboard dibuka.
  // Pilihan periode hanya memfilter data ini di sisi tampilan.
  const fetchHistory = useCallback(
    async (
      signal?: AbortSignal,
    ) => {
      // Only show skeleton loader on initial boot when no history data exists
      setHistoryReadings(prev => {
        if (prev.length === 0) setLoadingHistory(true)
        return prev
      })
      setError(null)

      try {
        const sensorIds = [
          SENSOR_L4,
          SENSOR_L5,
        ] as const

        const responses = await Promise.all(
          sensorIds.map(sensorId => {
            const searchParams =
              new URLSearchParams({
                sensorId,
                hours: "24",
                limit: "6000",
              })

            return fetch(
              `/api/sensor/history?${searchParams.toString()}`,
              {
                cache: "no-store",
                signal,
              },
            )
          }),
        )

        const readingGroups =
          await Promise.all(
            responses.map(response =>
              readHistoryResponse(response),
            ),
          )

        const readings = readingGroups
          .flat()
          .sort(
            (first, second) =>
              new Date(
                second.recordedAt,
              ).getTime() -
              new Date(
                first.recordedAt,
              ).getTime(),
          )

        setHistoryReadings(readings)
      } catch (historyError) {
        if (
          historyError instanceof
          DOMException &&
          historyError.name ===
          "AbortError"
        ) {
          return
        }

        console.error(
          "Gagal memuat riwayat:",
          historyError,
        )

        setError(
          historyError instanceof Error
            ? historyError.message
            : "Gagal memuat riwayat sensor",
        )
      } finally {
        setLoadingHistory(false)
      }
    },
    [],
  )

  /*
   * Polling hanya mengambil beberapa
   * pembacaan terbaru, bukan seluruh
   * data periode berulang kali.
   */
  const fetchLatestReadings =
    useCallback(async () => {
      if (
        latestRequestRunning.current
      ) {
        return
      }

      latestRequestRunning.current =
        true

      try {
        const searchParams =
          new URLSearchParams({
            limit: "10",
          })

        const response = await fetch(
          `/api/sensor/history?${searchParams.toString()}`,
          {
            cache: "no-store",
          },
        )

        const readings =
          await readHistoryResponse(
            response,
          )

        setLatestReadings(readings)

        if (readings.length > 0) {
          setHistoryReadings(
            previous =>
              mergeHistoryReadings({
                previous,
                incoming: readings,
                hours: periodConfigs["24"].hours,
                limitPerSensor:
                  periodConfigs["24"].limit,
              }),
          )
        }
      } catch (latestError) {
        console.error(
          "Gagal memperbarui data terbaru:",
          latestError,
        )
      } finally {
        latestRequestRunning.current =
          false
      }
    }, [])

  useEffect(() => {
    const controller =
      new AbortController()

    void fetchHistory(
      controller.signal,
    )

    return () => {
      controller.abort()
    }
  }, [fetchHistory])

  useEffect(() => {
    void fetchLatestReadings()

    const timer =
      window.setInterval(() => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void fetchLatestReadings()
        }
      }, refreshInterval * 1000)

    const handleFocus = () => {
      void fetchLatestReadings()
    }

    window.addEventListener(
      "focus",
      handleFocus,
    )

    return () => {
      window.clearInterval(timer)

      window.removeEventListener(
        "focus",
        handleFocus,
      )
    }
  }, [
    fetchLatestReadings,
    refreshInterval,
  ])

  const readingL4 = useMemo(
    () =>
      latestReadings.find(
        reading =>
          reading.sensorId ===
          SENSOR_L4,
      ) ??
      historyReadings.find(
        reading =>
          reading.sensorId ===
          SENSOR_L4,
      ),
    [
      latestReadings,
      historyReadings,
    ],
  )

  const readingL5 = useMemo(
    () =>
      latestReadings.find(
        reading =>
          reading.sensorId ===
          SENSOR_L5,
      ) ??
      historyReadings.find(
        reading =>
          reading.sensorId ===
          SENSOR_L5,
      ),
    [
      latestReadings,
      historyReadings,
    ],
  )

  const isOnline = (
    reading: RawReading | undefined,
  ): boolean => {
    if (!reading) {
      return false
    }

    const timestamp = new Date(
      reading.recordedAt,
    ).getTime()

    if (Number.isNaN(timestamp)) {
      return false
    }

    const differenceSeconds =
      (Date.now() - timestamp) / 1000

    return (
      differenceSeconds <=
      offlineTimeout
    )
  }

  // Status L4 memakai threshold Lantai 4
  const getTempStatusL4 = (
    temperature: number | undefined,
  ): Status => {
    if (temperature === undefined) return "Normal"
    if (temperature >= dangerTemperature) return "Bahaya"
    if (temperature >= warningTemperature) return "Waspada"
    return "Normal"
  }

  // Status L5 memakai threshold Lantai 5
  const getTempStatusL5 = (
    temperature: number | undefined,
  ): Status => {
    if (temperature === undefined) return "Normal"
    if (temperature >= dangerTemperatureL5) return "Bahaya"
    if (temperature >= warningTemperatureL5) return "Waspada"
    return "Normal"
  }

  // getTempStatus untuk tabel 5 pembacaan terakhir (berdasarkan lantai aktif)
  const getTempStatus = (
    temperature: number | undefined,
  ): Status => {
    if (activeFloor === "5") return getTempStatusL5(temperature)
    return getTempStatusL4(temperature)
  }

  const onlineL4 =
    isOnline(readingL4)

  const onlineL5 =
    isOnline(readingL5)

  // Jika sensor offline, gunakan undefined agar suhu juga tampil sebagai "--"
  const activeReadingL4 = onlineL4 ? readingL4 : undefined
  const activeReadingL5 = onlineL5 ? readingL5 : undefined

  const statusL4 =
    getTempStatusL4(
      activeReadingL4?.temperature,
    )

  const statusL5 =
    getTempStatusL5(
      activeReadingL5?.temperature,
    )

  // Jika sensor offline semua nilai null agar tidak ada data lama yang tertinggal
  const voltageL4 = onlineL4 && readingL4?.voltage !== null && readingL4?.voltage !== undefined ? Number(readingL4.voltage) : null
  const currentL4 = onlineL4 && readingL4?.current !== null && readingL4?.current !== undefined ? Number(readingL4.current) : null
  const powerKwL4 = voltageL4 !== null && currentL4 !== null ? (voltageL4 * currentL4) / 1000 : null
  const loadPercentageL4 = currentL4 !== null ? Math.min(Math.round((currentL4 / CURRENT_CAPACITY) * 100), 100) : null

  const voltageL5 = onlineL5 && readingL5?.voltage !== null && readingL5?.voltage !== undefined ? Number(readingL5.voltage) : null
  const currentL5 = onlineL5 && readingL5?.current !== null && readingL5?.current !== undefined ? Number(readingL5.current) : null

  const chartData = useMemo(() => {
    const hoursLimit = periodConfigs[period].hours
    const latestTime = historyReadings.length > 0 ? new Date(historyReadings[0].recordedAt).getTime() : Date.now()
    const cutoffTime = latestTime - hoursLimit * 60 * 60 * 1000

    const prepared =
      historyReadings
        .filter(
          reading =>
            reading.sensorId === activeSensorId &&
            new Date(reading.recordedAt).getTime() >= cutoffTime,
        )
        .map(
          reading =>
            ({
              time:
                reading.recordedAt,
              timestamp: new Date(
                reading.recordedAt,
              ).getTime(),
              temperature:
                Number(
                  reading.temperature,
                ),
              voltage:
                activeFloor === "4" ? reading.voltage : null,
              current:
                activeFloor === "4" ? reading.current : null,
            }) satisfies ChartReading,
        )
        .filter(
          reading =>
            Number.isFinite(
              reading.temperature,
            ) &&
            !Number.isNaN(
              new Date(
                reading.time,
              ).getTime(),
            ),
        )
        .sort(
          (first, second) =>
            new Date(
              first.time,
            ).getTime() -
            new Date(
              second.time,
            ).getTime(),
        )

    return downsampleChartData(
      prepared,
      MAX_CHART_POINTS,
    )
  }, [
    historyReadings,
    activeSensorId,
    activeFloor,
    period,
  ])

  const hasTemperatureData =
    chartData.some(
      reading =>
        Number.isFinite(
          reading.temperature,
        ),
    )

  const hasVoltageData =
    chartData.some(
      reading =>
        reading.voltage !== null &&
        Number.isFinite(
          reading.voltage,
        ),
    )

  const hasCurrentData =
    chartData.some(
      reading =>
        reading.current !== null &&
        Number.isFinite(
          reading.current,
        ),
    )

  const temperatureDomain =
    useMemo(
      () =>
        getTemperatureDomain(
          chartData,
          activeWarningTemperature,
          activeDangerTemperature,
        ),
      [
        chartData,
        activeWarningTemperature,
        activeDangerTemperature,
      ],
    )

  const voltageDomain =
    useMemo(
      () =>
        getVoltageDomain(
          chartData,
          voltageMin,
          voltageMax,
        ),
      [chartData, voltageMin, voltageMax],
    )

  const currentDomain =
    useMemo(
      () =>
        getCurrentDomain(
          chartData,
        ),
      [chartData],
    )

  const activeTemperatures =
    useMemo(
      () =>
        historyReadings
          .filter(
            reading =>
              reading.sensorId ===
              activeSensorId,
          )
          .map(
            reading =>
              Number(
                reading.temperature,
              ),
          )
          .filter(Number.isFinite),
      [
        historyReadings,
        activeSensorId,
      ],
    )

  const maxTemp =
    activeTemperatures.length > 0
      ? Math.max(
        ...activeTemperatures,
      )
      : null

  const minTemp =
    activeTemperatures.length > 0
      ? Math.min(
        ...activeTemperatures,
      )
      : null

  const avgTemp =
    activeTemperatures.length > 0
      ? activeTemperatures.reduce(
        (total, temperature) =>
          total + temperature,
        0,
      ) /
      activeTemperatures.length
      : null

  const activeVoltages = useMemo(
    () =>
      chartData
        .map(reading => reading.voltage)
        .filter((val): val is number => val !== null && Number.isFinite(val)),
    [chartData],
  )
  const maxVolt = activeVoltages.length > 0 ? Math.max(...activeVoltages) : null
  const minVolt = activeVoltages.length > 0 ? Math.min(...activeVoltages) : null
  const avgVolt = activeVoltages.length > 0 ? activeVoltages.reduce((a, b) => a + b, 0) / activeVoltages.length : null

  const activeCurrents = useMemo(
    () =>
      chartData
        .map(reading => reading.current)
        .filter((val): val is number => val !== null && Number.isFinite(val)),
    [chartData],
  )
  const maxCurr = activeCurrents.length > 0 ? Math.max(...activeCurrents) : null
  const minCurr = activeCurrents.length > 0 ? Math.min(...activeCurrents) : null
  const avgCurr = activeCurrents.length > 0 ? activeCurrents.reduce((a, b) => a + b, 0) / activeCurrents.length : null

  const recentReadings =
    useMemo(
      () =>
        latestReadings
          .filter(
            reading =>
              reading.sensorId ===
              activeSensorId,
          )
          .slice(0, 5),
      [
        latestReadings,
        activeSensorId,
      ],
    )

  const initialLoading =
    loadingHistory &&
    historyReadings.length === 0

  return (
    <AppShell
      title="Monitoring Ruang Server & ATC"
      description="AirNav Indonesia — Bandara Banyuwangi (BWX)"
      actions={
        <>
          <HeaderClock />
          <AlertHeaderButton />
        </>
      }
    >
      <div className="mb-6 pb-1">
        <UnderlineTabs
          tabs={[
            { id: "4", label: "Lantai 4 - Ruang Server", icon: Server },
            { id: "5", label: "Lantai 5 - Ruang ATC", icon: Radio },
          ]}
          activeTab={activeFloor}
          onTabChange={(val) => setActiveFloor(val as Floor)}
          layoutId="dashboard-floor-tabs"
        />
      </div>

      {error && (
        <div
          className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex justify-end sm:left-auto sm:right-6 sm:max-w-sm"
          role="alert"
          aria-live="assertive"
        >
          <div className="pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-slate-900 shadow-xl shadow-slate-950/10 dark:border-rose-900/70 dark:bg-slate-950 dark:text-slate-100">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
              <CircleAlert className="size-5" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                Gagal memuat data sensor
              </p>
              <p className="mt-1 break-words text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {error}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setError(null)}
              className="grid size-7 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Tutup pemberitahuan"
              title="Tutup"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {initialLoading ? (
        <div className="grid min-h-[50vh] place-items-center">
          <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
            <LoaderCircle className="size-7 animate-spin" />

            <span>
              Menghubungkan ke database Supabase...
            </span>
          </div>
        </div>
      ) : (
        <>
          {activeFloor === "4" && (
            <div>
              <PairedMetricGrid
                pairs={[
                  {
                    metric: {
                      icon: Thermometer,
                      label: "Suhu Ruang Server",
                      value: activeReadingL4
                        ? `${Number(Number(activeReadingL4.temperature).toFixed(1))}°C`
                        : "--°C",
                      detail: activeReadingL4
                        ? `Batas waspada ${warningTemperature}°C`
                        : "Menunggu data",
                      valueClassName: activeReadingL4
                        ? getStatusColor(statusL4)
                        : "text-muted-foreground",
                      iconBgColor: "bg-emerald-500/10",
                      iconColor: "text-emerald-600 dark:text-emerald-400",
                    },
                    condition: {
                      icon: ShieldCheck,
                      label: "Kondisi Suhu L4",
                      value: !onlineL4
                        ? "-"
                        : statusL4 === "Bahaya"
                          ? "BAHAYA"
                          : statusL4 === "Waspada"
                            ? "WASPADA"
                            : "AMAN",
                      detail: !onlineL4
                        ? "Sensor suhu terputus"
                        : statusL4 === "Normal"
                          ? "Suhu ruangan normal"
                          : "Periksa pendingin ruangan",
                      valueClassName: !onlineL4
                        ? "text-muted-foreground"
                        : getStatusColor(statusL4),
                      iconBgColor: "bg-emerald-500/10",
                      iconColor: "text-emerald-600 dark:text-emerald-400",
                    },
                  },
                  {
                    metric: {
                      icon: Zap,
                      label: "Tegangan Listrik (AC)",
                      value: voltageL4 !== null
                        ? `${voltageL4.toFixed(1)} V`
                        : "-- V",
                      detail: voltageL4 !== null
                        ? `Rentang operasional ${voltageMin}–${voltageMax} V`
                        : "Menunggu data",
                      valueClassName: voltageL4 !== null
                        ? voltageL4 >= voltageMin && voltageL4 <= voltageMax
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground",
                      iconBgColor: "bg-amber-500/10",
                      iconColor: "text-amber-600 dark:text-amber-400",
                    },
                    condition: {
                      icon: ShieldCheck,
                      label: "Kondisi Tegangan L4",
                      value: voltageL4 === null
                        ? "-"
                        : voltageL4 < voltageMin
                          ? "LOW"
                          : voltageL4 > voltageMax
                            ? "HIGH"
                            : "NORMAL",
                      detail: voltageL4 === null
                        ? "Sensor tegangan terputus"
                        : voltageL4 < voltageMin
                          ? "Tegangan di bawah batas minimum"
                          : voltageL4 > voltageMax
                            ? "Tegangan di atas batas maksimum"
                            : "Tegangan dalam rentang normal",
                      valueClassName: voltageL4 === null
                        ? "text-muted-foreground"
                        : voltageL4 < voltageMin
                          ? "text-blue-600 dark:text-blue-400"
                          : voltageL4 > voltageMax
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400",
                      iconBgColor: "bg-amber-500/10",
                      iconColor: "text-amber-600 dark:text-amber-400",
                    },
                  },
                  {
                    metric: {
                      icon: Activity,
                      label: "Arus & Beban Listrik",
                      value: currentL4 !== null
                        ? `${currentL4.toFixed(2)} A`
                        : "-- A",
                      detail: currentL4 !== null
                        ? `Kapasitas maksimum ${CURRENT_CAPACITY} A`
                        : "Menunggu data",
                      valueClassName: currentL4 !== null
                        ? currentL4 <= CURRENT_CAPACITY
                          ? "text-cyan-600 dark:text-cyan-400"
                          : "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground",
                      iconBgColor: "bg-cyan-500/10",
                      iconColor: "text-cyan-600 dark:text-cyan-400",
                    },
                    condition: {
                      icon: ShieldCheck,
                      label: "Kondisi Arus L4",
                      value: currentL4 === null
                        ? "-"
                        : currentL4 <= CURRENT_CAPACITY
                          ? "AMAN"
                          : "BAHAYA",
                      detail: currentL4 === null
                        ? "Sensor arus terputus"
                        : currentL4 <= CURRENT_CAPACITY
                          ? "Arus di bawah kapasitas"
                          : "Arus melebihi kapasitas",
                      valueClassName: currentL4 === null
                        ? "text-muted-foreground"
                        : currentL4 <= CURRENT_CAPACITY
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      iconBgColor: "bg-cyan-500/10",
                      iconColor: "text-cyan-600 dark:text-cyan-400",
                    },
                  },
                ]}
                sensor={{
                  icon: Radio,
                  label: "Sensor L4",
                  value: onlineL4 ? "Online" : "Offline",
                  detail: onlineL4 && readingL4
                    ? `Sinkron: ${clock(readingL4.recordedAt, true)} WIB`
                    : "Menunggu data",
                  valueClassName: onlineL4
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                  iconBgColor: "bg-blue-500/10",
                  iconColor: "text-blue-600 dark:text-blue-400",
                }}
              />

              <div className="hidden" aria-hidden="true">
                <MetricStatistics02
                  items={[
                    {
                      icon: Thermometer,
                      label: "Suhu Ruang Server",
                      value: activeReadingL4
                        ? `${Number(Number(activeReadingL4.temperature).toFixed(1))}°C`
                        : "--°C",
                      detail: activeReadingL4
                        ? `Status: ${statusL4} (<${warningTemperature}°C)`
                        : "Menunggu data",
                      valueClassName: activeReadingL4
                        ? getStatusColor(statusL4)
                        : "text-muted-foreground",
                      iconBgColor: "bg-emerald-500/10",
                      iconColor: "text-emerald-600 dark:text-emerald-400",
                    },
                    {
                      icon: Zap,
                      label: "Tegangan Listrik (AC)",
                      value: voltageL4 !== null
                        ? `${voltageL4.toFixed(1)} V`
                        : "-- V",
                      detail: voltageL4 !== null
                        ? voltageL4 >= voltageMin && voltageL4 <= voltageMax
                          ? `${voltageMin}V - ${voltageMax}V Nominal (Stabil)`
                          : voltageL4 < voltageMin
                            ? `⚠️ Drop Voltage (<${voltageMin}V)`
                            : `🚨 Overvoltage Surge (>${voltageMax}V)`
                        : "Menunggu data",
                      valueClassName: voltageL4 !== null
                        ? voltageL4 >= voltageMin && voltageL4 <= voltageMax
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                        : "text-muted-foreground",
                      iconBgColor: "bg-amber-500/10",
                      iconColor: "text-amber-600 dark:text-amber-400",
                    },
                    {
                      icon: Activity,
                      label: "Arus & Beban Listrik",
                      value: currentL4 !== null
                        ? `${currentL4.toFixed(2)} A`
                        : "-- A",
                      detail: powerKwL4 !== null
                        ? `⚡ Daya: ${powerKwL4.toFixed(2)} kW (${loadPercentageL4}% Load)`
                        : "Menunggu data",
                      valueClassName: currentL4 !== null
                        ? "text-cyan-600 dark:text-cyan-400"
                        : "text-muted-foreground",
                      iconBgColor: "bg-cyan-500/10",
                      iconColor: "text-cyan-600 dark:text-cyan-400",
                    },
                    {
                      icon: Radio,
                      label: "Sensor L4",
                      value: onlineL4 ? "Online" : "Offline",
                      detail: onlineL4 && readingL4
                        ? `Sinkron: ${clock(readingL4.recordedAt, true)} WIB`
                        : "Menunggu data",
                      valueClassName: onlineL4
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400",
                      iconBgColor: "bg-blue-500/10",
                      iconColor: "text-blue-600 dark:text-blue-400",
                    },
                    {
                      icon: ShieldCheck,
                      label: "Kondisi Ruangan L4",
                      value: !onlineL4
                        ? "-"
                        : statusL4 === "Bahaya"
                          ? "BAHAYA"
                          : statusL4 === "Waspada"
                            ? "WASPADA"
                            : "AMAN",
                      detail: !onlineL4
                        ? "Sensor terputus"
                        : statusL4 === "Normal"
                          ? "Pendingin Ruangan Normal"
                          : "Periksa AC Server",
                      valueClassName: !onlineL4
                        ? "text-muted-foreground"
                        : getStatusColor(statusL4),
                      iconBgColor: "bg-slate-100 dark:bg-slate-800",
                      iconColor: "text-slate-600 dark:text-slate-400",
                    },
                  ]}
                />

                {/* Power & Electrical Health Banner L4 */}
                <div className="mt-4 grid gap-3 grid-cols-1 md:grid-cols-3">
                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200/80 bg-gradient-to-r from-amber-50/50 to-orange-50/30 dark:from-amber-950/20 dark:to-orange-950/10 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold shrink-0">
                        <Zap className="size-4" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stabilitas Tegangan</p>
                        <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
                          {voltageL4 !== null ? `${voltageL4.toFixed(1)} V AC` : "-- V"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] font-semibold ${
                       voltageL4 === null
                         ? "border-slate-200 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400"
                         : voltageL4 < voltageMin
                           ? "border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900"
                           : voltageL4 > voltageMax
                             ? "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900"
                             : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900"
                     }`}>
                       {voltageL4 === null
                         ? "--"
                         : voltageL4 < voltageMin
                           ? "LOW"
                           : voltageL4 > voltageMax
                             ? "HIGH"
                             : "NORMAL"}
                     </Badge>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200/80 bg-gradient-to-r from-cyan-50/50 to-blue-50/30 dark:from-cyan-950/20 dark:to-blue-950/10 dark:border-slate-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold shrink-0">
                        <Activity className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Kapasitas Arus</p>
                        <p className="text-sm font-extrabold text-slate-900 dark:text-slate-100 truncate">
                          {currentL4 !== null ? `${currentL4.toFixed(2)} A` : "-- A"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-semibold text-slate-500 block">Kapasitas Load</span>
                      <span className="text-xs font-bold text-cyan-700 dark:text-cyan-400">{loadPercentageL4 !== null ? `${loadPercentageL4}%` : "--%"}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200/80 bg-gradient-to-r from-emerald-50/50 to-teal-50/30 dark:from-emerald-950/20 dark:to-teal-950/10 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                        <Cpu className="size-4" />
                      </div>
                      <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Estimasi Daya Terpakai</p>
                        <p className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                          {powerKwL4 !== null ? `${powerKwL4.toFixed(2)} kW` : "-- kW"}
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900 text-[10px] font-semibold">
                      Daya Efisien
                    </Badge>
                  </div>
                </div>

              </div>

              <CombinedTelemetryChart
                floor="4"
                data={chartData}
                chartTab={chartTab}
                onChartTabChange={setChartTab}
                period={period}
                onPeriodChange={setPeriod}
                loading={loadingHistory}
                temperatureDomain={temperatureDomain}
                voltageDomain={voltageDomain}
                currentDomain={currentDomain}
                warningTemperature={warningTemperature}
                dangerTemperature={dangerTemperature}
              />

              <div className="hidden" aria-hidden="true">
                <ChartControls
                  floor="4"
                  chartTab={chartTab}
                  onChartTabChange={setChartTab}
                  period={period}
                  onPeriodChange={setPeriod}
                />

                {/* Grid Tampilan Grafik L4 berdasarkan Tab Aktif */}
                <div className={chartTab === "all" ? "grid grid-cols-1 lg:grid-cols-3 gap-4" : "grid grid-cols-1 gap-4"}>
                  {(chartTab === "all" || chartTab === "suhu") && (
                    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{chartTab === "all" ? "Suhu" : "Grafik Tren Suhu Lantai 4"}</span>
                            <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 dark:border-slate-700 text-[#005A9C] dark:text-blue-400">
                              {periodConfigs[period].label}
                            </Badge>
                          </CardTitle>
                        </div>

                        {chartTab !== "all" && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-lg bg-[#005A9C]/10 px-2.5 py-1 font-semibold text-[#005A9C] dark:bg-blue-900/30 dark:text-blue-300">
                              Saat Ini: {readingL4 ? `${Number(Number(readingL4.temperature).toFixed(1))}°C` : "--°C"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Min: {minTemp !== null ? `${minTemp.toFixed(1)}°C` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Max: {maxTemp !== null ? `${maxTemp.toFixed(1)}°C` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Avg: {avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : "--"}
                            </span>
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="h-80 pl-1 pr-4 pb-4">
                        {loadingHistory && chartData.length === 0 ? (
                          <ChartMessage loading message="Memuat grafik suhu..." />
                        ) : !hasTemperatureData ? (
                          <ChartMessage message="Belum ada data suhu pada periode ini." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -5, bottom: 5 }}>
                              <defs>
                                <linearGradient id="tempL4Grad" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0" stopColor="#10b981" stopOpacity={0.2} />
                                  <stop offset="1" stopColor="#10b981" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={["dataMin", "dataMax"]}
                                tickCount={6}
                                tickFormatter={value =>
                                  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(value)))
                                }
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                                fontSize={11}
                                tick={{ fill: "var(--muted-foreground)" }}
                              />
                              <YAxis domain={temperatureDomain} axisLine={false} tickLine={false} fontSize={11} width={48} tickFormatter={value => String(Number(value))} tick={{ fill: "var(--muted-foreground)" }} />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="rounded-xl border border-border bg-popover p-2.5 shadow-md text-popover-foreground text-xs font-semibold">
                                        <p className="font-mono text-muted-foreground mb-1">{fullDateTime(Number(label))}</p>
                                        {payload.map((p, idx) => (
                                          <p key={idx} className="flex items-center gap-1.5 text-xs">
                                            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
                                            <span className="text-muted-foreground font-medium">Suhu:</span>
                                            <span className="font-bold">{Number(Number(p.value).toFixed(1))}°C</span>
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  }
                                  return null
                                }}
                              />
                              <ReferenceLine y={dangerTemperature} ifOverflow="extendDomain" stroke="#fb7185" strokeDasharray="5 4" label={{ value: `Bahaya (≥${dangerTemperature}°C)`, fill: "#f43f5e", fontSize: 10, position: "insideTopLeft" }} />
                              <ReferenceLine y={warningTemperature} ifOverflow="extendDomain" stroke="#f59e0b" strokeDasharray="5 4" label={{ value: `Waspada (≥${warningTemperature}°C)`, fill: "#d97706", fontSize: 10, position: "insideTopLeft" }} />
                              <Area type="monotone" dataKey="temperature" stroke="#10b981" strokeWidth={2.4} fill="url(#tempL4Grad)" connectNulls isAnimationActive={false} dot={chartData.length === 1 ? { r: 4, fill: "#10b981", strokeWidth: 0 } : false} activeDot={{ r: 5, fill: "#059669" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {(chartTab === "all" || chartTab === "tegangan") && (
                    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{chartTab === "all" ? "Tegangan" : "Grafik Tegangan Listrik L4"}</span>
                            <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 dark:border-slate-700 text-amber-600 dark:text-amber-400">
                              {periodConfigs[period].label}
                            </Badge>
                          </CardTitle>
                        </div>

                        {chartTab !== "all" && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-600 dark:text-amber-400">
                              Saat Ini: {voltageL4 !== null ? `${voltageL4.toFixed(1)} V` : "-- V"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Min: {minVolt !== null ? `${minVolt.toFixed(1)} V` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Max: {maxVolt !== null ? `${maxVolt.toFixed(1)} V` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Avg: {avgVolt !== null ? `${avgVolt.toFixed(1)} V` : "--"}
                            </span>
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="h-80 pl-1 pr-4 pb-4">
                        {loadingHistory && chartData.length === 0 ? (
                          <ChartMessage loading message="Memuat grafik tegangan..." />
                        ) : !hasVoltageData ? (
                          <ChartMessage message="Belum ada data tegangan dari sensor." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -5, bottom: 5 }}>
                              <defs>
                                <linearGradient id="voltL4Grad" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0" stopColor="#d97706" stopOpacity={0.15} />
                                  <stop offset="1" stopColor="#d97706" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={["dataMin", "dataMax"]}
                                tickCount={6}
                                tickFormatter={value =>
                                  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(value)))
                                }
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                                fontSize={11}
                                tick={{ fill: "var(--muted-foreground)" }}
                              />
                              <YAxis domain={voltageDomain} ticks={[200, 210, 220, 230, 240]} axisLine={false} tickLine={false} fontSize={11} width={48} tickFormatter={value => String(Number(value))} tick={{ fill: "var(--muted-foreground)" }} />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="rounded-xl border border-border bg-popover p-2.5 shadow-md text-popover-foreground text-xs font-semibold">
                                        <p className="font-mono text-muted-foreground mb-1">{fullDateTime(Number(label))}</p>
                                        {payload.map((p, idx) => (
                                          <p key={idx} className="flex items-center gap-1.5 text-xs">
                                            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
                                            <span className="text-muted-foreground font-medium">Tegangan:</span>
                                            <span className="font-bold">{Number(Number(p.value).toFixed(1))} V</span>
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  }
                                  return null
                                }}
                              />
                              <ReferenceLine y={220} ifOverflow="extendDomain" stroke="#3b82f6" strokeDasharray="4 4" label={{ value: "Target 220 V", fill: "#2563eb", fontSize: 10, position: "insideTopLeft" }} />
                              <ReferenceLine y={200} ifOverflow="extendDomain" stroke="#f43f5e" strokeDasharray="4 4" />
                              <ReferenceLine y={240} ifOverflow="extendDomain" stroke="#f43f5e" strokeDasharray="4 4" />
                              <Area type="monotone" dataKey="voltage" stroke="#d97706" strokeWidth={2.4} fill="url(#voltL4Grad)" connectNulls isAnimationActive={false} dot={chartData.length === 1 ? { r: 4, fill: "#d97706", strokeWidth: 0 } : false} activeDot={{ r: 5, fill: "#b45309" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {(chartTab === "all" || chartTab === "arus") && (
                    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{chartTab === "all" ? "Arus" : "Grafik Arus Listrik L4"}</span>
                            <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 dark:border-slate-700 text-cyan-600 dark:text-cyan-400">
                              {periodConfigs[period].label}
                            </Badge>
                          </CardTitle>
                        </div>

                        {chartTab !== "all" && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-lg bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-600 dark:text-cyan-400">
                              Saat Ini: {currentL4 !== null ? `${currentL4.toFixed(2)} A` : "-- A"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Min: {minCurr !== null ? `${minCurr.toFixed(2)} A` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Max: {maxCurr !== null ? `${maxCurr.toFixed(2)} A` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Avg: {avgCurr !== null ? `${avgCurr.toFixed(2)} A` : "--"}
                            </span>
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="h-80 pl-1 pr-4 pb-4">
                        {loadingHistory && chartData.length === 0 ? (
                          <ChartMessage loading message="Memuat grafik arus..." />
                        ) : !hasCurrentData ? (
                          <ChartMessage message="Belum ada data arus dari sensor." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -5, bottom: 5 }}>
                              <defs>
                                <linearGradient id="currL4Grad" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0" stopColor="#06b6d4" stopOpacity={0.2} />
                                  <stop offset="1" stopColor="#06b6d4" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={["dataMin", "dataMax"]}
                                tickCount={6}
                                tickFormatter={value =>
                                  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(value)))
                                }
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                                fontSize={11}
                                tick={{ fill: "var(--muted-foreground)" }}
                              />
                              <YAxis domain={currentDomain} axisLine={false} tickLine={false} fontSize={11} width={48} tickFormatter={value => `${Number(value).toFixed(1)}`} tick={{ fill: "var(--muted-foreground)" }} />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="rounded-xl border border-border bg-popover p-2.5 shadow-md text-popover-foreground text-xs font-semibold">
                                        <p className="font-mono text-muted-foreground mb-1">{fullDateTime(Number(label))}</p>
                                        {payload.map((p, idx) => (
                                          <p key={idx} className="flex items-center gap-1.5 text-xs">
                                            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
                                            <span className="text-muted-foreground font-medium">Arus:</span>
                                            <span className="font-bold">{Number(Number(p.value).toFixed(2))} A</span>
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  }
                                  return null
                                }}
                              />
                              <Area type="monotone" dataKey="current" stroke="#06b6d4" strokeWidth={2.2} fill="url(#currL4Grad)" connectNulls isAnimationActive={false} dot={chartData.length === 1 ? { r: 4, fill: "#06b6d4", strokeWidth: 0 } : false} activeDot={{ r: 5, fill: "#0891b2" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeFloor === "5" && (
            <div>
              <PairedMetricGrid
                pairs={[
                  {
                    metric: {
                      icon: Thermometer,
                      label: "Suhu Ruangan L5",
                      value: activeReadingL5
                        ? `${Number(Number(activeReadingL5.temperature).toFixed(1))}°C`
                        : "--°C",
                      detail: activeReadingL5
                        ? `Batas waspada ${warningTemperatureL5}°C`
                        : "Belum ada data",
                      valueClassName: activeReadingL5
                        ? getStatusColor(statusL5)
                        : "text-muted-foreground",
                      iconBgColor: "bg-purple-500/10",
                      iconColor: "text-purple-600 dark:text-purple-400",
                    },
                    condition: {
                      icon: ShieldCheck,
                      label: "Kondisi Suhu L5",
                      value: !onlineL5
                        ? "-"
                        : statusL5 === "Bahaya"
                          ? "BAHAYA"
                          : statusL5 === "Waspada"
                            ? "WASPADA"
                            : "AMAN",
                      detail: !onlineL5
                        ? "Sensor suhu terputus"
                        : statusL5 === "Normal"
                          ? "Suhu ruangan normal"
                          : "Periksa kondisi AC Lantai 5",
                      valueClassName: !onlineL5
                        ? "text-muted-foreground"
                        : getStatusColor(statusL5),
                      iconBgColor: "bg-purple-500/10",
                      iconColor: "text-purple-600 dark:text-purple-400",
                    },
                  },
                ]}
                sensor={{
                  icon: Radio,
                  label: "Sensor L5",
                  value: onlineL5 ? "Online" : "Offline",
                  detail: onlineL5 && readingL5
                    ? `Update: ${clock(readingL5.recordedAt, true)}`
                    : "Belum ada data",
                  valueClassName: onlineL5
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                  iconBgColor: "bg-blue-500/10",
                  iconColor: "text-blue-600 dark:text-blue-400",
                }}
              />

              <div className="hidden" aria-hidden="true">
                <MetricStatistics02
                  items={[
                    {
                      icon: Thermometer,
                      label: "Suhu Ruangan L5",
                      value: activeReadingL5
                        ? `${Number(Number(activeReadingL5.temperature).toFixed(1))}°C`
                        : "--°C",
                      detail: activeReadingL5
                        ? `Status: ${statusL5} (<${warningTemperatureL5}°C)`
                        : "Belum ada data",
                      valueClassName: activeReadingL5
                        ? getStatusColor(statusL5)
                        : "text-muted-foreground",
                      iconBgColor: "bg-purple-500/10",
                      iconColor: "text-purple-600 dark:text-purple-400",
                    },
                    {
                      icon: Radio,
                      label: "Sensor L5",
                      value: onlineL5 ? "Online" : "Offline",
                      detail: onlineL5 && readingL5
                        ? `Update: ${clock(readingL5.recordedAt, true)}`
                        : "Belum ada data",
                      valueClassName: onlineL5
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400",
                      iconBgColor: "bg-blue-500/10",
                      iconColor: "text-blue-600 dark:text-blue-400",
                    },
                    {
                      icon: ShieldCheck,
                      label: "Kondisi Ruangan L5",
                      value: !onlineL5
                        ? "-"
                        : statusL5 === "Bahaya"
                          ? "BAHAYA"
                          : statusL5 === "Waspada"
                            ? "WASPADA"
                            : "AMAN",
                      detail: !onlineL5
                        ? "Sensor terputus"
                        : statusL5 === "Normal"
                          ? "Suhu ruangan normal"
                          : "Periksa kondisi AC Lantai 5",
                      valueClassName: !onlineL5
                        ? "text-muted-foreground"
                        : getStatusColor(statusL5),
                      iconBgColor: "bg-slate-100 dark:bg-slate-800",
                      iconColor: "text-slate-600 dark:text-slate-400",
                    },
                  ]}
                />

              </div>

              <CombinedTelemetryChart
                floor="5"
                data={chartData}
                chartTab={chartTab}
                onChartTabChange={setChartTab}
                period={period}
                onPeriodChange={setPeriod}
                loading={loadingHistory}
                temperatureDomain={temperatureDomain}
                voltageDomain={voltageDomain}
                currentDomain={currentDomain}
                warningTemperature={warningTemperatureL5}
                dangerTemperature={dangerTemperatureL5}
              />

              <div className="hidden" aria-hidden="true">
                <ChartControls
                  floor="5"
                  chartTab={chartTab}
                  onChartTabChange={setChartTab}
                  period={period}
                  onPeriodChange={setPeriod}
                />

                {/* Grid Tampilan Grafik L5 berdasarkan Tab Aktif */}
                <div className={chartTab === "all" ? "grid grid-cols-1 lg:grid-cols-3 gap-4" : "grid grid-cols-1 gap-4"}>
                  {(chartTab === "all" || chartTab === "suhu") && (
                    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{chartTab === "all" ? "Suhu" : "Grafik Tren Suhu Lantai 5"}</span>
                            <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 dark:border-slate-700 text-purple-600 dark:text-purple-400">
                              {periodConfigs[period].label}
                            </Badge>
                          </CardTitle>
                        </div>

                        {chartTab !== "all" && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-lg bg-purple-500/10 px-2.5 py-1 font-semibold text-purple-600 dark:text-purple-400">
                              Saat Ini: {readingL5 ? `${Number(Number(readingL5.temperature).toFixed(1))}°C` : "--°C"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Min: {minTemp !== null ? `${minTemp.toFixed(1)}°C` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Max: {maxTemp !== null ? `${maxTemp.toFixed(1)}°C` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Avg: {avgTemp !== null ? `${avgTemp.toFixed(1)}°C` : "--"}
                            </span>
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="h-80 pl-1 pr-4 pb-4">
                        {loadingHistory && chartData.length === 0 ? (
                          <ChartMessage loading message="Memuat grafik suhu..." />
                        ) : !hasTemperatureData ? (
                          <ChartMessage message="Belum ada data suhu pada periode ini." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -5, bottom: 5 }}>
                              <defs>
                                <linearGradient id="tempL5Grad" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0" stopColor="#8b5cf6" stopOpacity={0.2} />
                                  <stop offset="1" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={["dataMin", "dataMax"]}
                                tickCount={6}
                                tickFormatter={value =>
                                  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(value)))
                                }
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                                fontSize={11}
                                tick={{ fill: "var(--muted-foreground)" }}
                              />
                              <YAxis domain={temperatureDomain} axisLine={false} tickLine={false} fontSize={11} width={48} tickFormatter={value => String(Number(value))} tick={{ fill: "var(--muted-foreground)" }} />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="rounded-xl border border-border bg-popover p-2.5 shadow-md text-popover-foreground text-xs font-semibold">
                                        <p className="font-mono text-muted-foreground mb-1">{fullDateTime(Number(label))}</p>
                                        {payload.map((p, idx) => (
                                          <p key={idx} className="flex items-center gap-1.5 text-xs">
                                            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
                                            <span className="text-muted-foreground font-medium">Suhu:</span>
                                            <span className="font-bold">{Number(Number(p.value).toFixed(1))}°C</span>
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  }
                                  return null
                                }}
                              />
                              <ReferenceLine y={dangerTemperatureL5} ifOverflow="extendDomain" stroke="#fb7185" strokeDasharray="5 4" label={{ value: `Bahaya (≥${dangerTemperatureL5}°C)`, fill: "#f43f5e", fontSize: 10, position: "insideTopLeft" }} />
                              <ReferenceLine y={warningTemperatureL5} ifOverflow="extendDomain" stroke="#f59e0b" strokeDasharray="5 4" label={{ value: `Waspada (≥${warningTemperatureL5}°C)`, fill: "#d97706", fontSize: 10, position: "insideTopLeft" }} />
                              <Area type="monotone" dataKey="temperature" stroke="#8b5cf6" strokeWidth={2.4} fill="url(#tempL5Grad)" connectNulls isAnimationActive={false} dot={chartData.length === 1 ? { r: 4, fill: "#8b5cf6", strokeWidth: 0 } : false} activeDot={{ r: 5, fill: "#7c3aed" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {(chartTab === "all" || chartTab === "tegangan") && (
                    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{chartTab === "all" ? "Tegangan" : "Grafik Tegangan Listrik L5"}</span>
                            <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 dark:border-slate-700 text-amber-600 dark:text-amber-400">
                              {periodConfigs[period].label}
                            </Badge>
                          </CardTitle>
                        </div>

                        {chartTab !== "all" && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 font-semibold text-amber-600 dark:text-amber-400">
                              Saat Ini: {voltageL5 !== null ? `${voltageL5.toFixed(1)} V` : "-- V"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Min: {minVolt !== null ? `${minVolt.toFixed(1)} V` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Max: {maxVolt !== null ? `${maxVolt.toFixed(1)} V` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Avg: {avgVolt !== null ? `${avgVolt.toFixed(1)} V` : "--"}
                            </span>
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="h-80 pl-1 pr-4 pb-4">
                        {loadingHistory && chartData.length === 0 ? (
                          <ChartMessage loading message="Memuat grafik tegangan..." />
                        ) : !hasVoltageData ? (
                          <ChartMessage message="Belum ada data tegangan dari sensor." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -5, bottom: 5 }}>
                              <defs>
                                <linearGradient id="voltL5Grad" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0" stopColor="#d97706" stopOpacity={0.15} />
                                  <stop offset="1" stopColor="#d97706" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={["dataMin", "dataMax"]}
                                tickCount={6}
                                tickFormatter={value =>
                                  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(value)))
                                }
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                                fontSize={11}
                                tick={{ fill: "var(--muted-foreground)" }}
                              />
                              <YAxis domain={voltageDomain} ticks={[200, 210, 220, 230, 240]} axisLine={false} tickLine={false} fontSize={11} width={48} tickFormatter={value => String(Number(value))} tick={{ fill: "var(--muted-foreground)" }} />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="rounded-xl border border-border bg-popover p-2.5 shadow-md text-popover-foreground text-xs font-semibold">
                                        <p className="font-mono text-muted-foreground mb-1">{fullDateTime(Number(label))}</p>
                                        {payload.map((p, idx) => (
                                          <p key={idx} className="flex items-center gap-1.5 text-xs">
                                            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
                                            <span className="text-muted-foreground font-medium">Tegangan:</span>
                                            <span className="font-bold">{Number(Number(p.value).toFixed(1))} V</span>
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  }
                                  return null
                                }}
                              />
                              <ReferenceLine y={220} ifOverflow="extendDomain" stroke="#3b82f6" strokeDasharray="4 4" label={{ value: "Target 220 V", fill: "#2563eb", fontSize: 10, position: "insideTopLeft" }} />
                              <ReferenceLine y={200} ifOverflow="extendDomain" stroke="#f43f5e" strokeDasharray="4 4" />
                              <ReferenceLine y={240} ifOverflow="extendDomain" stroke="#f43f5e" strokeDasharray="4 4" />
                              <Area type="monotone" dataKey="voltage" stroke="#d97706" strokeWidth={2.4} fill="url(#voltL5Grad)" connectNulls isAnimationActive={false} dot={chartData.length === 1 ? { r: 4, fill: "#d97706", strokeWidth: 0 } : false} activeDot={{ r: 5, fill: "#b45309" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {(chartTab === "all" || chartTab === "arus") && (
                    <Card className="overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl">
                      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{chartTab === "all" ? "Arus" : "Grafik Arus Listrik L5"}</span>
                            <Badge variant="outline" className="text-[10px] font-semibold border-slate-200 dark:border-slate-700 text-cyan-600 dark:text-cyan-400">
                              {periodConfigs[period].label}
                            </Badge>
                          </CardTitle>
                        </div>

                        {chartTab !== "all" && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="rounded-lg bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-600 dark:text-cyan-400">
                              Saat Ini: {currentL5 !== null ? `${currentL5.toFixed(2)} A` : "-- A"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Min: {minCurr !== null ? `${minCurr.toFixed(2)} A` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Max: {maxCurr !== null ? `${maxCurr.toFixed(2)} A` : "--"}
                            </span>
                            <span className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2 py-1 font-medium text-slate-600 dark:text-slate-300">
                              Avg: {avgCurr !== null ? `${avgCurr.toFixed(2)} A` : "--"}
                            </span>
                          </div>
                        )}
                      </CardHeader>

                      <CardContent className="h-80 pl-1 pr-4 pb-4">
                        {loadingHistory && chartData.length === 0 ? (
                          <ChartMessage loading message="Memuat grafik arus..." />
                        ) : !hasCurrentData ? (
                          <ChartMessage message="Belum ada data arus dari sensor." />
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={chartData} margin={{ top: 16, right: 20, left: -5, bottom: 5 }}>
                              <defs>
                                <linearGradient id="currL5Grad" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0" stopColor="#06b6d4" stopOpacity={0.2} />
                                  <stop offset="1" stopColor="#06b6d4" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid vertical={false} stroke="var(--border)" />
                              <XAxis
                                dataKey="timestamp"
                                type="number"
                                scale="time"
                                domain={["dataMin", "dataMax"]}
                                tickCount={6}
                                tickFormatter={value =>
                                  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(value)))
                                }
                                axisLine={false}
                                tickLine={false}
                                minTickGap={45}
                                fontSize={11}
                                tick={{ fill: "var(--muted-foreground)" }}
                              />
                              <YAxis domain={currentDomain} axisLine={false} tickLine={false} fontSize={11} width={48} tickFormatter={value => `${Number(value).toFixed(1)}`} tick={{ fill: "var(--muted-foreground)" }} />
                              <Tooltip
                                content={({ active, payload, label }) => {
                                  if (active && payload && payload.length) {
                                    return (
                                      <div className="rounded-xl border border-border bg-popover p-2.5 shadow-md text-popover-foreground text-xs font-semibold">
                                        <p className="font-mono text-muted-foreground mb-1">{fullDateTime(Number(label))}</p>
                                        {payload.map((p, idx) => (
                                          <p key={idx} className="flex items-center gap-1.5 text-xs">
                                            <span className="size-1.5 rounded-full" style={{ backgroundColor: p.color || p.stroke }} />
                                            <span className="text-muted-foreground font-medium">Arus:</span>
                                            <span className="font-bold">{Number(Number(p.value).toFixed(2))} A</span>
                                          </p>
                                        ))}
                                      </div>
                                    )
                                  }
                                  return null
                                }}
                              />
                              <Area type="monotone" dataKey="current" stroke="#06b6d4" strokeWidth={2.2} fill="url(#currL5Grad)" connectNulls isAnimationActive={false} dot={chartData.length === 1 ? { r: 4, fill: "#06b6d4", strokeWidth: 0 } : false} activeDot={{ r: 5, fill: "#0891b2" }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section Ambang Batas Suhu & Ringkasan - Dihide terlebih dahulu */}
          {/*
          <section className="mt-6 grid gap-6 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">
                  Ambang Batas Suhu
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-2">
                <Limit
                  color="bg-emerald-500"
                  label="Normal"
                  value={`< ${activeWarningTemperature}°C`}
                />

                <Limit
                  color="bg-amber-400"
                  label="Waspada"
                  value={`${activeWarningTemperature}°C – < ${activeDangerTemperature}°C`}
                />

                <Limit
                  color="bg-rose-500"
                  label="Bahaya"
                  value={`≥ ${activeDangerTemperature}°C`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold">
                  Ringkasan{" "}
                  {
                    periodConfigs[
                      period
                    ].label
                  }{" "}
                  (
                  {activeFloor === "4"
                    ? "Lantai 4"
                    : "Lantai 5"}
                  )
                </CardTitle>
              </CardHeader>

              <CardContent className="divide-y">
                <SummaryRow
                  icon={TrendingUp}
                  label="Suhu Tertinggi"
                  value={
                    maxTemp !== null
                      ? `${Number(Number(maxTemp).toFixed(1))}°C`
                      : "--°C"
                  }
                  color="bg-rose-500/10 text-rose-600 dark:text-rose-400"
                />

                <SummaryRow
                  icon={TrendingDown}
                  label="Suhu Terendah"
                  value={
                    minTemp !== null
                      ? `${Number(Number(minTemp).toFixed(1))}°C`
                      : "--°C"
                  }
                  color="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                />

                <SummaryRow
                  icon={Activity}
                  label="Rata-rata Suhu"
                  value={
                    avgTemp !== null
                      ? `${Number(Number(avgTemp).toFixed(1))}°C`
                      : "--°C"
                  }
                  color="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                />
              </CardContent>
            </Card>
          </section>
          */}

          <section className="mt-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  5 Pembacaan Terakhir
                </CardTitle>

                <Link
                  href="/riwayat"
                  className="text-xs font-semibold text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  Lihat Semua Riwayat
                </Link>
              </CardHeader>

              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">
                        Waktu
                      </TableHead>

                      <TableHead>
                        Identitas Sensor
                      </TableHead>

                      <TableHead>
                        Suhu (°C)
                      </TableHead>

                      {activeFloor === "4" && (
                        <>
                          <TableHead>
                            Tegangan (V)
                          </TableHead>

                          <TableHead>
                            Arus (A)
                          </TableHead>
                        </>
                      )}

                      <TableHead className="pr-6">
                        Status
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {recentReadings.length >
                      0 ? (
                      recentReadings.map(
                        row => {
                          const status =
                            getTempStatus(
                              row.temperature,
                            )

                          return (
                            <TableRow
                              key={`${row.sensorId}-${row.id}`}
                            >
                              <TableCell className="pl-6">
                                {fullDateTime(
                                  row.recordedAt,
                                )}
                              </TableCell>

                              <TableCell>
                                <code className="rounded bg-muted px-2 py-1 font-mono text-xs font-medium text-foreground/80">
                                  {getSensorLabel(
                                    row.sensorId,
                                  )}
                                </code>
                              </TableCell>

                              <TableCell className="font-semibold text-foreground">
                                {Number(Number(row.temperature).toFixed(1))}
                                °C
                              </TableCell>

                              {activeFloor === "4" && (
                                <>
                                  <TableCell className="text-muted-foreground">
                                    {row.voltage !== null
                                      ? `${Number(Number(row.voltage).toFixed(1))} V`
                                      : "-- V"}
                                  </TableCell>

                                  <TableCell className="text-muted-foreground">
                                    {row.current !== null && row.current !== undefined
                                      ? `${Number(Number(row.current).toFixed(2))} A`
                                      : "-- A"}
                                  </TableCell>
                                </>
                              )}

                              <TableCell className="pr-6">
                                <Badge
                                  variant="secondary"
                                  className={getStatusBackground(
                                    status,
                                  )}
                                >
                                  ● {status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )
                        },
                      )
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={activeFloor === "4" ? 6 : 4}
                          className="h-20 text-center text-muted-foreground"
                        >
                          Menunggu pengiriman data dari sensor...
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </AppShell>
  )
}

function CombinedTelemetryChart({
  floor,
  data,
  chartTab,
  onChartTabChange,
  period,
  onPeriodChange,
  loading,
  temperatureDomain,
  voltageDomain,
  currentDomain,
  warningTemperature,
  dangerTemperature,
  voltageMin = 200,
  voltageMax = 240,
}: {
  floor: Floor
  data: ChartReading[]
  chartTab: ChartTab
  onChartTabChange: (value: ChartTab) => void
  period: Period
  onPeriodChange: (value: Period) => void
  loading: boolean
  temperatureDomain: [number, number]
  voltageDomain: [number, number]
  currentDomain: [number, number]
  warningTemperature: number
  dangerTemperature: number
  voltageMin?: number
  voltageMax?: number
}) {
  const [hoveredMetric, setHoveredMetric] =
    useState<ChartMetric | null>(null)
  const supportedMetrics = FLOOR_CHART_METRICS[floor]
  const effectiveChartTab: ChartMetric =
    floor === "5" || chartTab === "all"
      ? "suhu"
      : chartTab
  const visibleMetrics: ChartMetric[] = [effectiveChartTab]
  const hasData: Record<ChartMetric, boolean> = {
    suhu: data.some(reading =>
      Number.isFinite(reading.temperature),
    ),
    tegangan:
      supportedMetrics.includes("tegangan") &&
      data.some(
        reading =>
          reading.voltage !== null &&
          Number.isFinite(reading.voltage),
      ),
    arus:
      supportedMetrics.includes("arus") &&
      data.some(
        reading =>
          reading.current !== null &&
          Number.isFinite(reading.current),
      ),
  }
  const hasVisibleData = visibleMetrics.some(
    metric => hasData[metric],
  )
  const timeline = useMemo(
    () => getChartTimeline(data, period),
    [data, period],
  )
  const displayedMetric = hoveredMetric ?? effectiveChartTab
  const indicatorDomain =
    displayedMetric === "suhu"
      ? temperatureDomain
      : displayedMetric === "tegangan"
        ? voltageDomain
        : displayedMetric === "arus"
          ? currentDomain
          : [0, 1]
  const indicatorTicks = displayedMetric
    ? getIntegerAxisTicks(
      indicatorDomain as [number, number],
    )
    : []
  const metricDetails: Record<
    ChartMetric,
    {
      color: string
      label: string
      unit: string
    }
  > = {
    suhu: {
      color: "#10b981",
      label: "Suhu",
      unit: "°C",
    },
    tegangan: {
      color: "#f59e0b",
      label: "Tegangan",
      unit: "V",
    },
    arus: {
      color: "#06b6d4",
      label: "Arus",
      unit: "A",
    },
  }
  const hoveredValues: number[] = displayedMetric
    ? data
      .map(reading => {
        if (displayedMetric === "suhu") {
          return reading.temperature
        }

        if (displayedMetric === "tegangan") {
          return reading.voltage
        }

        return reading.current
      })
      .filter(
        (value): value is number =>
          value !== null && Number.isFinite(value),
      )
    : []
  const hoveredStats =
    displayedMetric && hoveredValues.length > 0
      ? {
        current: hoveredValues.at(-1) ?? null,
        minimum: Math.min(...hoveredValues),
        maximum: Math.max(...hoveredValues),
        average:
          hoveredValues.reduce(
            (total, value) => total + value,
            0,
          ) / hoveredValues.length,
      }
      : null

  const formatSummaryValue = (
    value: number | null | undefined,
  ): string => {
    if (
      !displayedMetric ||
      value === null ||
      value === undefined
    ) {
      return "--"
    }

    const precision =
      displayedMetric === "arus" ? 2 : 1

    return `${Number(value.toFixed(precision))} ${metricDetails[displayedMetric].unit}`
  }

  return (
    <Card className="mt-6 overflow-hidden rounded-2xl border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <CardHeader className="gap-5 border-b border-slate-100 pb-4 dark:border-slate-800/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#005A9C]/10 text-[#005A9C] dark:bg-blue-500/10 dark:text-blue-400">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                Grafik Telemetri Lantai {floor}
              </CardTitle>
              <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                {floor === "4"
                  ? "Data suhu, tegangan, dan arus"
                  : "Data suhu ruang ATC"} · {periodConfigs[period].label}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            {floor === "4" && (
              <div className="min-w-0">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Tampilan
                </span>
                <AnimatedTabs
                  tabs={[
                    { value: "suhu", label: "Suhu", icon: Thermometer },
                    { value: "tegangan", label: "Tegangan", icon: Zap },
                    { value: "arus", label: "Arus", icon: Activity },
                  ]}
                  value={effectiveChartTab}
                  onValueChange={value =>
                    onChartTabChange(value as ChartTab)
                  }
                  indicatorId={`combined-chart-tabs-l${floor}`}
                />
              </div>
            )}

            <div className="min-w-0">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Periode
              </span>
              <AnimatedTabsNoIcon
                tabs={[
                  { value: "1", label: "1 Jam" },
                  { value: "6", label: "6 Jam" },
                  { value: "24", label: "24 Jam" },
                ]}
                value={period}
                onValueChange={value =>
                  onPeriodChange(value as Period)
                }
                indicatorId={`combined-chart-period-l${floor}`}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-950/30 lg:flex-row lg:items-center">
          <div className="min-w-36 px-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Ringkasan Metrik
            </p>
            <p className="mt-0.5 text-xs font-bold text-slate-700 dark:text-slate-200">
              {displayedMetric
                ? metricDetails[displayedMetric].label
                : "Hover salah satu grafik"}
            </p>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              {
                label: "Sekarang",
                value: hoveredStats?.current,
              },
              {
                label: "Min",
                value: hoveredStats?.minimum,
              },
              {
                label: "Max",
                value: hoveredStats?.maximum,
              },
              {
                label: "Avg",
                value: hoveredStats?.average,
              },
            ].map(item => (
              <div
                key={item.label}
                className="rounded-lg border border-slate-200/70 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {item.label}
                </span>
                <span
                  className="mt-0.5 block text-sm font-extrabold text-slate-700 dark:text-slate-200"
                  style={displayedMetric
                    ? { color: metricDetails[displayedMetric].color }
                    : undefined}
                >
                  {formatSummaryValue(item.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="h-[390px] px-3 pb-4 pt-4 sm:px-5">
        {loading && data.length === 0 ? (
          <ChartMessage loading message="Memuat grafik telemetri..." />
        ) : !hasVisibleData ? (
          <ChartMessage message="Belum ada data telemetri pada periode ini." />
        ) : (
          <div className="relative h-full">
            <div
              className={cn(
                "pointer-events-none absolute bottom-7 left-0 top-2 z-10 flex w-11 flex-col justify-between border-r border-slate-200/70 pr-2 text-right transition-opacity dark:border-slate-800",
                displayedMetric ? "opacity-100" : "opacity-0",
              )}
              aria-hidden={!displayedMetric}
            >
              {indicatorTicks.map(value => (
                <span
                  key={value}
                  className="text-[10px] font-semibold leading-none text-slate-500 dark:text-slate-400"
                >
                  {value}
                </span>
              ))}
            </div>

            <div className="h-full pl-12">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data}
                  margin={{ top: 10, right: 18, left: 0, bottom: 16 }}
                  onMouseLeave={() => setHoveredMetric(null)}
                >
                  <defs>
                    <linearGradient id={`combinedTempL${floor}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="1" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`combinedVoltL${floor}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#f59e0b" stopOpacity={0.16} />
                      <stop offset="1" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id={`combinedCurrentL${floor}`} x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#06b6d4" stopOpacity={0.16} />
                      <stop offset="1" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={timeline.domain}
                    ticks={timeline.ticks}
                    interval={0}
                    axisLine={false}
                    tickLine={false}
                    height={36}
                    tick={props => {
                      const { x, y, payload } = props
                      if (!payload || payload.value === undefined) return null

                      const valueNum = Number(payload.value)
                      const isLatest =
                        timeline.latestTimestamp !== undefined &&
                        Math.abs(valueNum - timeline.latestTimestamp) < 1000

                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text
                            x={0}
                            y={0}
                            dy={isLatest ? 22 : 10}
                            textAnchor="middle"
                            fill={isLatest ? "#10b981" : "var(--muted-foreground)"}
                            fontSize={11}
                            fontWeight={isLatest ? 600 : 400}
                          >
                            {isLatest
                              ? `Sekarang (${formatAxisClock(valueNum)})`
                              : formatAxisClock(valueNum)}
                          </text>
                        </g>
                      )
                    }}
                  />

                  <YAxis yAxisId="suhu" domain={temperatureDomain} hide />
                  <YAxis yAxisId="tegangan" domain={voltageDomain} hide />
                  <YAxis yAxisId="arus" domain={currentDomain} hide />

                  {timeline.latestTimestamp && (
                    <ReferenceLine
                      x={timeline.latestTimestamp}
                      stroke="#10b981"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                    />
                  )}

                  {displayedMetric === "suhu" && (
                    <>
                      <ReferenceLine
                        yAxisId="suhu"
                        y={dangerTemperature}
                        ifOverflow="extendDomain"
                        stroke="#fb7185"
                        strokeDasharray="5 4"
                        label={{
                          value: `Bahaya (≥${dangerTemperature}°C)`,
                          fill: "#f43f5e",
                          fontSize: 10,
                          position: "insideTopLeft",
                        }}
                      />
                      <ReferenceLine
                        yAxisId="suhu"
                        y={warningTemperature}
                        ifOverflow="extendDomain"
                        stroke="#f59e0b"
                        strokeDasharray="5 4"
                        label={{
                          value: `Waspada (≥${warningTemperature}°C)`,
                          fill: "#d97706",
                          fontSize: 10,
                          position: "insideTopLeft",
                        }}
                      />
                    </>
                  )}

                  {displayedMetric === "tegangan" && (
                    <>
                      <ReferenceLine
                        yAxisId="tegangan"
                        y={VOLTAGE_TARGET}
                        ifOverflow="extendDomain"
                        stroke="#3b82f6"
                        strokeDasharray="4 4"
                        label={{
                          value: `Target ${VOLTAGE_TARGET} V`,
                          fill: "#2563eb",
                          fontSize: 10,
                          position: "insideTopLeft",
                        }}
                      />
                      <ReferenceLine
                        yAxisId="tegangan"
                        y={voltageMin}
                        ifOverflow="extendDomain"
                        stroke="#f43f5e"
                        strokeDasharray="4 4"
                        label={{
                          value: `Batas minimum ${voltageMin} V`,
                          fill: "#f43f5e",
                          fontSize: 10,
                          position: "insideBottomLeft",
                        }}
                      />
                      <ReferenceLine
                        yAxisId="tegangan"
                        y={voltageMax}
                        ifOverflow="extendDomain"
                        stroke="#f43f5e"
                        strokeDasharray="4 4"
                        label={{
                          value: `Batas maksimum ${voltageMax} V`,
                          fill: "#f43f5e",
                          fontSize: 10,
                          position: "insideTopLeft",
                        }}
                      />
                    </>
                  )}

                  {displayedMetric === "arus" && (
                    <ReferenceLine
                      yAxisId="arus"
                      y={CURRENT_CAPACITY}
                      ifOverflow="extendDomain"
                      stroke="#f43f5e"
                      strokeDasharray="5 4"
                      label={{
                        value: `Batas kapasitas ${CURRENT_CAPACITY} A`,
                        fill: "#f43f5e",
                        fontSize: 10,
                        position: "insideTopLeft",
                      }}
                    />
                  )}

                  <Tooltip
                    cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4", strokeOpacity: 0.45 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) {
                        return null
                      }

                      const uniquePayload = payload.filter(
                        (item, index, items) =>
                          items.findIndex(
                            candidate =>
                              String(candidate.dataKey) ===
                              String(item.dataKey),
                          ) === index,
                      )

                      return (
                        <div className="rounded-xl border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
                          <p className="mb-1.5 font-mono font-semibold text-muted-foreground">
                            {fullDateTime(Number(label))}
                          </p>
                          {uniquePayload.map(item => {
                            const key = String(item.dataKey) as "temperature" | "voltage" | "current"
                            const metric: ChartMetric =
                              key === "temperature"
                                ? "suhu"
                                : key === "voltage"
                                  ? "tegangan"
                                  : "arus"
                            const detail = metricDetails[metric]
                            const precision = metric === "arus" ? 2 : 1

                            return (
                              <p key={key} className="flex items-center gap-2 py-0.5">
                                <span className="size-1.5 rounded-full" style={{ backgroundColor: detail.color }} />
                                <span className="text-muted-foreground">{detail.label}:</span>
                                <span className="font-bold">
                                  {Number(item.value).toFixed(precision)} {detail.unit}
                                </span>
                              </p>
                            )
                          })}
                        </div>
                      )
                    }}
                  />

                  {visibleMetrics.includes("suhu") && hasData.suhu && (
                    <Area
                      yAxisId="suhu"
                      type="monotone"
                      dataKey="temperature"
                      name="Suhu"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fill={`url(#combinedTempL${floor})`}
                      connectNulls
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 4, fill: "#059669" }}
                      onMouseEnter={() => setHoveredMetric("suhu")}
                    />
                  )}
                  {visibleMetrics.includes("tegangan") && hasData.tegangan && (
                    <Area
                      yAxisId="tegangan"
                      type="monotone"
                      dataKey="voltage"
                      name="Tegangan"
                      stroke="#f59e0b"
                      strokeWidth={2.4}
                      fill={`url(#combinedVoltL${floor})`}
                      connectNulls
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 4, fill: "#d97706" }}
                      onMouseEnter={() => setHoveredMetric("tegangan")}
                    />
                  )}
                  {visibleMetrics.includes("arus") && hasData.arus && (
                    <Area
                      yAxisId="arus"
                      type="monotone"
                      dataKey="current"
                      name="Arus"
                      stroke="#06b6d4"
                      strokeWidth={2.4}
                      fill={`url(#combinedCurrentL${floor})`}
                      connectNulls
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 4, fill: "#0891b2" }}
                      onMouseEnter={() => setHoveredMetric("arus")}
                    />
                  )}

                  {visibleMetrics.includes("suhu") && hasData.suhu && (
                    <Line
                      yAxisId="suhu"
                      type="monotone"
                      dataKey="temperature"
                      stroke="#10b981"
                      strokeOpacity={0.001}
                      strokeWidth={16}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      tooltipType="none"
                      style={{ cursor: "crosshair", pointerEvents: "stroke" }}
                      onMouseEnter={() => setHoveredMetric("suhu")}
                    />
                  )}
                  {visibleMetrics.includes("tegangan") && hasData.tegangan && (
                    <Line
                      yAxisId="tegangan"
                      type="monotone"
                      dataKey="voltage"
                      stroke="#f59e0b"
                      strokeOpacity={0.001}
                      strokeWidth={16}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      tooltipType="none"
                      style={{ cursor: "crosshair", pointerEvents: "stroke" }}
                      onMouseEnter={() => setHoveredMetric("tegangan")}
                    />
                  )}
                  {visibleMetrics.includes("arus") && hasData.arus && (
                    <Line
                      yAxisId="arus"
                      type="monotone"
                      dataKey="current"
                      stroke="#06b6d4"
                      strokeOpacity={0.001}
                      strokeWidth={16}
                      dot={false}
                      activeDot={false}
                      isAnimationActive={false}
                      tooltipType="none"
                      style={{ cursor: "crosshair", pointerEvents: "stroke" }}
                      onMouseEnter={() => setHoveredMetric("arus")}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ChartControls({
  floor,
  chartTab,
  onChartTabChange,
  period,
  onPeriodChange,
}: {
  floor: Floor
  chartTab: ChartTab
  onChartTabChange: (value: ChartTab) => void
  period: Period
  onPeriodChange: (value: Period) => void
}) {
  return (
    <div className="mb-4 mt-6 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
      <div className="min-w-0">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Tampilan Grafik
        </span>
        <AnimatedTabs
          tabs={[
            {
              value: "all",
              label: "Semua Grafik",
              icon: LayoutGrid,
            },
            {
              value: "suhu",
              label: "Suhu (°C)",
              icon: Thermometer,
            },
            {
              value: "tegangan",
              label: "Tegangan (V)",
              icon: Zap,
            },
            {
              value: "arus",
              label: "Arus (A)",
              icon: Activity,
            },
          ]}
          value={chartTab}
          onValueChange={value =>
            onChartTabChange(
              value as ChartTab,
            )
          }
          indicatorId={`chart-tabs-l${floor}`}
        />
      </div>

      <div className="min-w-0 xl:justify-self-end">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Periode
        </span>
        <AnimatedTabsNoIcon
          tabs={[
            { value: "1", label: "1 Jam" },
            { value: "6", label: "6 Jam" },
            { value: "24", label: "24 Jam" },
          ]}
          value={period}
          onValueChange={value =>
            onPeriodChange(value as Period)
          }
          indicatorId={`dashboard-period-tabs-l${floor}`}
        />
      </div>
    </div>
  )
}

function HeaderClock() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())

    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return (
    <div className="hidden items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 md:flex">
      <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
      <span className="font-mono font-bold text-slate-900 dark:text-white">
        {now ? `${clock(now, true)} WIB` : "--:--:--"}
      </span>
      <span className="text-slate-300 dark:text-slate-700">|</span>
      <span className="font-medium text-slate-500 dark:text-slate-400">
        {now ? fullDate(now) : "Memuat..."}
      </span>
    </div>
  )
}

function ChartMessage({
  loading = false,
  message,
}: {
  loading?: boolean
  message: string
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200/80 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/30">
      <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
        {loading ? (
          <LoaderCircle className="size-7 animate-spin text-[#005A9C]" />
        ) : (
          <Activity className="size-8 text-slate-300 dark:text-slate-700" />
        )}

        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {message}
        </p>
      </div>
    </div>
  )
}

interface MetricItemData {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
  valueClassName?: string
  iconBgColor?: string
  iconColor?: string
}

interface MetricPairData {
  metric: MetricItemData
  condition: MetricItemData
}

function MetricContent({ item }: { item: MetricItemData }) {
  const Icon = item.icon

  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-2.5 p-3.5 sm:p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-1.5">
        <p className="min-h-6 text-[10px] font-bold uppercase leading-tight tracking-wider text-slate-500 dark:text-slate-400">
          {item.label}
        </p>
        <div>
          <p
            className={cn(
              "whitespace-nowrap text-lg sm:text-xl font-extrabold tracking-tight",
              item.valueClassName ?? "text-slate-900 dark:text-white",
            )}
          >
            {item.value}
          </p>
          <p className="mt-0.5 text-[10px] font-medium leading-snug text-slate-400 dark:text-slate-500">
            {item.detail}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "grid size-9 sm:size-10 shrink-0 place-items-center rounded-xl",
          item.iconBgColor ?? "bg-slate-100 dark:bg-slate-800",
        )}
      >
        <Icon
          className={cn(
            "size-4 sm:size-4.5",
            item.iconColor ?? "text-slate-600 dark:text-slate-300",
          )}
        />
      </div>
    </div>
  )
}

function PairedMetricGrid({
  pairs,
  sensor,
}: {
  pairs: MetricPairData[]
  sensor: MetricItemData
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-3.5",
        pairs.length === 1
          ? "md:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]"
          : "md:grid-cols-2 min-[1800px]:grid-cols-4",
      )}
    >
      {pairs.map(pair => (
        <Card
          key={pair.metric.label}
          className="overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <CardContent className="grid h-full grid-cols-1 divide-y divide-slate-100 p-0 dark:divide-slate-800/80 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <MetricContent item={pair.metric} />
            <MetricContent item={pair.condition} />
          </CardContent>
        </Card>
      ))}

      <Card className="overflow-hidden rounded-2xl border-slate-200/80 bg-white p-0 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <CardContent className="flex h-full p-0">
          <MetricContent item={sensor} />
        </CardContent>
      </Card>
    </div>
  )
}

function MetricStatistics02({ items }: { items: MetricItemData[] }) {
  return (
    <Card className="p-0 border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 rounded-2xl overflow-hidden">
      <CardContent className="flex items-stretch w-full lg:flex-nowrap flex-wrap px-0">
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <div
              key={index}
              className="w-full sm:w-1/2 lg:w-auto lg:flex-1 border-slate-100 dark:border-slate-800/80 border-b lg:border-b-0 border-e sm:odd:border-e lg:even:border-e lg:border-e lg:last:border-e-0 last:border-b-0 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
            >
              <div className="p-5 flex items-start justify-between gap-3 h-full">
                <div className="flex flex-col justify-between gap-2 min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                    {item.label}
                  </p>
                  <div>
                    <p
                      className={cn(
                        "text-2xl font-extrabold tracking-tight truncate",
                        item.valueClassName || "text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {item.value}
                    </p>
                    <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 truncate mt-1">
                      {item.detail}
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    "p-3 rounded-2xl shrink-0 flex items-center justify-center",
                    item.iconBgColor || "bg-slate-100 dark:bg-slate-800"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-5",
                      item.iconColor || "text-slate-600 dark:text-slate-300"
                    )}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}




