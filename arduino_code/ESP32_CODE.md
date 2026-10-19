#include "secrets.h"

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ==================================================
// DEBUG
// ==================================================

#define DEBUG 1

#if DEBUG
  #define DEBUG_PRINT(x) Serial.print(x)
  #define DEBUG_PRINTLN(x) Serial.println(x)
#else
  #define DEBUG_PRINT(x)
  #define DEBUG_PRINTLN(x)
#endif

// ==================================================
// KONFIGURASI PIN SENSOR SUHU
// ==================================================

#define ONE_WIRE_BUS_L4 4
#define ONE_WIRE_BUS_L5 5

OneWire oneWireL4(ONE_WIRE_BUS_L4);
OneWire oneWireL5(ONE_WIRE_BUS_L5);

DallasTemperature sensorL4(&oneWireL4);
DallasTemperature sensorL5(&oneWireL5);

// ID harus sama dengan API dan dashboard.
const char* SENSOR_ID_L4 = "TEMP-L4";
const char* SENSOR_ID_L5 = "TEMP-L5";

// ==================================================
// KONFIGURASI SENSOR TEGANGAN (ZMPT101B)
// ==================================================
//
// GPIO 34 = ADC1 (input-only), aman dipakai bersamaan
// dengan Wi-Fi (ADC2 sering error saat Wi-Fi aktif).
//
// Saran hardware: tambahkan resistor pull-down 10k dari
// GPIO34 ke GND supaya pin tidak "mengambang" saat modul
// belum diberi daya.
//

#define PIN_ZMPT101B 34

const int ADC_RESOLUTION = 4095; // ESP32 ADC 12-bit
const float ADC_VREF = 3.3f;     // Perkiraan, ADC ESP32 tidak 100% linear

/*
 * PERBAIKAN PEMBACAAN TEGANGAN (naik-turun 195-220 V)
 * ----------------------------------------------------
 * Penyebab utama pembacaan tidak stabil di versi lama:
 *
 * 1) Jendela sampling hanya 40 ms dan dibatasi array 800
 *    sampel. Kalau analogRead() cukup cepat, array penuh
 *    sebelum 40 ms habis -> RMS dihitung dari kurang dari
 *    2 gelombang penuh -> hasil bergoyang. Sekarang tidak
 *    memakai array lagi (cukup jumlah & jumlah kuadrat
 *    berjalan), sehingga TIDAK ADA batas sampel.
 *
 * 2) Jendela diperpanjang jadi 100 ms (5 gelombang penuh
 *    pada 50 Hz) supaya hasil lebih tahan terhadap
 *    frekuensi PLN yang sedikit bergeser & noise Wi-Fi.
 *
 * 3) Tiap pembacaan = median dari 3 jendela, lalu dihaluskan
 *    dengan filter EMA, jadi satu lonjakan noise tidak
 *    langsung muncul di tampilan.
 *
 * 4) Pengurangan baseline sekarang secara kuadratik
 *    (sqrt(rms^2 - base^2)), bukan pengurangan langsung.
 *    Noise & sinyal AC bergabung secara kuadrat, jadi cara
 *    ini lebih benar.
 */
const unsigned long DURASI_SAMPEL_US = 100000UL; // 100 ms = 5 gelombang @50Hz
const byte JUMLAH_JENDELA_MEDIAN = 3;
const float EMA_ALPHA = 0.2f;                    // 0..1, makin kecil makin halus
const byte MAKS_TOLAK_BERUNTUN = 5;

const int TOLERANSI_MENTOK_PERSEN = 5; // di atas ini, bacaan ditolak

// Ambang noise (dalam satuan ADC count RMS).
// Tuning lewat log "[ZMPT101B] Setelah baseline: ..."
// saat modul tidak tersambung listrik.
//
// Pin mengambang bisa menghasilkan RMS noise sampai ~50-60
// count. Sinyal PLN 220V yang asli sekitar ~500 count, jadi
// ambang 100 aman memisahkan "tidak ada listrik" dari
// "ada listrik" (setara kira-kira < 45 V dianggap 0).
const float AMBANG_NOISE_ZMPT = 100.0f;

// Batas kewajaran baseline kalibrasi saat boot.
// Kalau lebih besar, dianggap tercemar sinyal nyata -> diabaikan.
const float BASELINE_ZMPT_MAKS_WAJAR = 55.0f;

// Batas kewajaran tegangan; di atas ini dianggap gangguan EMI.
const float TEGANGAN_MAKS_WAJAR = 260.0f;

/*
 * KALIBRASI ZMPT101B
 * -------------------
 * Karena metode sampling berubah (jendela 100 ms, tanpa
 * batas array), nilai di bawah ini sebaiknya dikalibrasi
 * ULANG:
 *
 *   ZMPT_KALIBRASI_baru = ZMPT_KALIBRASI_lama x
 *                          (tegangan_multimeter / tegangan_terbaca_ESP32)
 *
 * Contoh: multimeter 233 V, ESP32 stabil di 210 V
 *   -> 523.1 x (233 / 210) = 580.4
 *
 * PENTING: reset/boot ESP32 dulu TANPA modul tersambung
 * ke listrik (supaya baseline bersih), baru sambungkan.
 */
// Riwayat (metode baru, jendela 100 ms):
//   Terbaca 230.78 V | multimeter 224 V -> 523.1 x (224/230.78) = 507.7
//   Terbaca ~235 V (rata-rata 230-240) | multimeter 224 V
//      -> 523.1 x (224/235) = 498.6  <-- NILAI SAAT INI
float ZMPT_KALIBRASI = 498.6f;

// ==================================================
// KONFIGURASI INTERVAL
// ==================================================

const unsigned long SENSOR_INTERVAL_MS = 2000UL;
const unsigned long WEB_INTERVAL_MS = 15000UL;
const unsigned long CONNECTION_INTERVAL_MS = 10000UL;
const unsigned long HEAP_INTERVAL_MS = 60000UL;
const unsigned long LCD_INTERVAL_MS = 3000UL;

// ==================================================
// ALARM LOKAL
// ==================================================

const float BATAS_SUHU_TINGGI = 24.0f;
const float RESET_ALARM_SUHU = 23.5f;

// ==================================================
// OBJEK LCD
// ==================================================

LiquidCrystal_I2C lcd(0x27, 16, 2);

// ==================================================
// STATUS SISTEM
// ==================================================

unsigned long lastSensorTime = 0;
unsigned long lastConnectionTime = 0;
unsigned long lastWebSendTime = 0;
unsigned long lastLCDChange = 0;
unsigned long lastHeapCheck = 0;

bool firstWebSend = true;

bool notifTerkirimL4 = false;
bool notifTerkirimL5 = false;

byte halamanLCD = 0;

// Hasil pembacaan ZMPT101B, diperbarui tiap bacaSensor().
float tegangan = 0.0f;

// Baseline (titik nol) RMS hasil kalibrasi saat boot.
float baselineRmsZMPT = 0.0f;

// ==================================================
// VALIDASI NILAI SENSOR
// ==================================================

bool suhuValid(float suhu)
{
  return (
    suhu != DEVICE_DISCONNECTED_C &&
    !isnan(suhu) &&
    suhu >= -40.0f &&
    suhu <= 100.0f
  );
}

// ==================================================
// RMS SATU JENDELA SAMPLING (tanpa batas jumlah sampel)
// ==================================================
//
// RMS dihitung dari deviasi terhadap rata-rata (membuang
// offset DC modul) memakai jumlah & jumlah kuadrat berjalan:
//   varians = E[x^2] - (E[x])^2
// Tidak perlu array, sehingga jendela selalu penuh 100 ms.
//
// Sampel yang persis mentok di 0 / 4095 dihitung terpisah
// sebagai indikasi glitch/clipping.
// ==================================================

float ambilRMSSatuJendela(int pin, float &persenMentokKeluar)
{
  uint32_t jumlahSampel = 0;
  uint32_t jumlahMentok = 0;
  uint64_t total = 0;
  uint64_t totalKuadrat = 0;

  const uint32_t waktuMulai = micros();

  while ((uint32_t)(micros() - waktuMulai) < DURASI_SAMPEL_US)
  {
    const uint32_t nilai = analogRead(pin);

    total += nilai;
    totalKuadrat += (uint64_t)nilai * nilai;
    jumlahSampel++;

    if (nilai <= 2 || nilai >= (uint32_t)(ADC_RESOLUTION - 2))
    {
      jumlahMentok++;
    }
  }

  if (jumlahSampel == 0)
  {
    persenMentokKeluar = 0.0f;
    return 0.0f;
  }

  persenMentokKeluar = (jumlahMentok * 100.0f) / jumlahSampel;

  const double rataRata = (double)total / jumlahSampel;
  double varians = (double)totalKuadrat / jumlahSampel - rataRata * rataRata;

  if (varians < 0) varians = 0;

  return (float)sqrt(varians);
}

// ==================================================
// RMS MEDIAN (3 jendela) -> tahan terhadap lonjakan noise
// ==================================================

float ambilRMSMedian(int pin, float &persenMentokMaks)
{
  float hasil[JUMLAH_JENDELA_MEDIAN];
  persenMentokMaks = 0.0f;

  for (byte i = 0; i < JUMLAH_JENDELA_MEDIAN; i++)
  {
    float persenMentok = 0.0f;
    hasil[i] = ambilRMSSatuJendela(pin, persenMentok);

    if (persenMentok > persenMentokMaks)
    {
      persenMentokMaks = persenMentok;
    }
  }

  // Urutkan naik (hanya 3 data).
  for (byte i = 0; i < JUMLAH_JENDELA_MEDIAN - 1; i++)
  {
    for (byte j = i + 1; j < JUMLAH_JENDELA_MEDIAN; j++)
    {
      if (hasil[j] < hasil[i])
      {
        const float tmp = hasil[i];
        hasil[i] = hasil[j];
        hasil[j] = tmp;
      }
    }
  }

  return hasil[JUMLAH_JENDELA_MEDIAN / 2];
}

// ==================================================
// KALIBRASI BASELINE (TITIK NOL) SAAT BOOT
// ==================================================
//
// Rata-rata beberapa RMS saat belum ada tegangan nyata.
// Pastikan ZMPT101B BELUM tersambung listrik saat boot.
// ==================================================

float kalibrasiBaselineRMS(int pin)
{
  const int jumlahSampel = 10;
  float total = 0.0f;

  for (int i = 0; i < jumlahSampel; i++)
  {
    float persenMentokAbaikan = 0.0f;
    total += ambilRMSSatuJendela(pin, persenMentokAbaikan);
    delay(50);
  }

  return total / jumlahSampel;
}

// ==================================================
// BACA TEGANGAN AC (ZMPT101B)
// ==================================================

float bacaTeganganAC()
{
  static float tegananTerhalus = 0.0f;
  static byte tolakBeruntun = 0;
  static byte hitungTerdeteksi = 0;

  float persenMentok = 0.0f;

  const float rmsMentah = ambilRMSMedian(PIN_ZMPT101B, persenMentok);

#if DEBUG
  DEBUG_PRINT("[ZMPT101B] RMS mentah: ");
  DEBUG_PRINT(rmsMentah);
  DEBUG_PRINT(" | sampel mentok: ");
  DEBUG_PRINT(persenMentok);
  DEBUG_PRINTLN("%");
#endif

  // Terlalu banyak sampel mentok -> bacaan tidak dipercaya.
  // Pertahankan nilai terakhir beberapa kali; kalau terus
  // berlanjut, baru dianggap 0.
  if (persenMentok > TOLERANSI_MENTOK_PERSEN)
  {
    DEBUG_PRINTLN(
      "[ZMPT101B] Terlalu banyak sampel mentok di batas ADC. "
      "Bacaan ditolak."
    );

    if (tolakBeruntun < MAKS_TOLAK_BERUNTUN)
    {
      tolakBeruntun++;
      return tegananTerhalus;
    }

    tegananTerhalus = 0.0f;
    return 0.0f;
  }

  // Kurangi baseline secara kuadratik.
  float rms = 0.0f;
  const float selisih =
    rmsMentah * rmsMentah - baselineRmsZMPT * baselineRmsZMPT;

  if (selisih > 0)
  {
    rms = sqrt(selisih);
  }

#if DEBUG
  DEBUG_PRINT("[ZMPT101B] Setelah baseline: ");
  DEBUG_PRINT(rms);
  DEBUG_PRINT(" | ambang: ");
  DEBUG_PRINTLN(AMBANG_NOISE_ZMPT);
#endif

  if (rms < AMBANG_NOISE_ZMPT)
  {
    tolakBeruntun = 0;
    hitungTerdeteksi = 0;
    tegananTerhalus = 0.0f;
    return 0.0f;
  }

  // Debounce: baru dianggap ada tegangan kalau terdeteksi
  // di atas ambang 2 kali berturut-turut.
  if (hitungTerdeteksi < 2)
  {
    hitungTerdeteksi++;
    return 0.0f;
  }

  const float voltaseSensor = (rms / ADC_RESOLUTION) * ADC_VREF;
  const float hasilTegangan = voltaseSensor * ZMPT_KALIBRASI;

  if (hasilTegangan > TEGANGAN_MAKS_WAJAR)
  {
    DEBUG_PRINT("[ZMPT101B] Nilai melebihi batas wajar (");
    DEBUG_PRINT(hasilTegangan);
    DEBUG_PRINTLN(" V), kemungkinan gangguan EMI. Diabaikan.");

    if (tolakBeruntun < MAKS_TOLAK_BERUNTUN)
    {
      tolakBeruntun++;
      return tegananTerhalus;
    }

    tegananTerhalus = 0.0f;
    return 0.0f;
  }

  tolakBeruntun = 0;

  // Filter EMA: langsung pakai nilai baru kalau sebelumnya 0.
  if (tegananTerhalus <= 0.0f)
  {
    tegananTerhalus = hasilTegangan;
  }
  else
  {
    tegananTerhalus =
      EMA_ALPHA * hasilTegangan +
      (1.0f - EMA_ALPHA) * tegananTerhalus;
  }

  return tegananTerhalus;
}

// ==================================================
// KONEKSI WI-FI
// ==================================================

bool hubungkanWiFi()
{
  if (WiFi.status() == WL_CONNECTED)
  {
    return true;
  }

  DEBUG_PRINTLN("");
  DEBUG_PRINT("Menghubungkan Wi-Fi: ");
  DEBUG_PRINTLN(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);

  WiFi.disconnect();
  delay(300);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const unsigned long timeoutMs = 10000UL;
  const unsigned long startTime = millis();

  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - startTime < timeoutMs
  )
  {
    delay(500);
    DEBUG_PRINT(".");
  }

  DEBUG_PRINTLN("");

  if (WiFi.status() != WL_CONNECTED)
  {
    DEBUG_PRINTLN("Wi-Fi gagal terhubung.");

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("WiFi Gagal");

    lcd.setCursor(0, 1);
    lcd.print("Coba kembali");

    return false;
  }

  DEBUG_PRINTLN("Wi-Fi berhasil terhubung.");

  DEBUG_PRINT("IP ESP32: ");
  DEBUG_PRINTLN(WiFi.localIP());

  return true;
}

void periksaKoneksi()
{
  if (WiFi.status() != WL_CONNECTED)
  {
    hubungkanWiFi();
  }
}

// ==================================================
// KIRIM SATU SENSOR KE WEBSITE
// ==================================================
//
// TEMP-L4:
// {
//   "sensorId": "TEMP-L4",
//   "temperature": 23.5,
//   "voltage": 220
// }
//
// TEMP-L5:
// {
//   "sensorId": "TEMP-L5",
//   "temperature": 24.1
// }
// ==================================================

bool kirimKeWeb(
  const char* sensorId,
  float suhu,
  bool sertakanTegangan = false,
  float teganganKirim = 0.0f
)
{
  if (WiFi.status() != WL_CONNECTED)
  {
    DEBUG_PRINT("Data ");
    DEBUG_PRINT(sensorId);
    DEBUG_PRINTLN(" tidak dikirim: Wi-Fi terputus.");

    return false;
  }

  WiFiClientSecure secureClient;

  /*
   * Digunakan untuk pengujian HTTPS.
   * Nantinya dapat diganti menggunakan sertifikat CA.
   */
  secureClient.setInsecure();
  secureClient.setTimeout(10);

  HTTPClient http;

  DEBUG_PRINTLN("");
  DEBUG_PRINT("Mengirim data sensor: ");
  DEBUG_PRINTLN(sensorId);

  DEBUG_PRINT("Endpoint: ");
  DEBUG_PRINTLN(WEB_API_URL);

  if (!http.begin(secureClient, WEB_API_URL))
  {
    DEBUG_PRINT("Gagal memulai HTTPS untuk ");
    DEBUG_PRINTLN(sensorId);

    return false;
  }

  http.setConnectTimeout(7000);
  http.setTimeout(7000);

  http.addHeader(
    "Content-Type",
    "application/json"
  );

  /*
   * Format autentikasi yang diminta API:
   * Authorization: Bearer SENSOR_API_KEY
   */
  http.addHeader(
    "Authorization",
    String("Bearer ") + SENSOR_API_KEY
  );

  StaticJsonDocument<192> document;

  document["sensorId"] = sensorId;
  document["temperature"] = suhu;

  // Tegangan hanya dikirim bersama TEMP-L4.
  if (sertakanTegangan)
  {
    document["voltage"] = teganganKirim;
  }

  String payload;
  serializeJson(document, payload);

  DEBUG_PRINT("Payload: ");
  DEBUG_PRINTLN(payload);

  const int statusCode = http.POST(payload);

  DEBUG_PRINT("HTTP status ");
  DEBUG_PRINT(sensorId);
  DEBUG_PRINT(": ");
  DEBUG_PRINTLN(statusCode);

  String response;

  if (statusCode > 0)
  {
    response = http.getString();

    DEBUG_PRINT("Respons server: ");
    DEBUG_PRINTLN(response);
  }
  else
  {
    DEBUG_PRINT("Kesalahan HTTP ");
    DEBUG_PRINT(sensorId);
    DEBUG_PRINT(": ");

    DEBUG_PRINTLN(
      HTTPClient::errorToString(statusCode)
    );
  }

  http.end();

  // Semua HTTP 200 sampai 299 dianggap berhasil.
  if (statusCode >= 200 && statusCode < 300)
  {
    DEBUG_PRINT("Data ");
    DEBUG_PRINT(sensorId);
    DEBUG_PRINTLN(" berhasil disimpan.");

    return true;
  }

  switch (statusCode)
  {
    case 400:
      DEBUG_PRINTLN("Data ditolak server.");
      DEBUG_PRINTLN("Periksa sensorId, temperature, dan format JSON.");
      break;

    case 401:
      DEBUG_PRINTLN("SENSOR_API_KEY tidak sesuai dengan Vercel.");
      break;

    case 404:
      DEBUG_PRINTLN("Endpoint API tidak ditemukan.");
      DEBUG_PRINTLN("Periksa WEB_API_URL pada secrets.h.");
      break;

    case 405:
      DEBUG_PRINTLN("Metode POST tidak diizinkan.");
      break;

    case 429:
      DEBUG_PRINTLN("Terlalu banyak request.");
      break;

    case 500:
      DEBUG_PRINTLN("Kesalahan server, environment, atau database.");
      break;

    default:
      if (statusCode > 0)
      {
        DEBUG_PRINTLN("Server mengembalikan status selain 2xx.");
      }
      break;
  }

  return false;
}

// ==================================================
// MENAMPILKAN TEKS DI TENGAH LCD
// ==================================================

void printTengah(byte baris, const String &teks)
{
  int kolom = (16 - (int)teks.length()) / 2;

  if (kolom < 0)
  {
    kolom = 0;
  }

  String baris16 = "";

  for (int i = 0; i < kolom; i++)
  {
    baris16 += ' ';
  }

  baris16 += teks;

  while ((int)baris16.length() < 16)
  {
    baris16 += ' ';
  }

  if (baris16.length() > 16)
  {
    baris16 = baris16.substring(0, 16);
  }

  lcd.setCursor(0, baris);
  lcd.print(baris16);
}

// ==================================================
// TAMPILKAN DATA KE LCD
// ==================================================
//
// Halaman: 0 = Suhu L4, 1 = Suhu L5, 2 = Tegangan.
// ==================================================

void tampilkanLCD(
  float suhuL4,
  float suhuL5,
  bool errorL4,
  bool errorL5
)
{
  if (millis() - lastLCDChange >= LCD_INTERVAL_MS)
  {
    halamanLCD++;

    if (halamanLCD > 2)
    {
      halamanLCD = 0;
    }

    lastLCDChange = millis();
    lcd.clear();
  }

  switch (halamanLCD)
  {
    case 0:
    {
      printTengah(0, "SUHU LT4");

      if (errorL4)
      {
        printTengah(1, "ERROR");
      }
      else
      {
        char nilai[16];
        snprintf(nilai, sizeof(nilai), "%.1f%cC", suhuL4, 223);
        printTengah(1, nilai);
      }

      break;
    }

    case 1:
    {
      printTengah(0, "SUHU LT5");

      if (errorL5)
      {
        printTengah(1, "ERROR");
      }
      else
      {
        char nilai[16];
        snprintf(nilai, sizeof(nilai), "%.1f%cC", suhuL5, 223);
        printTengah(1, nilai);
      }

      break;
    }

    case 2:
    {
      printTengah(0, "TEGANGAN");

      char nilai[16];
      snprintf(nilai, sizeof(nilai), "%.1f V", tegangan);
      printTengah(1, nilai);

      break;
    }
  }
}

// ==================================================
// ALARM SUHU LOKAL
// ==================================================

void periksaAlarm(
  float suhu,
  const char* lokasi,
  bool &notifTerkirim
)
{
  if (suhu >= BATAS_SUHU_TINGGI && !notifTerkirim)
  {
    DEBUG_PRINTLN("");
    DEBUG_PRINT("===== ALARM SUHU TINGGI: ");
    DEBUG_PRINT(lokasi);
    DEBUG_PRINTLN(" =====");

    DEBUG_PRINT("Suhu: ");
    DEBUG_PRINT(suhu);
    DEBUG_PRINTLN(" C");

    notifTerkirim = true;
  }

  // Alarm aktif kembali setelah suhu turun di bawah RESET_ALARM_SUHU.
  if (suhu < RESET_ALARM_SUHU)
  {
    notifTerkirim = false;
  }
}

// ==================================================
// BACA DAN KIRIM DATA SENSOR
// ==================================================

// ==================================================
// BACA DS18B20 DENGAN RETRY (untuk kabel panjang)
// ==================================================
//
// Kabel panjang membuat pembacaan DS18B20 kadang gagal:
//   - -127 C (DEVICE_DISCONNECTED_C) = sensor tidak menjawab
//   - 85.0 C = nilai awal sensor, konversi gagal selesai
// Keduanya dibaca ulang sampai 2 kali. Kalau tetap gagal,
// nilai valid terakhir dipertahankan sampai 3 kali bacaan
// berturut-turut sebelum akhirnya dilaporkan ERROR. Jadi
// gangguan sesaat tidak langsung memunculkan ERROR/lonjakan.
// ==================================================

const byte MAKS_RETRY_SUHU = 2;
const byte MAKS_TAHAN_SUHU = 3;

float suhuTerakhirL4 = DEVICE_DISCONNECTED_C;
float suhuTerakhirL5 = DEVICE_DISCONNECTED_C;
byte gagalBeruntunL4 = 0;
byte gagalBeruntunL5 = 0;

float bacaSuhuDenganRetry(
  DallasTemperature &sensor,
  float &suhuTerakhir,
  byte &gagalBeruntun
)
{
  for (byte i = 0; i <= MAKS_RETRY_SUHU; i++)
  {
    sensor.requestTemperatures();
    const float hasil = sensor.getTempCByIndex(0);

    if (suhuValid(hasil) && hasil != 85.0f)
    {
      suhuTerakhir = hasil;
      gagalBeruntun = 0;
      return hasil;
    }

    delay(50);
  }

  // Semua percobaan gagal: inisialisasi ulang jalur 1-Wire
  // supaya sensor yang "tersangkut" bisa pulih pada bacaan
  // berikutnya, tanpa perlu reboot ESP32.
  DEBUG_PRINTLN("[DS18B20] Semua percobaan gagal, reset jalur 1-Wire.");
  sensor.begin();
  sensor.setResolution(12);

  // Tahan nilai terakhir sebentar.
  if (suhuValid(suhuTerakhir) && gagalBeruntun < MAKS_TAHAN_SUHU)
  {
    gagalBeruntun++;

    DEBUG_PRINT("[DS18B20] Bacaan gagal, memakai nilai terakhir (");
    DEBUG_PRINT(gagalBeruntun);
    DEBUG_PRINTLN("x).");

    return suhuTerakhir;
  }

  return DEVICE_DISCONNECTED_C;
}

void bacaSensor()
{
  const float suhuL4 = bacaSuhuDenganRetry(
    sensorL4, suhuTerakhirL4, gagalBeruntunL4
  );

  const float suhuL5 = bacaSuhuDenganRetry(
    sensorL5, suhuTerakhirL5, gagalBeruntunL5
  );

  const bool errorL4 = !suhuValid(suhuL4);
  const bool errorL5 = !suhuValid(suhuL5);

  // Perbarui tegangan dari ZMPT101B.
  tegangan = bacaTeganganAC();

  DEBUG_PRINTLN("");

  if (errorL4)
  {
    DEBUG_PRINTLN("Sensor L4 tidak terbaca.");
  }
  else
  {
    DEBUG_PRINT("Suhu Lantai 4: ");
#if DEBUG
    Serial.print(suhuL4, 2);
#endif
    DEBUG_PRINTLN(" C");
  }

  if (errorL5)
  {
    DEBUG_PRINTLN("Sensor L5 tidak terbaca.");
  }
  else
  {
    DEBUG_PRINT("Suhu Lantai 5: ");
#if DEBUG
    Serial.print(suhuL5, 2);
#endif
    DEBUG_PRINTLN(" C");
  }

  DEBUG_PRINT("Tegangan: ");
  DEBUG_PRINT(tegangan);
  DEBUG_PRINTLN(" V");

  tampilkanLCD(suhuL4, suhuL5, errorL4, errorL5);

  // Pengiriman dilakukan setiap 15 detik.
  if (firstWebSend || millis() - lastWebSendTime >= WEB_INTERVAL_MS)
  {
    firstWebSend = false;
    lastWebSendTime = millis();

    bool berhasilL4 = false;
    bool berhasilL5 = false;

    // Request pertama: TEMP-L4 (suhu + tegangan).
    if (!errorL4)
    {
      berhasilL4 = kirimKeWeb(
        SENSOR_ID_L4,
        suhuL4,
        true, tegangan
      );
    }
    else
    {
      DEBUG_PRINTLN("TEMP-L4 dilewati karena pembacaan tidak valid.");
    }

    // Request kedua: TEMP-L5.
    if (!errorL5)
    {
      berhasilL5 = kirimKeWeb(SENSOR_ID_L5, suhuL5);
    }
    else
    {
      DEBUG_PRINTLN("TEMP-L5 dilewati karena pembacaan tidak valid.");
    }

    DEBUG_PRINT("Hasil kirim TEMP-L4: ");
    DEBUG_PRINTLN(berhasilL4 ? "BERHASIL" : "GAGAL/DILEWATI");

    DEBUG_PRINT("Hasil kirim TEMP-L5: ");
    DEBUG_PRINTLN(berhasilL5 ? "BERHASIL" : "GAGAL/DILEWATI");
  }

  if (!errorL4)
  {
    periksaAlarm(suhuL4, "Lantai 4", notifTerkirimL4);
  }

  if (!errorL5)
  {
    periksaAlarm(suhuL5, "Lantai 5", notifTerkirimL5);
  }
}

// ==================================================
// SETUP
// ==================================================

void setup()
{
  Serial.begin(115200);
  delay(1000);

  DEBUG_PRINTLN("");
  DEBUG_PRINTLN("================================");
  DEBUG_PRINTLN("MONITORING SUHU & TEGANGAN");
  DEBUG_PRINTLN("================================");

  // LCD I2C menggunakan SDA 21 dan SCL 22.
  Wire.begin(21, 22);

  lcd.init();
  lcd.backlight();
  lcd.clear();

  lcd.setCursor(0, 0);
  lcd.print("Sistem Mulai");

  lcd.setCursor(0, 1);
  lcd.print("Connecting...");

  // Memulai kedua sensor DS18B20.
  sensorL4.begin();
  sensorL5.begin();

  sensorL4.setResolution(12);
  sensorL5.setResolution(12);

  DEBUG_PRINT("Sensor L4 terdeteksi: ");
  DEBUG_PRINTLN(sensorL4.getDeviceCount());

  DEBUG_PRINT("Sensor L5 terdeteksi: ");
  DEBUG_PRINTLN(sensorL5.getDeviceCount());

  // Konfigurasi ADC untuk ZMPT101B.
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db); // rentang baca hingga ~3.3V
  pinMode(PIN_ZMPT101B, INPUT);

  // Menghubungkan ESP32 ke Wi-Fi.
  hubungkanWiFi();

  lcd.clear();

  if (WiFi.status() == WL_CONNECTED)
  {
    lcd.setCursor(0, 0);
    lcd.print("WiFi Connected");
  }
  else
  {
    lcd.setCursor(0, 0);
    lcd.print("WiFi Offline");
  }

  DEBUG_PRINTLN("ESP32 siap.");

  // Kalibrasi titik nol tegangan. Pastikan saat ini ZMPT101B
  // BELUM tersambung ke listrik.
  DEBUG_PRINTLN("Kalibrasi baseline tegangan...");

  baselineRmsZMPT = kalibrasiBaselineRMS(PIN_ZMPT101B);

  DEBUG_PRINT("Baseline RMS ZMPT101B: ");
  DEBUG_PRINTLN(baselineRmsZMPT);

  // Sanity check baseline: kalau mencurigakan besar, diabaikan.
  if (baselineRmsZMPT > BASELINE_ZMPT_MAKS_WAJAR)
  {
    DEBUG_PRINTLN(
      "[PERINGATAN] Baseline ZMPT101B mencurigakan besar - "
      "kemungkinan sensor SUDAH tersambung listrik saat "
      "kalibrasi berlangsung! Baseline ini DIABAIKAN, dipakai "
      "0 sebagai gantinya. Disarankan reset ulang ESP32 dalam "
      "kondisi ZMPT101B belum tersambung listrik."
    );

    baselineRmsZMPT = 0.0f;
  }

  lastLCDChange = millis();

  // Langsung baca dan kirim saat alat menyala.
  bacaSensor();

  lastSensorTime = millis();
}

// ==================================================
// LOOP
// ==================================================

void loop()
{
  const unsigned long sekarang = millis();

  if (sekarang - lastSensorTime >= SENSOR_INTERVAL_MS)
  {
    lastSensorTime = sekarang;

    bacaSensor();
  }

  if (sekarang - lastConnectionTime >= CONNECTION_INTERVAL_MS)
  {
    lastConnectionTime = sekarang;

    periksaKoneksi();
  }

  if (sekarang - lastHeapCheck >= HEAP_INTERVAL_MS)
  {
    lastHeapCheck = sekarang;

    DEBUG_PRINT("Free Heap: ");
    DEBUG_PRINT(ESP.getFreeHeap());
    DEBUG_PRINTLN(" bytes");
  }
}
