export type MonitoringSettings = {
  warningTemperature: number
  dangerTemperature: number
  warningTemperatureL5: number
  dangerTemperatureL5: number
  voltageMin: number
  voltageMax: number
  refreshInterval: number
  offlineTimeout: number
  sensorName: string
  sensorId: string
  browserNotification: boolean
  soundAlert: boolean
}

export const defaultMonitoringSettings: MonitoringSettings = {
  warningTemperature: 27,
  dangerTemperature: 30,
  warningTemperatureL5: 27,
  dangerTemperatureL5: 30,
  voltageMin: 200,
  voltageMax: 240,
  refreshInterval: 4,
  offlineTimeout: 60,
  sensorName: "Sensor Ruang Server",
  sensorId: "esp32-01",
  browserNotification: true,
  soundAlert: false,
}

export const monitoringSettingsKey = "server-room-settings"

export function readMonitoringSettings(): MonitoringSettings {
  try {
    const value = localStorage.getItem(monitoringSettingsKey)
    return value ? { ...defaultMonitoringSettings, ...JSON.parse(value) } : defaultMonitoringSettings
  } catch {
    return defaultMonitoringSettings
  }
}
