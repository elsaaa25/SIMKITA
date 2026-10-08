# Product Requirements Document (PRD)

## Server Room Monitoring System

| Atribut | Nilai |
|---|---|
| Nama produk | Server Room Monitoring System |
| Status | Aktif dikembangkan |
| Platform | Web responsif / desktop browser |
| Bahasa antarmuka | Indonesia |
| Zona waktu utama | WIB (`Asia/Jakarta`) |
| Repository | `elsaaa25/server-room-monitoring` |
| Lingkungan produksi | Vercel |
| Database | PostgreSQL Supabase |

---

## 1. Ringkasan Produk

Server Room Monitoring System adalah aplikasi web untuk memantau kondisi ruang server secara hampir real-time. Sistem menerima pembacaan sensor dari ESP32 melalui API HTTPS, menyimpan data ke PostgreSQL Supabase, menampilkan kondisi terkini pada dashboard, menyediakan grafik dan riwayat, serta membuat peringatan ketika suhu atau tegangan melewati batas yang telah ditentukan.

Sistem mendukung **dua lokasi sensor**:
- **TEMP-L4** — Lantai 4 (Ruang Server): sensor suhu, tegangan, dan arus.
- **TEMP-L5** — Lantai 5 (Ruang ATC): sensor suhu.

Fungsi utama produk adalah monitoring, pencatatan, visualisasi, peringatan, notifikasi email, dan pengarsipan data secara otomatis.

---

## 2. Latar Belakang Masalah

Ruang server membutuhkan kondisi suhu dan tegangan yang stabil. Pemantauan manual memiliki beberapa keterbatasan:

- kondisi ruangan tidak selalu diperiksa setiap saat;
- kenaikan suhu atau anomali tegangan dapat terlambat diketahui;
- tidak tersedia riwayat yang rapi untuk analisis;
- status sensor sulit diketahui ketika perangkat terputus;
- laporan bulanan membutuhkan proses manual.

Sistem ini menyediakan satu pusat monitoring yang mudah diakses melalui komputer maupun perangkat seluler, menampilkan informasi penting secara cepat, mengirimkan notifikasi otomatis via email, dan menyimpan rekam data yang dapat ditinjau kembali.

---

## 3. Tujuan Produk

### 3.1 Tujuan Utama

1. Menampilkan kondisi suhu Lantai 4 dan Lantai 5 secara hampir real-time.
2. Menampilkan kondisi tegangan dan arus Lantai 4 secara hampir real-time.
3. Memberikan peringatan dan notifikasi email saat suhu atau tegangan melewati batas.
4. Menyediakan grafik perubahan suhu dan tegangan yang mudah dibaca.
5. Menyediakan riwayat pembacaan sensor dalam zona waktu WIB.
6. Menampilkan status sensor online atau offline.
7. Menyediakan pengaturan batas suhu dan tegangan yang hanya dapat diubah administrator.
8. Mengarsipkan data bulanan ke Google Drive dalam format Excel.

### 3.2 Sasaran Keberhasilan

- Data terbaru tampil tanpa reload halaman.
- Grafik responsif pada riwayat besar.
- Peringatan tidak dibuat berulang untuk satu siklus kondisi yang sama.
- Email notifikasi terkirim ke seluruh pengguna aktif saat peringatan baru terjadi.
- Administrator dapat memahami kondisi kedua ruangan dalam waktu kurang dari satu menit.

---

## 4. Ruang Lingkup

### 4.1 Termasuk dalam Produk

- Autentikasi pengguna (login email + password, JWT);
- Otorisasi berbasis role (`ADMIN` dan `OPERATOR`);
- Monitoring suhu Lantai 4 (`TEMP-L4`);
- Monitoring suhu Lantai 5 (`TEMP-L5`);
- Monitoring tegangan Lantai 4 (sensor ZMPT101B);
- Monitoring arus Lantai 4 (sensor ACS712);
- Alert suhu: Waspada dan Bahaya, dengan eskalasi otomatis;
- Alert tegangan: Drop dan Surge, dengan level Waspada/Bahaya;
- Notifikasi email ke semua pengguna aktif saat peringatan dibuat;
- Dashboard ringkasan kondisi seluruh lokasi sensor;
- Grafik suhu dan tegangan dengan pilihan periode (1 jam, 6 jam, 24 jam, 7 hari);
- Halaman riwayat sensor dengan filter jam, tanggal, dan lokasi;
- Halaman peringatan dengan fungsi penanganan alarm;
- Halaman pengaturan parameter dan ambang batas monitoring;
- Batas suhu L4 dan L5 yang dapat dikonfigurasi secara terpisah;
- Batas tegangan minimum dan maksimum yang dapat dikonfigurasi;
- Deteksi status sensor online/offline;
- Ekspor CSV dari halaman grafik;
- Arsip Excel bulanan otomatis ke Google Drive;
- Deployment aplikasi pada lingkungan serverless (Vercel);
- Antarmuka responsif (desktop, tablet, dan mobile);
- Dukungan dark mode dan light mode.

### 4.2 Dalam Pengembangan / Direncanakan

- Pencatatan data berbasis perubahan suhu (*change-based monitoring*);
- *Heartbeat* perangkat terpisah dari data historis;
- Optimasi polling grafik (hanya mengambil delta data terbaru);
- Verifikasi dan otomatisasi penuh penghapusan arsip bulanan.

### 4.3 Tidak Termasuk

- Kontrol otomatis AC, kipas, atau aktuator;
- Aplikasi Android/iOS native;
- Prediksi suhu berbasis machine learning;
- Multi-tenant atau banyak instalasi independen;
- Notifikasi WhatsApp, Telegram, atau SMS;
- Monitoring kamera/CCTV;
- Kontrol kelistrikan jarak jauh.

---

## 5. Pengguna

Sistem mendukung dua tipe pengguna:

### Administrator (`ADMIN`)
Administrator bertugas memantau kondisi ruangan, menindaklanjuti peringatan, mengonfigurasi parameter sistem, serta mengelola pengaturan monitoring.

Hak akses:
- Login ke aplikasi;
- Membaca dan mengelola seluruh halaman (dashboard, grafik, riwayat, peringatan, pengaturan);
- Mengubah batas suhu, batas tegangan, interval polling, dan batas offline sensor;
- Menandai peringatan sebagai ditangani;
- Mengekspor data CSV dan mengunduh laporan.

### Operator (`OPERATOR`)
Operator bertugas melakukan pemantauan rutin kondisi ruang server dan menangani alarm yang muncul.

---

## 6. Alur Sistem Utama

```mermaid
flowchart LR
    A[ESP32 + Sensor] -->|HTTPS POST + Bearer API Key| B[Next.js API /api/sensor]
    B --> C[Validasi Zod]
    C --> D[(PostgreSQL Supabase)]
    D --> E[Next.js API History/Alerts/Settings]
    E --> F[Dashboard Web]
    D --> G[Alert Handler]
    G -->|Email| H[Seluruh Pengguna Aktif]
    D --> I[Cron Arsip Bulanan]
    I --> J[Excel di Google Drive]
```

### 6.1 Alur Pembacaan Sensor

1. ESP32 membaca nilai suhu, tegangan, dan/atau arus.
2. ESP32 mengirim payload JSON ke `POST /api/sensor` dengan Bearer API Key.
3. API memvalidasi identitas perangkat dan format payload menggunakan Zod.
4. Data valid disimpan ke tabel `sensor_readings`.
5. Sistem mengevaluasi batas suhu (L4 dan L5 dengan threshold terpisah).
6. Sistem mengevaluasi batas tegangan (Drop/Surge, khusus TEMP-L4).
7. Alert dibuka, dieskalasi, atau diselesaikan sesuai kondisi.
8. Jika alert baru dibuat, email notifikasi dikirim ke semua pengguna aktif.
9. Dashboard mengambil data terbaru melalui polling dan memperbarui tampilan.

---

## 7. Kebutuhan Fungsional

### FR-001 — Autentikasi

- Pengguna login menggunakan email dan password.
- Password disimpan dalam bentuk hash (bcryptjs).
- Sesi menggunakan JWT dengan durasi yang ditentukan.
- Pengguna harus memverifikasi email sebelum dapat login (`email_verified_at`).
- Pengguna dengan `must_change_password = true` diarahkan ke halaman ganti password pertama.
- Pengguna tidak aktif (`is_active = false`) tidak dapat login.
- Pengguna yang belum login diarahkan ke `/login`.

Halaman autentikasi yang tersedia:
- `/login` — halaman masuk
- `/verifikasi-email` — verifikasi email
- `/konfirmasi-password` — konfirmasi password
- `/ganti-password-pertama` — ganti password pertama setelah akun dibuat

### FR-002 — Otorisasi

- Semua halaman selain publik memerlukan sesi aktif.
- Endpoint perubahan pengaturan (`POST /api/settings`) memerlukan hak akses `ADMIN`.
- Pembatasan otorisasi diverifikasi pada level server/API.

### FR-003 — Penerimaan Data Sensor

Endpoint:

```text
POST /api/sensor
Authorization: Bearer <SENSOR_API_KEY>
Content-Type: application/json
```

Sensor yang diterima:

| `sensorId` | Lokasi |
|---|---|
| `TEMP-L4` | Lantai 4 (Ruang Server) |
| `TEMP-L5` | Lantai 5 (Ruang ATC) |

Skema payload (validasi Zod):

```json
{
  "sensorId": "TEMP-L4",
  "temperature": 23.6,
  "voltage": 220.4,
  "current": 1.35
}
```

| Field | Tipe | Wajib | Rentang |
|---|---|---|---|
| `sensorId` | string | Ya | `TEMP-L4` atau `TEMP-L5` |
| `temperature` | number | Ya | -40°C hingga 100°C |
| `voltage` | number | Tidak | 0 hingga 300 V |
| `current` | number | Tidak | 0 hingga 999 A |

Ketentuan respons:
- Request tidak sah → `401`
- Payload tidak valid → `400`
- Data berhasil disimpan → `201` dengan `{ success: true, readingId }`

### FR-004 — Klasifikasi Suhu

Klasifikasi menggunakan batas dari `monitoring_settings`. Batas L4 dan L5 dikonfigurasi secara terpisah.

| Status | Kondisi |
|---|---|
| Normal | Suhu < batas waspada |
| Waspada | Suhu ≥ batas waspada dan < batas bahaya |
| Bahaya | Suhu ≥ batas bahaya |

Nilai standar bawaan:

| Parameter | Nilai |
|---|---|
| `warning_temperature` (L4) | 27°C |
| `danger_temperature` (L4) | 30°C |
| `warning_temperature_l5` (L5) | 27°C |
| `danger_temperature_l5` (L5) | 30°C |

### FR-005 — Klasifikasi Tegangan

Klasifikasi menggunakan batas dari `monitoring_settings`.

| Anomali | Kondisi |
|---|---|
| Normal | voltageMin ≤ tegangan ≤ voltageMax |
| Drop | Tegangan < voltageMin |
| Surge | Tegangan > voltageMax |

Level alert dihitung berdasarkan deviasi dari batas:
- Deviasi ≤ 10% → Waspada
- Deviasi > 10% → Bahaya

Nilai standar bawaan:

| Parameter | Nilai |
|---|---|
| `voltage_min` | 200 V |
| `voltage_max` | 240 V |

Monitoring tegangan berlaku untuk sensor `TEMP-L4`.

### FR-006 — Sistem Peringatan Suhu

- Peringatan dibuat ketika suhu masuk level Waspada atau Bahaya.
- Hanya boleh ada satu peringatan aktif per sensor (unique index di database).
- Perubahan dari Waspada ke Bahaya dianggap eskalasi: alert yang ada diperbarui.
- Ketika suhu kembali normal, alert aktif diselesaikan (`status = 'Ditangani'`, `resolved_at = NOW()`).
- Data yang tersimpan: `reading_id`, `sensor_id`, `level`, `status`, `temperature`, `title`, `detail`, `created_at`, `acknowledged_at`, `resolved_at`, `handled_by`.
- `reading_id` bersifat `ON DELETE SET NULL` agar arsip riwayat tidak menghapus catatan peringatan.

### FR-007 — Sistem Peringatan Tegangan

- Peringatan dibuat ketika tegangan masuk kondisi Drop atau Surge.
- Hanya boleh ada satu peringatan tegangan aktif per sensor.
- Ketika tegangan kembali normal, alert aktif diselesaikan.
- Data yang tersimpan: `reading_id`, `sensor_id`, `anomaly_type`, `level`, `status`, `voltage`, `title`, `detail`, `created_at`, `acknowledged_at`, `resolved_at`, `handled_by`.

### FR-008 — Notifikasi Email

- Setiap kali peringatan suhu atau tegangan baru dibuat (atau dieskalasi), sistem mengirim email otomatis.
- Penerima email adalah seluruh pengguna dengan `is_active = TRUE`.
- Email berisi judul peringatan, detail kondisi, dan tautan ke dashboard peringatan.
- Pengiriman email dilakukan secara async agar tidak memblokir respons ke ESP32.

### FR-009 — Dashboard Utama

Dashboard menampilkan:
- Suhu terbaru Lantai 4 dan Lantai 5;
- Tegangan terbaru Lantai 4;
- Arus terbaru Lantai 4 (jika tersedia);
- Status sensor (online/offline) setiap lantai;
- Kondisi suhu (Normal/Waspada/Bahaya);
- Kondisi tegangan (Normal/Drop/Surge);
- Waktu pembaruan terakhir (WIB);
- Grafik suhu per lantai;
- Grafik tegangan;
- Batas Normal/Waspada/Bahaya pada grafik;
- Suhu tertinggi, terendah, dan rata-rata;
- Pembacaan terbaru;
- Tautan ke riwayat dan peringatan.

### FR-010 — Grafik Dashboard

- Pilihan periode: 1 jam, 6 jam, 24 jam.
- Grafik suhu L4 dan L5 ditampilkan terpisah.
- Grafik tegangan menggunakan skala Y terpisah.
- Batas suhu pada grafik mengikuti pengaturan database.
- Polling dashboard hanya mengambil delta data terbaru untuk efisiensi.
- Riwayat penuh dimuat saat halaman, lantai, atau periode berubah.
- Jumlah titik yang dirender dibatasi untuk menjaga performa rendering.
- Animasi Recharts dinonaktifkan untuk pembaruan realtime berulang.
- Semua label waktu menggunakan WIB.

### FR-011 — Halaman Grafik

Halaman grafik menyediakan:
- Periode 1 jam, 6 jam, 24 jam, dan 7 hari;
- Kartu nilai terakhir dan rata-rata;
- Grafik suhu L4 dan L5 secara terpisah;
- Grafik tegangan dan arus;
- Tombol pembaruan manual;
- Informasi waktu pembaruan terakhir;
- Export CSV (kolom suhu L4, suhu L5, tegangan, arus, waktu WIB);
- State loading, kosong, dan error.

### FR-012 — Riwayat Sensor

Endpoint:

```text
GET /api/sensor/history
```

Filter yang didukung: `sensorId`, `hours`, `date`, `limit`.

Ketentuan:
- Hanya pengguna login yang dapat mengakses;
- Urutan default terbaru ke terlama;
- Filter tanggal menggunakan WIB;
- Respons berisi `id`, `sensorId`, `temperature`, `voltage`, `current`, `recordedAt`;
- Jumlah data dibatasi untuk mencegah query berlebihan.

### FR-013 — Halaman Peringatan

- Menampilkan daftar peringatan suhu dari `temperature_alerts`.
- Filter tersedia: status (`Aktif`/`Ditangani`), level (`Waspada`/`Bahaya`).
- Pengguna dapat menandai satu atau semua peringatan aktif sebagai "Ditangani" (`PATCH /api/alerts`).
- `handled_by` diisi dengan ID pengguna yang menangani.

### FR-014 — Status Sensor Online/Offline

- Sensor dinyatakan online bila data terakhir diterima dalam batas `offline_timeout` detik.
- Sensor dinyatakan offline bila melewati batas tersebut.
- Batas `offline_timeout` dapat dikonfigurasi melalui pengaturan (default: 30 detik).

### FR-015 — Pengaturan Monitoring

Pengaturan global disimpan dalam satu record `id = 'global'` di tabel `monitoring_settings`.

Parameter yang dapat diubah oleh administrator:

| Parameter | Keterangan | Default |
|---|---|---|
| `warning_temperature` | Batas waspada L4 (°C) | 27 |
| `danger_temperature` | Batas bahaya L4 (°C) | 30 |
| `warning_temperature_l5` | Batas waspada L5 (°C) | 27 |
| `danger_temperature_l5` | Batas bahaya L5 (°C) | 30 |
| `voltage_min` | Batas minimum tegangan (V) | 200 |
| `voltage_max` | Batas maksimum tegangan (V) | 240 |
| `refresh_interval` | Interval polling UI (detik) | 4 |
| `offline_timeout` | Batas offline sensor (detik) | 30 |
| `sensor_name` | Nama sensor | Sensor Ruang Server |
| `sensor_id` | ID sensor | esp32-01 |
| `browser_notification` | Notifikasi browser | true |
| `sound_alert` | Suara peringatan | false |

Aturan validasi:
- `danger_temperature` harus lebih tinggi dari `warning_temperature`;
- `voltage_max` harus lebih tinggi dari `voltage_min`;
- Hanya administrator yang dapat menyimpan perubahan.

### FR-016 — Arsip Excel Bulanan

Sistem membuat satu file `.xlsx` untuk setiap bulan kalender.

Nama file:

```text
monitoring-ruang-server-YYYY-MM.xlsx
```

Sheet wajib:
1. `Data Sensor` — seluruh baris pembacaan bulan tersebut
2. `Ringkasan Harian` — min, max, rata-rata per hari per parameter

Format kolom `Data Sensor`:

| No. | Tanggal dan Waktu WIB | Suhu Lantai 4 (°C) | Suhu Lantai 5 (°C) | Tegangan (V) | Arus (A) |
|---:|---|---:|---:|---:|---:|

Ketentuan:
- File diunggah ke folder Google Drive yang dikonfigurasi via OAuth 2.0;
- Status ekspor dicatat di `monthly_export_logs`;
- File tidak dianggap selesai sebelum jumlah baris diverifikasi.

### FR-017 — Finalisasi Arsip dan Penghapusan Aman

- Data hanya dihapus setelah upload Google Drive berhasil.
- Jumlah baris yang diekspor harus sama dengan yang akan dihapus.
- Penghapusan hanya mencakup bulan arsip tertentu (bukan `TRUNCATE`).
- Fungsi database `finalize_monthly_sensor_archive(date)` mengelola proses ini.
- Peringatan tetap dipertahankan walaupun `reading_id` menjadi null.
- Kegagalan proses mengubah status log menjadi gagal tanpa menghapus data.

### FR-018 — Zona Waktu

- Seluruh tampilan pengguna menggunakan WIB.
- Zona waktu canonical: `Asia/Jakarta`.
- Timestamp database menggunakan `TIMESTAMPTZ`.
- Filter tanggal menghitung batas hari berdasarkan WIB.
- File CSV dan Excel menggunakan label waktu WIB.

---

## 8. Halaman dan Navigasi

| Halaman | Route | Akses | Fungsi utama |
|---|---|---|---|
| Login | `/login` | Publik | Autentikasi pengguna |
| Verifikasi Email | `/verifikasi-email` | Publik | Verifikasi email baru |
| Konfirmasi Password | `/konfirmasi-password` | Publik | Konfirmasi password baru |
| Ganti Password Pertama | `/ganti-password-pertama` | Login | Ganti password awal |
| Dashboard | `/` | Login | Ringkasan kondisi dan grafik utama |
| Grafik | `/grafik` | Login | Analisis grafik periode panjang |
| Riwayat | `/riwayat` | Login | Tabel historis dan filter |
| Peringatan | `/peringatan` | Login | Daftar dan penanganan alarm |
| Pengaturan | `/pengaturan` | Admin | Konfigurasi sistem |
| Profil | `/profil` | Login | Profil pengguna |

Navigasi menggunakan sidebar pada desktop dan drawer pada mobile.

---

## 9. Spesifikasi UI/UX

### 9.1 Prinsip Tampilan

- Antarmuka bersih dan profesional;
- Informasi kritis terlihat tanpa banyak langkah;
- Desain responsif (desktop, tablet, mobile);
- Dark mode dan light mode tersedia;
- Kartu dengan border tipis, sudut membulat, dan bayangan ringan;
- Komponen UI konsisten dengan standar antarmuka modern.

### 9.2 Warna Status

| Status | Warna utama |
|---|---|
| Normal | Hijau |
| Waspada | Amber/oranye |
| Bahaya | Merah/rose |
| Tidak tersedia / Offline | Abu-abu |
| Informasi | Biru |

Status tidak boleh disampaikan hanya melalui warna — selalu gunakan teks dan/atau ikon.

### 9.3 State Wajib Komponen

Setiap komponen data harus menangani:
- Loading;
- Data tersedia;
- Data kosong;
- Error;
- Sensor offline;
- Sensor belum tersedia.

---

## 10. Arsitektur Teknis

### 10.1 Stack

| Area | Teknologi |
|---|---|
| Framework | Next.js App Router |
| Bahasa | TypeScript |
| UI | React, Shadcn UI, Tailwind CSS |
| Grafik | Recharts |
| Validasi | Zod |
| Autentikasi | Auth.js (NextAuth) |
| Password hashing | bcryptjs |
| Database | PostgreSQL Supabase |
| Driver database | `pg` |
| Hosting | Vercel |
| Excel | ExcelJS |
| Google Drive | Google APIs SDK |
| Email | Resend / SMTP Service |

### 10.2 Komponen Utama

```text
ESP32
  └── HTTPS POST /api/sensor
        ├── Validasi Bearer API key
        ├── Validasi Zod (sensorId, temperature, voltage, current)
        ├── INSERT sensor_readings
        ├── Evaluasi temperature_alerts (L4 dan L5 dengan threshold terpisah)
        ├── Evaluasi voltage_alerts (hanya TEMP-L4)
        └── Kirim email ke semua pengguna aktif (async)

Browser
  ├── Auth.js session (JWT)
  ├── GET /api/settings
  ├── GET /api/sensor/history
  ├── GET /api/alerts
  ├── PATCH /api/alerts (tandai ditangani)
  └── Polling data terbaru setiap N detik

Cron arsip
  ├── Query data bulan sebelumnya
  ├── Buat workbook Excel (Data Sensor + Ringkasan Harian)
  ├── Upload ke Google Drive via OAuth
  ├── Verifikasi jumlah baris
  └── Finalisasi dan penghapusan aman
```

### 10.3 Strategi Realtime

Sistem menggunakan polling HTTP efisien yang kompatibel dengan arsitektur serverless.

Strategi performa:
- Riwayat penuh dimuat hanya saat konteks berubah (halaman/lantai/periode);
- Polling hanya mengambil data terbaru;
- Permintaan yang sedang berjalan tidak ditumpuk (*abort controller* sebelum request baru);
- Grafik dirender dengan pembatasan jumlah titik data;
- Animasi grafik dinonaktifkan untuk pembaruan berulang.

---

## 11. Model Data

### 11.1 `users`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | VARCHAR(100) | Nama pengguna |
| `email` | VARCHAR(255) | Email unik |
| `password_hash` | TEXT | Hash password |
| `role` | VARCHAR(20) | `OPERATOR` atau `ADMIN` |
| `is_active` | BOOLEAN | Status akun |
| `email_verified_at` | TIMESTAMPTZ | Waktu verifikasi email |
| `must_change_password` | BOOLEAN | Wajib ganti password pertama |
| `session_version` | INTEGER | Versi sesi untuk invalidasi |
| `created_at` | TIMESTAMPTZ | Waktu dibuat |
| `updated_at` | TIMESTAMPTZ | Waktu diperbarui |

### 11.2 `sensor_readings`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | SERIAL | Primary key |
| `sensor_id` | VARCHAR(50) | `TEMP-L4` atau `TEMP-L5` |
| `temperature` | NUMERIC(4,2) | Suhu dalam °C |
| `voltage` | NUMERIC(5,2) | Tegangan (nullable, hanya L4) |
| `current` | NUMERIC(6,3) | Arus (nullable, hanya L4) |
| `recorded_at` | TIMESTAMPTZ | Waktu perekaman |

Indeks utama:

```sql
(sensor_id, recorded_at DESC)
```

### 11.3 `temperature_alerts`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | SERIAL | Primary key |
| `reading_id` | INTEGER | Referensi pembacaan, nullable saat arsip |
| `sensor_id` | VARCHAR(50) | Identitas sensor |
| `level` | VARCHAR(20) | `Waspada` atau `Bahaya` |
| `status` | VARCHAR(20) | `Aktif` atau `Ditangani` |
| `temperature` | NUMERIC(4,2) | Nilai saat peringatan dibuat |
| `title` | VARCHAR(150) | Judul peringatan |
| `detail` | TEXT | Detail kondisi |
| `created_at` | TIMESTAMPTZ | Waktu dibuat |
| `acknowledged_at` | TIMESTAMPTZ | Waktu diakui |
| `resolved_at` | TIMESTAMPTZ | Waktu siklus selesai |
| `handled_by` | UUID | Pengguna yang menangani |

Constraint: hanya boleh ada **satu peringatan aktif per sensor** (unique partial index).

### 11.4 `voltage_alerts`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | SERIAL | Primary key |
| `reading_id` | INTEGER | Referensi pembacaan, nullable saat arsip |
| `sensor_id` | VARCHAR(50) | Identitas sensor |
| `anomaly_type` | VARCHAR(10) | `Drop` atau `Surge` |
| `level` | VARCHAR(20) | `Waspada` atau `Bahaya` |
| `status` | VARCHAR(20) | `Aktif` atau `Ditangani` |
| `voltage` | NUMERIC(6,2) | Nilai tegangan saat peringatan |
| `title` | VARCHAR(150) | Judul peringatan |
| `detail` | TEXT | Detail kondisi |
| `created_at` | TIMESTAMPTZ | Waktu dibuat |
| `acknowledged_at` | TIMESTAMPTZ | Waktu diakui |
| `resolved_at` | TIMESTAMPTZ | Waktu siklus selesai |
| `handled_by` | UUID | Pengguna yang menangani |

Constraint: hanya boleh ada **satu peringatan tegangan aktif per sensor**.

### 11.5 `monitoring_settings`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | VARCHAR(20) | `'global'` (satu record) |
| `warning_temperature` | NUMERIC(4,2) | Batas waspada L4 |
| `danger_temperature` | NUMERIC(4,2) | Batas bahaya L4 |
| `warning_temperature_l5` | NUMERIC(4,2) | Batas waspada L5 |
| `danger_temperature_l5` | NUMERIC(4,2) | Batas bahaya L5 |
| `voltage_min` | NUMERIC(5,2) | Batas minimum tegangan |
| `voltage_max` | NUMERIC(5,2) | Batas maksimum tegangan |
| `refresh_interval` | INT | Interval polling UI (detik) |
| `offline_timeout` | INT | Batas offline sensor (detik) |
| `sensor_name` | VARCHAR(100) | Nama sensor |
| `sensor_id` | VARCHAR(50) | ID sensor |
| `browser_notification` | BOOLEAN | Toggle notifikasi browser |
| `sound_alert` | BOOLEAN | Toggle suara peringatan |
| `updated_at` | TIMESTAMPTZ | Waktu perubahan |

### 11.6 `monthly_export_logs`

Tabel ini mencatat proses arsip bulanan.

Kolom utama:
- Bulan arsip;
- Status proses (`PROCESSING` → `UPLOADED` → `COMPLETED` atau `FAILED`);
- Jumlah data sumber;
- Jumlah data yang diekspor;
- ID file Google Drive;
- URL file;
- Pesan error;
- Waktu mulai dan selesai.

---

## 12. API dan Kontrak

### 12.1 Sensor

| Method | Endpoint | Akses | Fungsi |
|---|---|---|---|
| POST | `/api/sensor` | Bearer API key | Menyimpan pembacaan sensor |
| GET | `/api/sensor/history` | Login | Mengambil riwayat sensor |

### 12.2 Peringatan

| Method | Endpoint | Akses | Fungsi |
|---|---|---|---|
| GET | `/api/alerts` | Login | Mengambil daftar peringatan suhu |
| PATCH | `/api/alerts` | Login | Menandai peringatan sebagai ditangani |

Parameter GET: `limit`, `status`, `level`.

### 12.3 Pengaturan

| Method | Endpoint | Akses | Fungsi |
|---|---|---|---|
| GET | `/api/settings` | Login | Membaca pengaturan global |
| POST | `/api/settings` | Admin | Mengubah pengaturan global |

### 12.4 Autentikasi

Auth.js menangani route autentikasi di:

```text
/api/auth/[...nextauth]
```

API akun tambahan:

```text
/api/account/verify-email
/api/account/confirm-password
/api/account/change-first-password
```

### 12.5 Google Drive dan Arsip

Route yang digunakan:

```text
GET  /api/google/oauth-start
GET  /api/google/oauth-callback
POST /api/cron/monthly-export
```

### 12.6 Format Error

Format respons error yang konsisten:

```json
{
  "success": false,
  "error": "Pesan singkat",
  "details": "Detail aman untuk debugging"
}
```

Stack trace, credential, dan connection string tidak boleh dikirim ke browser.

---

## 13. Keamanan

- Seluruh rahasia disimpan dalam environment variable, tidak di repository.
- `SENSOR_API_KEY` digunakan untuk autentikasi ESP32 via Bearer token.
- Password pengguna disimpan dengan hash bcrypt.
- Query database menggunakan parameterized query untuk mencegah SQL injection.
- Koneksi database menggunakan SSL.
- Refresh token Google tidak ditampilkan pada respons client.
- `CRON_SECRET` melindungi endpoint cron dari akses luar.
- Log produksi tidak mencetak password atau rahasia apapun.

Environment variable utama:

```text
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
AUTH_SECRET
SENSOR_API_KEY
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_FOLDER_ID
CRON_SECRET
APP_URL
RESEND_API_KEY
```

---

## 14. Kebutuhan Nonfungsional

### NFR-001 — Performa

- Dashboard awal tampil dalam waktu kurang dari 3 detik pada koneksi normal.
- API pembacaan terbaru merespons kurang dari 500 ms pada beban normal.
- Grafik tidak merender lebih dari 300–360 titik sekaligus.
- Query riwayat menggunakan indeks `(sensor_id, recorded_at DESC)`.
- Polling tidak mengambil ribuan baris secara berulang.

### NFR-002 — Reliabilitas

- Kegagalan satu payload tidak menghentikan sistem.
- Transaksi pembacaan dan peringatan rollback jika terjadi error.
- Data terakhir tetap ditampilkan ketika polling terbaru gagal.
- Permintaan polling tidak ditumpuk jika request sebelumnya belum selesai.
- Proses arsip yang gagal tidak menghapus data sumber.

### NFR-003 — Skalabilitas

- Desain mendukung lebih dari satu sensor (L4 dan L5).
- Query selalu menggunakan filter `sensor_id`.
- Tabel memiliki indeks yang sesuai.

### NFR-004 — Aksesibilitas

- Tombol memiliki label yang jelas.
- Status tidak bergantung pada warna saja.
- Navigasi dapat digunakan melalui keyboard.
- Kontras warna cukup.
- Layout terbaca pada layar kecil.

### NFR-005 — Maintainability

- TypeScript digunakan di seluruh kodebase.
- Validasi request menggunakan Zod.
- Fungsi format waktu menggunakan `Asia/Jakarta` secara konsisten.
- Perubahan fitur diperbarui pada dokumen PRD secara berkala.

---

## 15. Kriteria Penerimaan

### 15.1 Sensor dan API

- [x] ESP32 berhasil mengirim data dengan Bearer API key.
- [x] Payload invalid ditolak dengan status 400.
- [x] Data `TEMP-L4` (suhu, tegangan, arus) tersimpan di database.
- [x] Data `TEMP-L5` (suhu) tersimpan di database.

### 15.2 Dashboard

- [x] Suhu terbaru L4 dan L5 tampil dari database.
- [x] Tegangan dan arus L4 tampil dari database.
- [x] Status suhu mengikuti pengaturan (threshold dari database).
- [x] Sensor berubah offline setelah timeout.
- [x] Grafik muncul tanpa delay berlebihan.
- [x] Periode 1, 6, dan 24 jam berfungsi.

### 15.3 Grafik dan Riwayat

- [x] Halaman grafik memakai data asli L4 dan L5.
- [x] Periode 7 hari berfungsi.
- [x] Export CSV menghasilkan kolom terpisah (suhu L4, L5, tegangan, arus).
- [x] Waktu tampil dalam WIB.

### 15.4 Peringatan

- [x] Peringatan suhu dibuat saat masuk Waspada atau Bahaya.
- [x] Peringatan suhu meningkat (eskalasi) saat masuk Bahaya.
- [x] Tidak ada duplikasi peringatan aktif per sensor.
- [x] Siklus selesai saat suhu kembali normal.
- [x] Peringatan tegangan dibuat saat Drop atau Surge.
- [x] Email notifikasi terkirim ke pengguna aktif saat peringatan baru.
- [x] Peringatan dapat ditandai sebagai ditangani.

### 15.5 Pengaturan

- [x] Batas suhu L4 dapat dikonfigurasi.
- [x] Batas suhu L5 dapat dikonfigurasi secara terpisah.
- [x] Batas tegangan min/max dapat dikonfigurasi.
- [x] Hanya admin yang dapat menyimpan perubahan pengaturan.

### 15.6 Arsip Bulanan

- [x] File Excel memiliki dua sheet wajib.
- [x] Kolom suhu L4, L5, tegangan, dan arus terpisah.
- [x] File diunggah ke Google Drive.

### 15.7 Keamanan

- [x] Halaman privat tidak dapat dibuka tanpa login.
- [x] API key sensor tidak tersedia pada client.
- [x] Perubahan pengaturan memerlukan role ADMIN.

---

## 16. Pengujian

### 16.1 Unit Test

- Klasifikasi suhu Normal/Waspada/Bahaya;
- Klasifikasi tegangan Normal/Drop/Surge;
- Kalkulasi level alert tegangan berdasarkan deviasi;
- Validasi payload sensor (Zod schema);
- Perhitungan min/max/rata-rata;
- Pembentukan rentang bulan WIB;
- Pemetaan data Excel.

### 16.2 Integration Test

- `POST /api/sensor` → PostgreSQL → alert handler;
- Insert pembacaan suhu dan peringatan dalam satu transaksi;
- Insert pembacaan tegangan dan voltage alert;
- `GET /api/sensor/history` dengan filter;
- `GET`/`PATCH` `/api/alerts`;
- Login dan otorisasi role;
- Upload file ke Google Drive.

### 16.3 End-to-End Test

- Login sebagai admin;
- Melihat dashboard L4 dan L5;
- Mengganti periode grafik;
- Melihat dan menangani peringatan;
- Mengubah batas suhu dan tegangan;
- Menguji siklus suhu: normal → waspada → bahaya → normal;
- Menguji sensor berhenti mengirim (offline);
- Export CSV;
- Arsip bulanan.

---

## 17. Status Implementasi

| Area | Status | Catatan |
|---|---|---|
| Next.js dan UI | ✅ Selesai | App Router, Shadcn UI, Tailwind, dark mode |
| Login & Autentikasi | ✅ Selesai | Auth.js, JWT, verifikasi email, ganti password |
| Role admin | ✅ Selesai | Pengaturan dibatasi admin |
| PostgreSQL Supabase | ✅ Selesai | Driver `pg` |
| Sensor Lantai 4 (`TEMP-L4`) | ✅ Aktif | Suhu + tegangan + arus |
| Sensor Lantai 5 (`TEMP-L5`) | ✅ Aktif | Suhu |
| API sensor | ✅ Selesai | Suhu, tegangan, arus |
| Alert suhu L4 & L5 | ✅ Selesai | Dengan threshold terpisah |
| Alert tegangan | ✅ Selesai | Drop/Surge dengan level Waspada/Bahaya |
| Notifikasi email | ✅ Selesai | Kirim ke semua pengguna aktif |
| Dashboard | ✅ Aktif | L4 + L5 + tegangan |
| Halaman grafik | ✅ Aktif | L4, L5, tegangan, arus, CSV export |
| Riwayat | ✅ Tersedia | Filter sensor/jam/tanggal/limit |
| Peringatan | ✅ Tersedia | Siklus suhu + tegangan, tandai ditangani |
| Pengaturan | ✅ Tersedia | Threshold L4, L5, tegangan, polling |
| Google OAuth/Drive | ✅ Selesai | Upload file arsip |
| Excel bulanan | ✅ Selesai | Workbook otomatis |

---

## 18. Roadmap

### Fase 1 — Sistem Utama
- Core API sensor L4 dan L5, monitoring tegangan dan arus.
- Alert suhu dan tegangan serta email notifikasi.
- Dashboard, grafik, riwayat, peringatan, dan pengaturan.

### Fase 2 — Optimasi Realtime & Data
- Incremental polling data terbaru.
- Change-based monitoring & Heartbeat perangkat.
- Pembatasan dan downsampling titik grafik.

### Fase 3 — Otomatisasi Arsip & Observability
- Arsip otomatis bulanan ke Google Drive.
- Verification & automatic data cleanup retention.
- Monitoring error rate dan latensi API.
- Dokumentasi operasional dan runbook insiden.

---

## 19. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Data identik tersimpan terus | Ukuran database meningkat | Change-based monitoring + heartbeat |
| Suhu stabil membuat sensor dianggap offline | Status offline keliru | Heartbeat terpisah (`last_seen`) |
| Riwayat 24 jam sangat besar | Performa grafik melambat | Limit API, incremental polling, downsampling |
| Upload Drive berhasil tetapi log gagal | Status arsip tidak konsisten | Transaksi idempotent, retry logic |
| Data terhapus sebelum file valid | Kehilangan data | Verifikasi row count sebelum delete |
| API key bocor | Akses tidak sah | Rotasi secret, Bearer auth |
| Perbedaan zona waktu | Filter tanggal keliru | Canonical `Asia/Jakarta` (`TIMESTAMPTZ`) |

---

## 20. Keputusan Produk

1. Ambang perubahan suhu untuk change-based monitoring dikonfigurasi pada level firmware sensor.
2. Interval heartbeat disesuaikan dengan `offline_timeout`.
3. Arsip bulanan dijalankan otomatis pada tanggal 1 setiap bulan (WIB).
4. Retensi data mengikuti jadwal verifikasi kelengkapan arsip bulanan.

---

## 21. Tata Kelola PRD

PRD ini adalah dokumen sumber kebenaran (*single source of truth*) untuk Server Room Monitoring System. Dokumen ini harus diperbarui apabila terdapat perubahan pada kebutuhan produk, arsitektur, kontrak API, skema data, maupun alur operasional utama.

---

## 22. Definition of Done

Suatu fitur dianggap selesai apabila:

1. Kebutuhan dan kriteria penerimaan tertulis secara jelas di PRD;
2. Implementasi frontend dan backend selesai;
3. Validasi dan penanganan error berfungsi dengan baik;
4. Keamanan dan otorisasi telah diperiksa;
5. Build produksi berhasil tanpa error;
6. Pengujian utama berhasil dijalankan;
7. Dokumentasi PRD diperbarui;
8. Tidak ada data simulasi yang ditampilkan sebagai data produksi;
9. Perubahan tidak merusak fitur yang sudah berjalan.
