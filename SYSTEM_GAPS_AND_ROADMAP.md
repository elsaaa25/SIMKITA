# Analisis Kekurangan dan Roadmap Pengembangan

## Server Room Monitoring System

| Atribut | Nilai |
|---|---|
| Status dokumen | Draft untuk diskusi dan perencanaan |
| Tanggal analisis | 6 Agustus 2026 |
| Ruang lingkup | Kondisi sistem saat ini dan kebutuhan pengembangan berikutnya |
| Repository | `elsaaa25/server-room-monitoring` |
| Lingkungan produksi | Vercel |
| Database | PostgreSQL Supabase |

Dokumen ini merangkum kekurangan yang ditemukan pada implementasi saat ini dan menyusun urutan pengembangan yang disarankan. Dokumen ini tidak menggantikan PRD utama. Setelah keputusan produk disepakati, item yang dipilih perlu dimasukkan ke PRD dan changelog resmi.

---

## 1. Ringkasan Eksekutif

Sistem telah memiliki fondasi produk yang cukup lengkap: autentikasi, dashboard monitoring dua lantai, grafik, riwayat, peringatan, pengaturan suhu, profil pengguna, export CSV, serta arsip Excel bulanan ke Google Drive.

Prioritas berikutnya bukan menambah banyak fitur visual, tetapi memastikan fondasi keamanan, database, pengujian, dan operasional dapat dipercaya. Risiko terbesar saat ini berada pada otorisasi pengguna, endpoint konfigurasi Google, ketidaksinkronan schema database, ketiadaan heartbeat perangkat, serta belum tersedianya automated test dan CI.

Urutan prioritas yang disarankan:

1. perbaiki autentikasi dan endpoint sensitif;
2. rapikan migration dan schema database;
3. tambahkan pengujian otomatis dan CI;
4. pisahkan heartbeat dari data historis;
5. finalisasi proses arsip yang idempotent dan dapat diaudit;
6. lanjutkan integrasi sensor fisik serta notifikasi eksternal.

---

## 2. Kekurangan Sistem Saat Ini

### 2.1 Autentikasi dan Otorisasi

#### A. Role pengguna belum diterapkan dengan benar

Pada proses login, role dari database telah dibaca, tetapi hasil autentikasi mengembalikan role `ADMIN` secara tetap. Kondisi ini dapat menyebabkan akun `OPERATOR` memperoleh hak administrator.

**Dampak:**

- pemisahan akses `ADMIN` dan `OPERATOR` tidak dapat dipercaya;
- akun operator berpotensi mengubah pengaturan sistem;
- kontrol akses pada API yang mengandalkan role menjadi tidak efektif.

**Perbaikan yang dibutuhkan:**

- gunakan nilai `user.role` dari database;
- izinkan tipe `ADMIN | OPERATOR` pada tipe Auth.js;
- tambahkan integration test untuk kedua role;
- pastikan halaman dan endpoint pengaturan sama-sama memeriksa role.

#### B. Data keamanan JWT belum diteruskan dan diverifikasi secara lengkap

Nilai `mustChangePassword` dan `sessionVersion` telah disimpan ke token, tetapi belum diteruskan secara lengkap ke session. `sessionVersion` juga belum dibandingkan dengan nilai terbaru di database.

**Dampak:**

- kewajiban mengganti password pertama berpotensi tidak berjalan;
- session lama berpotensi tetap aktif setelah password berubah;
- invalidasi session belum benar-benar diterapkan.

**Perbaikan yang dibutuhkan:**

- salin `mustChangePassword` dan `sessionVersion` dari token ke session;
- verifikasi `sessionVersion` terhadap database pada titik yang tepat;
- keluarkan seluruh session lama setelah perubahan password sensitif;
- uji alur verifikasi email, password sementara, pergantian password, dan login ulang.

#### C. Endpoint Google Drive dan OAuth belum cukup dibatasi

Route pengujian Google Drive dapat membuat file dan belum memiliki pemeriksaan session administrator. Route OAuth start/callback juga belum dibatasi untuk admin dan callback masih mengembalikan refresh token melalui response.

**Dampak:**

- pengguna yang tidak berwenang dapat memicu operasi Google Drive;
- refresh token dapat terekspos;
- route konfigurasi dapat disalahgunakan di production;
- alur OAuth belum memiliki perlindungan `state` yang jelas.

**Perbaikan yang dibutuhkan:**

- nonaktifkan seluruh route test pada production;
- wajibkan session dan role `ADMIN` untuk konfigurasi Google;
- gunakan parameter OAuth `state` dan validasi callback;
- jangan tampilkan refresh token melalui response browser;
- simpan atau masukkan token melalui proses operasional yang aman.

#### D. Route setup perlu dibatasi setelah bootstrap

Route setup memang menolak pembuatan admin kedua ketika tabel pengguna sudah berisi data. Namun route tetap tersedia dan beberapa response error masih dapat menampilkan detail database.

**Perbaikan yang dibutuhkan:**

- matikan route setup melalui environment flag setelah bootstrap;
- gunakan token setup sekali pakai jika proses bootstrap tetap dibutuhkan;
- jangan mengembalikan pesan database mentah kepada browser;
- lindungi proses dari dua request bootstrap yang masuk bersamaan.

#### E. Belum ada perlindungan brute-force dan rate limiting

Endpoint login, verifikasi, perubahan password, setup, dan sensor belum memiliki mekanisme rate limiting yang terdokumentasi.

**Perbaikan yang dibutuhkan:**

- batasi percobaan login dan endpoint token;
- catat kegagalan autentikasi tanpa menyimpan password;
- tambahkan lockout sementara atau exponential backoff;
- pertimbangkan rate limiting per IP dan per akun.

---

### 2.2 Database dan Migration

File schema SQL belum sepenuhnya sesuai dengan kode aplikasi terbaru.

Contoh ketidaksesuaian:

- schema `sensor_readings` belum mendefinisikan kolom `current`;
- schema pengaturan belum mendefinisikan threshold khusus Lantai 5;
- perubahan keamanan akun tersebar dalam migration terpisah;
- belum ada urutan migration lengkap dari database kosong hingga versi terbaru;
- proses arsip mengacu pada kebutuhan log yang belum konsisten dengan implementasi.

**Dampak:**

- clone atau deployment baru sulit direproduksi;
- aplikasi dapat berhasil di satu database tetapi gagal di database lain;
- perubahan manual di Supabase sulit diaudit;
- risiko error `column does not exist` atau `relation does not exist` meningkat.

**Perbaikan yang dibutuhkan:**

- tentukan satu mekanisme migration resmi;
- buat migration berurutan dan idempotent;
- tambahkan seluruh kolom, indeks, constraint, dan default terbaru;
- sediakan perintah untuk memeriksa versi schema;
- uji provisioning pada database kosong sebelum production release.

---

### 2.3 Heartbeat dan Pertumbuhan Data Sensor

API saat ini masih menyimpan setiap payload yang valid ke `sensor_readings`. Belum tersedia heartbeat perangkat yang terpisah dari data historis.

**Dampak:**

- database bertambah cepat walaupun nilai sensor tidak berubah;
- status online masih bergantung pada pembacaan terakhir;
- perangkat yang hanya mengirim saat suhu berubah dapat dianggap offline;
- histori dan grafik dapat memuat terlalu banyak titik identik.

**Perbaikan yang dibutuhkan:**

- buat tabel `sensor_status` atau tabel perangkat;
- simpan `last_seen` melalui heartbeat terpisah;
- terapkan change-based monitoring dengan ambang yang disepakati;
- kirim ulang data jika request sebelumnya gagal;
- pertahankan heartbeat walaupun nilai sensor tidak berubah;
- tambahkan downsampling atau agregasi untuk data historis panjang.

---

### 2.4 Sensor dan Kualitas Data

Kode sudah mendukung Lantai 4, Lantai 5, tegangan, dan arus. Namun status pemasangan dan kalibrasi perangkat fisik belum terdokumentasi sebagai sumber kebenaran.

Kode contoh ESP32 juga memiliki fallback simulasi tegangan ketika perangkat fisik tidak terhubung.

**Dampak:**

- data simulasi dapat disalahartikan sebagai data produksi;
- pembacaan tegangan dan arus belum memiliki catatan kalibrasi;
- sulit membedakan sensor rusak, belum dipasang, dan sedang offline.

**Perbaikan yang dibutuhkan:**

- hapus atau lindungi simulasi dengan flag development yang eksplisit;
- tambahkan status perangkat: aktif, belum dipasang, maintenance, dan offline;
- dokumentasikan model sensor, toleransi, faktor kalibrasi, serta waktu kalibrasi;
- simpan versi firmware dan identitas perangkat;
- validasi nilai anomali dan perubahan yang tidak masuk akal.

---

### 2.5 Pengarsipan Bulanan

Cron bulanan sudah dapat membuat Excel, mengunggahnya ke Google Drive, dan menghapus data sumber setelah jumlah baris sesuai. Namun proses belum sepenuhnya idempotent dan belum memiliki audit trail lengkap.

**Risiko yang tersisa:**

- upload berhasil tetapi delete gagal dapat membuat file duplikat saat retry;
- belum ada pencatatan status lengkap pada `monthly_export_logs`;
- belum ada checksum atau verifikasi isi file;
- belum tersedia proses recovery otomatis;
- backup dan restore belum terdokumentasi.

**Perbaikan yang dibutuhkan:**

- gunakan satu record log untuk setiap bulan;
- tambahkan status `processing`, `uploaded`, `verified`, `completed`, dan `failed`;
- simpan file ID, row count, checksum, waktu proses, serta pesan error;
- cegah dua proses untuk bulan yang sama berjalan bersamaan;
- gunakan retry yang tidak membuat file duplikat;
- lakukan penghapusan hanya setelah verifikasi final;
- dokumentasikan prosedur restore.

---

### 2.6 Pengujian dan Continuous Integration

Repository belum memiliki unit test, integration test, E2E test, atau workflow CI. Pemeriksaan lint saat analisis menghasilkan 15 error dan 9 warning.

TypeScript pada checkout lokal juga belum dapat selesai karena dependency `resend` tercantum pada package tetapi belum tersedia pada `node_modules`. Kondisi dependency lokal perlu disinkronkan dengan lockfile menggunakan instalasi bersih.

**Dampak:**

- regresi autentikasi dan database mudah lolos ke production;
- perubahan UI dapat tanpa sengaja mengubah perilaku API;
- keberhasilan build sangat bergantung pada pengujian manual;
- merge conflict lebih sulit dikenali sejak awal.

**Perbaikan yang dibutuhkan:**

- selesaikan seluruh error lint;
- gunakan `npm ci` sebagai instalasi standar CI;
- tambahkan unit test, integration test, dan E2E test;
- jalankan lint, TypeScript, test, dan build pada setiap pull request;
- blokir merge apabila pemeriksaan wajib gagal.

---

### 2.7 Dokumentasi dan Maintainability

Dokumentasi belum mengikuti perkembangan kode terbaru:

- `README.md` masih berupa template Next.js;
- terdapat dua PRD dengan ruang lingkup berbeda;
- PRD awal masih menjelaskan MQTT, sedangkan implementasi memakai HTTPS API;
- PRD versi 2 belum mencatat perkembangan setelah 23 Juli 2026;
- schema dan deployment guide belum mencerminkan seluruh fitur terbaru;
- beberapa komponen dashboard berukuran sangat besar dan menangani terlalu banyak tanggung jawab.

**Perbaikan yang dibutuhkan:**

- tetapkan satu PRD aktif;
- perbarui README dengan arsitektur, setup, environment, migration, dan pengujian;
- buat changelog release;
- pecah komponen besar berdasarkan fitur;
- pusatkan aturan threshold, sensor ID, dan format waktu;
- dokumentasikan prosedur deployment dan rollback.

---

### 2.8 Observability dan Operasional

Sistem belum memiliki health check, error tracking, metrik operasional, serta audit log yang lengkap.

**Perbaikan yang dibutuhkan:**

- tambahkan health check aplikasi, database, dan integrasi penting;
- pasang error tracking production;
- pantau latensi API, error rate, dan keberhasilan cron;
- buat audit log perubahan pengaturan dan akun;
- tambahkan alert operasional ketika sensor, database, atau cron gagal;
- buat runbook insiden dan daftar kontak penanggung jawab.

---

## 3. Ringkasan Prioritas Kekurangan

| ID | Area | Masalah utama | Prioritas |
|---|---|---|---|
| GAP-01 | Otorisasi | Role pengguna dikembalikan sebagai `ADMIN` | P0 — Kritis |
| GAP-02 | Session | `mustChangePassword` dan `sessionVersion` belum efektif | P0 — Kritis |
| GAP-03 | Google Integration | Route test/OAuth belum dibatasi dengan aman | P0 — Kritis |
| GAP-04 | Database | Schema SQL tidak sinkron dengan implementasi | P0 — Kritis |
| GAP-05 | Testing | Tidak ada automated test dan CI | P1 — Tinggi |
| GAP-06 | Code Quality | Lint belum bersih | P1 — Tinggi |
| GAP-07 | Sensor | Heartbeat dan `last_seen` belum tersedia | P1 — Tinggi |
| GAP-08 | Storage | Setiap payload masih disimpan | P1 — Tinggi |
| GAP-09 | Archive | Proses belum idempotent dan audit trail belum lengkap | P1 — Tinggi |
| GAP-10 | Data Quality | Simulasi dan kalibrasi sensor belum dikendalikan | P1 — Tinggi |
| GAP-11 | Dokumentasi | README, PRD, schema, dan deployment guide tertinggal | P2 — Menengah |
| GAP-12 | Operasional | Health check, monitoring error, backup, dan runbook belum lengkap | P2 — Menengah |

---

## 4. Roadmap Pengembangan

### Fase 0 — Stabilisasi Keamanan

**Tujuan:** memastikan identitas dan hak akses pengguna dapat dipercaya sebelum menambah fitur baru.

Pekerjaan:

- perbaiki role `ADMIN` dan `OPERATOR`;
- perbaiki mapping JWT dan session;
- terapkan invalidasi session;
- lindungi route Google, OAuth, setup, dan route test;
- tambahkan OAuth `state`;
- tambahkan rate limiting pada endpoint sensitif;
- rotasi secret yang pernah terekspos dan dokumentasikan tanggal rotasi.

**Kriteria selesai:**

- operator tidak dapat membuka atau memanggil pengaturan admin;
- admin tetap dapat menggunakan seluruh fitur;
- session lama tidak berlaku setelah password diganti;
- route konfigurasi Google tidak dapat dipanggil tanpa admin;
- tidak ada refresh token atau detail database dalam response browser.

---

### Fase 1 — Database yang Dapat Direproduksi

**Tujuan:** memastikan clone dan deployment baru menghasilkan database yang sama dengan production.

Pekerjaan:

- pilih tooling migration;
- buat baseline schema terbaru;
- buat migration untuk sensor, threshold L5, akun, peringatan, dan arsip;
- tambah tabel versi migration;
- buat seed minimum yang aman;
- dokumentasikan setup Supabase;
- uji migration pada database kosong.

**Kriteria selesai:**

- database kosong dapat disiapkan hanya dari file repository;
- migration dapat dijalankan ulang dengan aman;
- seluruh endpoint menemukan tabel dan kolom yang dibutuhkan;
- tidak ada langkah SQL manual yang tidak terdokumentasi.

---

### Fase 2 — Quality Gate dan Automated Test

**Tujuan:** mencegah regresi sebelum perubahan masuk ke branch utama.

Pekerjaan:

- bersihkan error dan warning lint;
- tambahkan unit test untuk threshold, waktu WIB, dan mapping export;
- tambahkan integration test untuk login, role, sensor, alert, dan database;
- tambahkan E2E test untuk alur operator dan admin;
- buat workflow CI;
- wajibkan review dan status check sebelum merge.

**Kriteria selesai:**

- `npm ci`, lint, TypeScript, test, dan build berhasil di CI;
- role operator/admin diuji otomatis;
- siklus peringatan diuji dari normal hingga kembali normal;
- kegagalan test memblokir merge.

---

### Fase 3 — Heartbeat dan Efisiensi Data Sensor

**Tujuan:** memisahkan kesehatan perangkat dari perubahan data historis.

Pekerjaan:

- buat model perangkat dan `sensor_status`;
- tambahkan endpoint heartbeat;
- simpan `last_seen`, firmware, serta informasi kesehatan perangkat;
- terapkan change-based monitoring;
- sepakati ambang perubahan setiap metrik;
- tambahkan retry aman pada firmware;
- tambahkan downsampling grafik.

**Kriteria selesai:**

- suhu stabil tidak membuat sensor dianggap offline;
- heartbeat tidak menambah titik grafik;
- data identik tidak memenuhi database;
- dashboard menampilkan waktu heartbeat dan waktu data terakhir secara terpisah.

---

### Fase 4 — Finalisasi Arsip dan Operasional

**Tujuan:** menjamin arsip bulanan aman, dapat dicoba ulang, dan dapat diaudit.

Pekerjaan:

- implementasikan `monthly_export_logs` secara penuh;
- tambahkan locking per bulan;
- simpan checksum dan hasil verifikasi;
- cegah file duplikat;
- tambahkan retry terkontrol;
- buat notifikasi kegagalan cron;
- dokumentasikan backup dan restore;
- lakukan simulasi kegagalan upload, verifikasi, dan delete.

**Kriteria selesai:**

- proses bulan yang sama aman dijalankan ulang;
- kegagalan tidak menghapus data sumber;
- file, jumlah baris, dan status proses dapat diaudit;
- tersedia prosedur pemulihan yang sudah diuji.

---

### Fase 5 — Integrasi Sensor Fisik dan Kualitas Data

**Tujuan:** memastikan setiap nilai yang tampil berasal dari perangkat yang jelas dan terkalibrasi.

Pekerjaan:

- finalisasi sensor suhu Lantai 5;
- pasang dan kalibrasi sensor tegangan;
- pasang dan kalibrasi sensor arus;
- hapus fallback simulasi dari firmware produksi;
- tampilkan status pemasangan dan maintenance;
- simpan metadata kalibrasi;
- tambahkan deteksi nilai anomali.

**Kriteria selesai:**

- seluruh nilai production dapat ditelusuri ke sensor fisik;
- UI membedakan belum dipasang, maintenance, offline, dan error;
- hasil kalibrasi terdokumentasi;
- data simulasi tidak dapat masuk ke production tanpa penanda eksplisit.

---

### Fase 6 — Notifikasi dan Tata Kelola Operasional

**Tujuan:** membantu petugas menindaklanjuti kejadian, bukan hanya melihatnya pada dashboard.

Pekerjaan:

- email untuk alert kritis dan laporan;
- evaluasi WhatsApp atau Telegram;
- escalation policy berdasarkan durasi dan level;
- catatan tindak lanjut peringatan;
- audit log pengaturan dan akun;
- dashboard kesehatan sistem;
- runbook dan jadwal pemeriksaan operasional.

**Kriteria selesai:**

- notifikasi memiliki retry dan deduplikasi;
- setiap perubahan penting memiliki identitas pelaku dan waktu;
- peringatan memiliki status, petugas, catatan, dan waktu penyelesaian;
- operator memiliki panduan penanganan insiden.

---

### Fase 7 — Pengembangan Produk Lanjutan

Fase ini dilakukan setelah keamanan dan reliabilitas dasar selesai.

Kandidat fitur:

- manajemen akun operator melalui UI admin;
- laporan periodik yang dapat diunduh;
- perbandingan tren antar-lantai;
- maintenance schedule sensor;
- dashboard SLA dan uptime perangkat;
- banyak lokasi atau gedung jika kebutuhan organisasi berkembang;
- Server-Sent Events atau WebSocket apabila polling tidak lagi mencukupi.

---

## 5. Backlog Prioritas yang Disarankan

| Urutan | Pekerjaan | Hasil utama |
|---:|---|---|
| 1 | Perbaiki role dan session Auth.js | Hak akses admin/operator valid |
| 2 | Tutup route Google, OAuth, setup, dan test | Endpoint sensitif terlindungi |
| 3 | Buat baseline migration terbaru | Database dapat direproduksi |
| 4 | Bersihkan lint dan sinkronkan dependency | Quality gate dasar stabil |
| 5 | Tambahkan test autentikasi dan sensor | Regresi kritis terdeteksi otomatis |
| 6 | Aktifkan CI pada pull request | Merge tidak lolos jika pemeriksaan gagal |
| 7 | Implementasikan heartbeat | Status online tidak bergantung pada histori |
| 8 | Terapkan change-based monitoring | Pertumbuhan data terkendali |
| 9 | Finalisasi log dan idempotensi arsip | Export bulanan aman untuk retry |
| 10 | Finalisasi sensor fisik dan kalibrasi | Data production dapat dipercaya |
| 11 | Tambahkan observability dan runbook | Gangguan lebih cepat diketahui dan ditangani |
| 12 | Tambahkan notifikasi eksternal | Respons petugas lebih cepat |

---

## 6. Keputusan yang Perlu Disepakati

Sebelum implementasi lanjutan, pemilik produk perlu menetapkan:

1. hak akses rinci antara `ADMIN` dan `OPERATOR`;
2. ambang perubahan suhu, tegangan, dan arus;
3. interval heartbeat serta batas offline;
4. kebijakan retensi data setelah arsip;
5. apakah penghapusan otomatis langsung diaktifkan atau memerlukan persetujuan;
6. kanal notifikasi resmi;
7. siapa yang bertanggung jawab atas rotasi secret dan konfigurasi Vercel;
8. siapa yang menangani insiden sensor, database, dan Google Drive;
9. status pemasangan sensor fisik setiap lantai;
10. satu dokumen PRD yang dijadikan sumber kebutuhan utama.

---

## 7. Definition of Done untuk Roadmap Ini

Satu item roadmap dianggap selesai apabila:

1. kebutuhan dan risiko telah disepakati;
2. implementasi frontend/backend selesai;
3. validasi input dan penanganan error tersedia;
4. keamanan dan role sudah diperiksa;
5. migration tersedia apabila schema berubah;
6. automated test utama tersedia;
7. lint, TypeScript, test, dan production build berhasil;
8. dokumentasi dan PRD diperbarui;
9. deployment memiliki langkah rollback;
10. hasil sudah diverifikasi pada lingkungan yang sesuai tanpa menggunakan data simulasi sebagai data production.
