# Naskah Tutorial FRLcast (cara pemakaian)

Naskah ini untuk direkam jadi video tutorial. Tiap modul = satu segmen video.
Format tiap langkah:

- **Layar:** apa yang ditampilkan / diklik di layar (untuk rekaman OBS).
- **Narasi:** yang kamu ucapkan (voiceover). Boleh dibaca apa adanya atau diparafrase.
- **Label:** teks lower-third / callout yang nanti ditambahkan Remotion.

Total kalau semua modul direkam kira-kira 20 sampai 30 menit. Boleh dipecah jadi
beberapa video pendek (per bagian A sampai E), atau satu video panjang dengan bab.

## Persiapan rekaman (baca dulu, jangan direkam)

- Resolusi OBS **1920x1080**, 30fps. Ini sama dengan resolusi overlay, jadi rapi.
- Nyalakan **highlight kursor** dan **klik visual** (OBS punya, atau pakai aplikasi seperti
  Mouseposé) supaya penonton tahu kamu klik di mana.
- Siapkan **1 event contoh** dengan beberapa driver dummy (nama unik) supaya semua halaman
  ada isinya saat direkam. Jangan pakai data event asli.
- Mic sedekat mungkin, ruangan sepi. Kalau salah ngomong, diam 2 detik lalu ulang kalimatnya,
  gampang dipotong nanti.
- Rekam per modul (berhenti-mulai), jangan satu take panjang. Lebih gampang diedit.

Kredit di akhir tiap video: **FRLcast by kinkpedil12, frlcast.my.id**.

---

# BAGIAN 0: PEMBUKA

## Modul 0.1: Apa itu FRLcast
- **Layar:** logo / landing page frlcast.my.id.
- **Narasi:** "FRLcast adalah sistem broadcast untuk balapan FR Legends. Dia menangani timing
  otomatis, leaderboard, overlay untuk OBS, aplikasi pembalap di Android, sampai komentator
  suara. Di video ini aku jelaskan semua bagiannya dari awal sampai siap tayang."
- **Label:** `FRLcast, broadcast untuk FR Legends`

## Modul 0.2: Dua cara memakainya
- **Layar:** tampilkan dua tab, satu frlcast.my.id, satu localhost:4700.
- **Narasi:** "Ada dua cara pakai. Pertama, mode hosted lewat frlcast.my.id, tanpa instal
  apa pun, cocok buat landing, halaman penonton, dan event ringan. Kedua, mode desktop atau
  lokal, aplikasi yang dijalankan di komputer operator, ini yang paling lengkap: timing
  otomatis, komentator suara, dan koneksi ke API timing resmi. Fungsi konsolnya sama, cuma
  sumber datanya beda."
- **Label:** `2 mode: Hosted (web) dan Desktop (lokal)`

---

# BAGIAN A: MODE HOSTED (frlcast.my.id)

## Modul A.1: Keliling landing page
- **Layar:** buka frlcast.my.id, scroll pelan dari atas ke bawah.
- **Narasi:** "Ini halaman depan. Di sini penonton dan penyelenggara masuk. Ada tombol masuk,
  penjelasan fitur, dan link download aplikasi desktop. Perhatikan, untuk fitur komentator dan
  otomatis penuh, disarankan pakai aplikasi desktop, ada keterangannya di sini."
- **Label:** `Landing page, frlcast.my.id`

## Modul A.2: Daftar dan masuk
- **Layar:** klik Login, tunjukkan halaman login/daftar, buat akun contoh, lalu masuk.
- **Narasi:** "Untuk membuat event, kamu daftar dulu. Isi email dan kata sandi, verifikasi,
  lalu masuk. Akun ini yang memiliki event kamu."
- **Label:** `Buat akun, lalu login`
- **Catatan aman:** jangan tampilkan kata sandi asli di kamera. Pakai akun contoh.

## Modul A.3: Dashboard, membuat event
- **Layar:** setelah login masuk ke dashboard. Buat event baru (isi nama, round, sirkuit).
  Tunjukkan **kode event** yang dihasilkan.
- **Narasi:** "Di dashboard kamu membuat event. Isi nama liga, nama round, dan sirkuit. Setelah
  dibuat, kamu dapat kode event. Kode ini kunci semuanya: konsol, overlay, dan halaman penonton
  semua menunjuk ke event lewat kode ini."
- **Label:** `Dashboard, buat event dan dapat kode`

## Modul A.4: Membuka konsol operator
- **Layar:** dari dashboard buka konsol (console) untuk event tadi. Tunjukkan 10 tombol menu
  di kiri.
- **Narasi:** "Ini konsol operator, pusat kendali. Di kiri ada sepuluh halaman: Race control,
  Event scenes, Championship, Drivers, Drift battles, Vision AI, Overlays, Layout, OBS setup,
  dan Help. Angka satu sampai sembilan di keyboard adalah pintasan ke tiap halaman. Kita bahas
  satu per satu."
- **Label:** `Konsol operator, 10 halaman (pintasan 1-9)`
- **Catatan:** ingatkan aturan "satu konsol per event". Dua tab konsol untuk event yang sama
  akan saling menimpa timing.

---

# BAGIAN B: KONSOL OPERATOR (sama untuk hosted maupun desktop)

## Modul B.1: Race control (halaman 1)
- **Layar:** halaman Race control. Tunjukkan tiap kartu dari atas ke bawah:
  Session, Live classification, Manual control, Event details, Driver sign-ins,
  Sessions & grid, Race control (penalti), Highlights for the VOD, Recent events.
- **Narasi (per kartu):**
  - Session: "Kartu Session mengatur status balapan: green flag, yellow, red, sampai chequered.
    Statusnya tampil besar supaya kelihatan sekilas."
  - Live classification: "Ini klasemen langsung, urutan pembalap yang dihitung sistem secara
    real time."
  - Manual control: "Kalau timing otomatis tidak dipakai, nyalakan Manual mode. Di sini kamu
    bisa menandai lap tiap pembalap manual dan menggeser urutan."
  - Event details: "Nama event, round, sirkuit, jumlah lap. Data ini muncul di overlay dan
    halaman penonton."
  - Driver sign-ins: "Kalau pembalap mendaftar lewat aplikasi HP, permintaan mereka muncul di
    sini untuk kamu terima."
  - Sessions & grid: "Simpan hasil satu sesi lalu jadikan grid start, bisa dibalik untuk reverse
    grid."
  - Race control (penalti): "Di sini kamu memberi penalti, track limits, sampai black flag.
    Semua tercatat dan tampil ke pembalap serta overlay."
  - Highlights for the VOD: "Ini fitur penting buat editor. Aku bahas terpisah di modul VOD."
  - Recent events: "Log kejadian terbaru: salip, lap tercepat, pit, penalti."
- **Label:** `Race control, pusat kendali balapan`

## Modul B.2: Highlights for the VOD (fokus khusus)
- **Layar:** masih di Race control, fokus kartu Highlights for the VOD. Tekan Start markers,
  tunjukkan penanda bertambah otomatis, tekan Mark now untuk penanda manual, geser slider
  Nudge. Lalu tunjukkan tombol export: YouTube chapters, Marker CSV, Subtitles srt, Highlight
  reel.
- **Narasi:** "Tekan Start markers persis saat kamu menekan Record di OBS. Mulai saat itu,
  setiap salip, lap tercepat, pit, dan hasil battle otomatis dicatat dengan stempel waktu. Kamu
  juga bisa menandai momen manual dengan tombol Mark now. Kalau Record di OBS meleset sedikit,
  geser Nudge untuk menyelaraskan. Di akhir, ekspor jadi empat format: bab YouTube, CSV,
  subtitle srt yang bisa langsung menempel di video, dan cut sheet highlight reel untuk editor.
  Jadi daftar editnya sudah jadi sambil kamu siaran."
- **Label:** `Highlights VOD, edit list otomatis sambil siaran`

## Modul B.3: Event scenes (halaman 2)
- **Layar:** halaman Event scenes. Klik antar scene, tunjukkan indikator On air dan transisi.
- **Narasi:** "Scene adalah tampilan overlay yang berbeda dari satu URL yang sama. Contohnya
  scene Qualifying menampilkan timing tower dan sektor, scene Race menampilkan leaderboard dan
  lower third. Klik satu scene untuk menayangkannya, overlay langsung cross-fade. Halaman
  Overlays dan Layout mengedit scene yang sedang aktif."
- **Label:** `Event scenes, ganti tampilan sekali klik`

## Modul B.4: Championship (halaman 3)
- **Layar:** halaman Championship. Tunjukkan Race report, Standings, Rounds (Bank current
  result), Scoring (tabel poin, drop worst), Export.
- **Narasi:** "Championship mengelola klasemen musim. Setelah satu round selesai, tekan Bank
  current result untuk memasukkan hasilnya. Standings dihitung otomatis dengan aturan poin yang
  kamu atur di Scoring, termasuk poin lap tercepat, pole, dan opsi buang hasil terburuk. Hasilnya
  bisa diekspor ke CSV."
- **Label:** `Championship, klasemen musim otomatis`

## Modul B.5: Drivers (halaman 4)
- **Layar:** halaman Drivers, kartu Roster. Tambah driver, isi nomor, nama, tim, warna, foto.
- **Narasi:** "Di Drivers kamu mengisi daftar pembalap: nomor, nama, tim, dan warna. Warna ini
  yang dipakai overlay dan minimap untuk mengenali tiap mobil. Nama harus unik dan sama persis
  dengan nama di dalam game, karena timing otomatis mencocokkan lewat nama."
- **Label:** `Drivers, daftar pembalap dan warnanya`

## Modul B.6: Drift battles (halaman 5)
- **Layar:** halaman Drift battles. Tunjukkan Format, Qualifying (Build bracket), Battle, Bracket.
- **Narasi:** "Untuk format tandem drift, halaman ini membuat bracket dari hasil kualifikasi,
  menjalankan battle satu lawan satu, mendukung One More Time, dan menampilkan bagan sampai
  juara. Semua muncul di overlay bracket dan battle."
- **Label:** `Drift battles, bracket tandem`

## Modul B.7: Vision / AI (halaman 6)
- **Layar:** halaman Vision AI. Bahas kartu: Live timing official API, Capture, Minimap zone,
  Detection log, Timing lines, Regions, Tracking, Engine settings, Performance, Trained model.
- **Narasi:**
  - "Ini otak timing otomatis. Ada tiga sumber timing: API resmi, computer vision dari minimap,
    atau manual."
  - Live timing API: "Kalau kamu punya API key resmi FR Legends, masukkan di kartu Live timing,
    isi Room Key, tekan Start. Sistem menarik lap time resmi langsung dari server game. Ini
    fitur lokal, hanya jalan di aplikasi desktop."
  - Capture dan Minimap zone: "Kalau tanpa API, sistem membaca minimap di dalam game. Kamu
    bagikan layar game, lalu tandai kotak area minimap. Sistem mengenali tiap mobil dari
    warnanya, tanpa model AI."
  - Timing lines dan Regions: "Gambar garis finish dan garis sektor di atas minimap. Setiap
    mobil yang melewatinya dihitung sebagai lap atau split."
  - Tracking, Engine settings, Performance: "Di sini kamu memantau apakah tiap mobil terdeteksi,
    mengatur sensitivitas, dan melihat FPS pemrosesan."
  - Trained model: "Opsional, untuk yang mau pakai model terlatih. Tidak wajib."
- **Label:** `Vision AI, timing otomatis (API, minimap, atau manual)`
- **Catatan:** tekankan bahwa untuk pemula, cara paling aman adalah Manual mode atau API resmi.

## Modul B.8: Overlays (halaman 7)
- **Layar:** halaman Overlays. Tunjukkan Visibility (nyala-matikan tiap widget), Motion check,
  Spoken commentary (pilih engine browser atau Piper, tombol Hear this voice), Focus driver,
  Ticker, Live preview.
- **Narasi:** "Overlays mengatur apa yang tampil. Di Visibility kamu nyalakan atau matikan tiap
  widget: leaderboard, timing tower, sektor, delta, gap, radio, dan lainnya. Spoken commentary
  memberi komentator suara: pilih engine browser yang gratis, atau Piper yang suaranya jauh
  lebih natural, khusus aplikasi desktop. Focus driver memilih pembalap yang disorot widget
  seperti sektor dan delta. Live preview menampilkan hasilnya 1920 kali 1080."
- **Label:** `Overlays, atur widget dan komentator`

## Modul B.9: Layout (halaman 8)
- **Layar:** halaman Layout. Seret satu widget di kanvas, ubah skala, ganti Broadcast skin,
  Template, League branding (upload logo), Overlay style.
- **Narasi:** "Layout mengatur posisi dan gaya. Seret tiap widget ke tempat yang kamu mau,
  atur ukurannya, dan simpan per scene. Ganti skin dan tema untuk mengubah tampilan sekaligus,
  dan unggah logo liga di League branding. Semua perubahan langsung sampai ke overlay yang
  tayang."
- **Label:** `Layout, tata letak dan branding`

## Modul B.10: OBS setup (halaman 9)
- **Layar:** halaman OBS setup. Tunjukkan URL overlay yang direkomendasikan (satu source),
  cara komentator, source per-widget, Network, Multi-device, Remote lap trigger, Keyboard
  shortcuts, OBS WebSocket, Discord.
- **Narasi:** "Halaman ini memberi URL untuk dipasang di OBS. Cara paling gampang: satu Browser
  Source memuat semua overlay sekaligus. Copy URL-nya, di OBS tambah Browser Source, tempel,
  set 1920 kali 1080. Ada juga URL komentator, pengaturan multi-perangkat, pintasan keyboard,
  koneksi OBS WebSocket supaya konsol bisa ganti scene OBS otomatis, dan integrasi Discord."
- **Label:** `OBS setup, pasang overlay ke OBS`
- **Catatan:** OBS Browser Source tidak bisa lewat cert self-signed, jadi pakai URL http biasa,
  bukan https. Sebutkan ini singkat.

## Modul B.11: Help (halaman 10)
- **Layar:** halaman Help, scroll manualnya.
- **Narasi:** "Help berisi manual lengkap dwibahasa. Kalau lupa langkah, semuanya ada di sini."
- **Label:** `Help, manual di dalam aplikasi`

---

# BAGIAN C: HALAMAN PENONTON (publik, tanpa login)

Semua halaman ini dibuka dengan kode event, contohnya frlcast.my.id/event?event=KODE.

## Modul C.1: Event hub (/event)
- **Layar:** buka /event?event=KODE. Tunjukkan daftar peserta, klasemen, round sebelumnya,
  dan tombol ke halaman lain.
- **Narasi:** "Event hub adalah satu halaman publik yang mengumpulkan semua tentang event:
  daftar peserta, klasemen, round sebelumnya, dan link ke timing langsung, laporan, statistik,
  dan recap. Cocok dibagikan ke penonton di hari acara."
- **Label:** `Event hub, /event`

## Modul C.2: Live timing (/live)
- **Layar:** buka /live?event=KODE. Tunjukkan leaderboard langsung.
- **Narasi:** "Live timing menampilkan klasemen langsung ke penonton dari HP mereka, ikut
  bergerak seiring balapan."
- **Label:** `Live timing, /live`

## Modul C.3: Season stats (/stats)
- **Layar:** buka /stats?event=KODE. Tunjukkan kartu leader (most wins, most podiums, best
  average), tabel per pembalap, dan form strip.
- **Narasi:** "Season stats mengubah seluruh round jadi statistik per pembalap: jumlah round,
  poin, menang, podium, finis terbaik dan rata-rata, plus form strip yang menunjukkan hasil
  tiap round. Diperbarui otomatis, dan dwibahasa."
- **Label:** `Season stats, /stats`

## Modul C.4: Recap card (/recap)
- **Layar:** buka /recap?event=KODE. Tunjukkan kartu share PNG.
- **Narasi:** "Recap membuat kartu gambar hasil balapan untuk dibagikan ke sosial media."
- **Label:** `Recap card, /recap`

## Modul C.5: Race report (/report)
- **Layar:** buka /report?event=KODE. Tunjukkan laporan lengkap.
- **Narasi:** "Race report adalah laporan hasil lengkap yang bisa dicetak atau dibagikan setelah
  balapan."
- **Label:** `Race report, /report`

## Modul C.6: Multiview
- **Layar:** buka multiview. Tunjukkan beberapa overlay sekaligus.
- **Narasi:** "Multiview menampilkan beberapa overlay dalam satu layar, berguna untuk monitoring."
- **Label:** `Multiview`

---

# BAGIAN D: APLIKASI PEMBALAP (Android)

## Modul D.1: Aplikasi driver
- **Layar:** buka aplikasi FRLDriver di HP (atau emulator). Tunjukkan daftar/registrasi, login,
  layar bendera dan penalti, kirim team radio.
- **Narasi:** "Pembalap memasang aplikasi Android. Mereka mendaftar ke event, lalu melihat
  bendera dan penalti mereka secara langsung, dan bisa mengirim team radio ke operator dari HP.
  Permintaan daftar dan radio muncul di konsol operator."
- **Label:** `Aplikasi pembalap Android`

---

# BAGIAN E: APLIKASI DESKTOP

## Modul E.1: Download dan jalankan desktop
- **Layar:** dari landing page, klik download aplikasi desktop. Unzip, jalankan start.cmd,
  tunjukkan konsol terbuka di localhost.
- **Narasi:** "Untuk fitur penuh, unduh aplikasi desktop. Ekstrak, klik start.cmd, konsol
  terbuka sendiri tanpa instal apa pun. Di sinilah timing otomatis, edit grid Retired dan DNF,
  komentator Piper, dan koneksi API timing resmi bekerja penuh, yang tidak bisa jalan di web."
- **Label:** `Aplikasi desktop, fitur penuh`

---

# BAGIAN F: PENUTUP

## Modul F.1: Ringkasan dan penutup
- **Layar:** kembali ke overlay yang sedang tayang atau landing page.
- **Narasi:** "Itu keseluruhan FRLcast: dari daftar pembalap, timing, overlay, komentator,
  sampai halaman penonton dan aplikasi HP. Mulai dari yang sederhana, mode manual, lalu naik ke
  timing otomatis saat sudah nyaman. Selamat mencoba."
- **Label:** `FRLcast by kinkpedil12, frlcast.my.id`

---

## Urutan rekaman yang disarankan

Kalau mau dipecah jadi beberapa video pendek:
1. **Pengenalan + Hosted** (Bagian 0 dan A): "Mulai dari nol, buat event pertama."
2. **Konsol operator** (Bagian B): video terpanjang, boleh dipecah lagi per beberapa halaman.
3. **Halaman penonton** (Bagian C): "Yang dilihat penonton."
4. **Aplikasi pembalap dan desktop** (Bagian D dan E).

Nanti tiap video dibungkus Remotion: intro, lower-third tiap Label di atas, callout saat klik,
dan outro, dengan gaya FRLcast yang seragam.
