# FRL Broadcast — operator balapan FR Legends

Website operator untuk event balap FR Legends: timing, leaderboard, dan overlay siap-OBS,
dengan deteksi otomatis dari window emulator.

```
Emulator (FR Legends)  ──▶  Operator panel (browser)  ──▶  Server timing  ──▶  Overlay
     window capture           vision / AI + kontrol         state authoritative      OBS Browser Source
```

---

## 1. Jalankan

```bash
npm install
npm start
```

Buka http://localhost:4700 — itu panel operator.
Biarkan tab ini tetap terbuka selama live: capture dan deteksi jalan di tab ini.

Panduan lengkap ada di dalam aplikasinya sendiri: halaman **Help** (tombol `7`), bisa
dicari, dan jalan offline saat event berlangsung. README ini versi ringkasnya.

Sekali saja, biar OCR jalan tanpa internet:

```bash
npm run fetch-tessdata
```

---

## 2. Alur kerja saat event

1. **Drivers** — masukkan pembalap. Set `color` sama persis dengan warna mobil/dot di game;
   itu yang dipakai engine untuk melacak tiap mobil. Bisa import CSV (`num,name,team,car,color`).
2. **Race control** — isi nama event, round, track, jumlah lap.
3. **Vision / AI** — klik **Select emulator window**, pilih window LDPlayer / BlueStacks / scrcpy.
   Lalu kalibrasi (bagian 3 di bawah).
4. **OBS setup** — copy URL overlay, pasang sebagai Browser Source 1920×1080.
5. Klik **Start race** (atau tekan `Space`). Overlay langsung hidup.
6. Selesai balapan → **Export result** untuk CSV klasemen.

### Hotkey panel

| Tombol | Aksi |
|---|---|
| `Space` | start race / toggle green ↔ yellow |
| `Q W E R T Y U I` | catat lap manual untuk mobil P1–P8 |
| `1`–`5` | pindah halaman |

Hotkey lap manual adalah jaring pengaman: kalau deteksi meleset, operator tetap bisa
mengoreksi tanpa menghentikan siaran. `Undo` per pembalap juga ada di tabel.

---

## 3. Deteksi otomatis

### Cara kerjanya

Tiap frame melewati empat tahap. Semuanya aritmetika biasa — tanpa model, tanpa GPU,
tanpa alokasi memori per frame.

| Tahap | Apa yang terjadi |
|---|---|
| **1. Classify** | Tiap piksel di dalam minimap jadi indeks pembalap lewat *lookup cube* warna 32×32×32 yang dibangun sekali saat roster berubah. Satu pembacaan array per piksel. |
| **2. Blobs** | Connected-component (union-find) menyatukan piksel bertetangga jadi gumpalan. Diambil gumpalan terbesar per pembalap, jadi pantulan dan noise HUD terbuang. |
| **3. Tracker** | Tiap mobil punya track dengan posisi + kecepatan. Saat titiknya hilang (tertutup mobil lain, ketimpa HUD), track *meluncur* dengan kecepatan terakhir alih-alih hilang. Kecepatan ini juga yang bikin "mobil berhenti" bisa dideteksi. |
| **4. Crossing** | Perpindahan mobil antar frame diuji perpotongannya dengan tiap garis timing. Hasilnya bukan cuma "kena/tidak", tapi *di mana* dalam langkah itu — jadi waktunya diinterpolasi di antara dua frame. |

Kenapa ini penting: pendekatan lama "untuk tiap pembalap, pindai semua piksel" butuh
satu lintasan penuh per mobil — 12 mobil berarti 12 lintasan tiap frame. Cara ini
dua lintasan, berapa pun jumlah mobilnya.

Diukur pada minimap 200×180, 15fps, dengan simulasi lintasan penuh:

| | 4 mobil | 12 mobil |
|---|---|---|
| Biaya per frame | 7.6 ms | 8.3 ms |
| Porsi budget 15fps | 11% | 12% |

Naik 3× jumlah mobil hanya menambah 8% biaya. Kalau masih berat, **Pixel sampling**
`Every 2nd` memangkas ~34% lagi dan titik minimap (6–14px) masih jauh lebih besar dari
grid samplingnya.

### Sirkuit besar & kamera drone

Kalau seluruh sirkuit dimasukkan ke frame, mobilnya tinggal 3-5 piksel dan warnanya
bercampur dengan aspal. Dua jalan keluar:

**1. Arahkan kamera ke garis finish saja.** Timing balap sungguhan tidak melacak mobil
terus-menerus — ia memakai loop di titik tetap. Mobil hanya perlu terbaca saat melewati
satu garis. Lap, waktu lap, gap, interval, posisi, dan hasil akhir tetap jalan penuh.
Yang dilepas hanya widget Track map dan sektor. Sering ini pilihan yang paling tepat.

**2. Ganti Tracking method ke Motion atau Hybrid.** Sirkuitnya diam, yang bergerak hanya
mobil, jadi rata-rata berjalan tiap piksel adalah pelat latar dan apa pun yang menyimpang
darinya adalah mobil. Identitas tetap dari warna, tapi dirata-rata seluruh gumpalan.

Terukur pada simulasi bidikan drone lebar:

| Mobil | Warna tersisa | Deteksi warna | Deteksi gerak |
|---|---|---|---|
| 5 px | 60% | 100% | 100% |
| **5 px** | **40%** | **0%** | **100%** |
| **3 px** | **25%** | **0%** | **100%** |

Deteksi gerak mensyaratkan kamera diam. Kalau drone digerakkan saat balapan, semuanya
terlihat seperti mobil sampai pelat latarnya menyesuaikan lagi. Mobil yang berhenti lama
melebur ke latar — pakai Hybrid kalau itu masalah.

### Akurasi waktu

Karena perpotongan garis diinterpolasi, waktu lap tidak terkunci di kelipatan frame.
Pada uji simulasi 15fps (jarak antar frame 66.7 ms), lap 4.000 s terbaca **4.000 s** —
deteksi yang cuma tahu "frame ke berapa" akan meleset sampai ±66 ms.

### Draw tools

Tiap tool punya penjelasannya sendiri di panel (kartu di bawah pemilih tool berubah
mengikuti tool yang dipilih). Ringkasnya:

| Tool | Cara pakai | Yang kamu dapat |
|---|---|---|
| **Minimap zone** | Drag kotak rapat di area minimap | Posisi live semua mobil — sumber dari semua yang lain |
| **Finish line** | Klik 2 titik menyilang lintasan | Lap. Momennya diinterpolasi antar frame |
| **Sector line** | Klik 2 titik, urut sesuai arah balapan | Split per sektor. 2 garis sektor = 3 sektor |
| **Pit lane zone** | Drag kotak di cabang pit | Flag PIT dan hitungan pit stop otomatis |
| **Trigger zone** | Drag kotak, lalu **Capture ref** | Lap tanpa minimap sama sekali, dari kecocokan gambar |
| **OCR** (lap/time/position/speed/name) | Kotak rapat di angkanya saja | Baca HUD game langsung |
| **Model zone** | Kotak di area gameplay | Diserahkan ke model ONNX-mu (lihat TRAINING.md) |

Garis timing **belajar arahnya sendiri**: saat digambar ia menerima dua arah, lalu mobil
pertama yang melewatinya menetapkan arah yang dihitung. Jadi mobil yang goyang di atas
garis tidak dihitung dua kali. Tombol **Flip** membalik arahnya kalau salah.

Server menolak crossing yang tidak berurutan — sektor 2 tidak akan diterima kalau sektor 1
belum dilewati. Detektor yang sesekali salah tidak bisa merusak timing.

### Fitur yang jalan dari data tracking

- **Sektor berwarna** di timing tower: ungu = tercepat sesi, hijau = terbaik pribadi,
  kuning = biasa, redup = belum diset lap ini.
- **Track map** — overlay peta lintasan dengan titik tiap mobil bergerak live.
  Dari racing line yang kamu gambar. Nyalakan di halaman Overlays.
- **Stopped on track** — mobil diam melewati ambang batas ditandai otomatis, muncul
  merah di track map dan masuk event feed.
- **Pit otomatis** — mobil di dalam pit zone dapat flag PIT dan pit stop bertambah,
  dengan histeresis supaya satu frame nyasar tidak dihitung.
- **Event feed & auto ticker** — overtake, fastest lap, rekor sektor, pit, dan mobil
  berhenti ditulis otomatis. Ticker overlay memakainya kalau kamu tidak mengisi teks manual.

### Kalibrasi, langkah demi langkah

1. **Minimap zone** — drag kotak di minimap.
2. **Draw racing line** (mode di sebelah tool) — klik titik demi titik mengikuti lintasan
   di dalam minimap, tutup kembali ke titik awal. Ini yang dipakai untuk urutan posisi
   sebelum lap pertama, dan untuk track map.
3. **Finish line** — klik dua titik menyilang lintasan di garis start/finish.
4. **Sector line** ×2 — urut sesuai arah balapan.
5. Opsional: **Pit lane zone**.
6. Set warna tiap pembalap di halaman Drivers **sama persis** dengan warna titiknya di game.

### Setting deteksi dipakai bersama

Semua isi Engine settings tersimpan di server, bukan di browser. Mengaturnya di laptop
langsung mengubah apa yang dikerjakan mesin yang melihat game.

Yang tetap per-perangkat: **Capture width cap**, **Preview**, dan **Capture source**.

### Bagaimana Hybrid memutuskan

Bukan rata-rata dari dua hasil, tapi urutan kepercayaan:

1. Pencocokan warna jalan dulu; yang ketemu di sini dipakai apa adanya.
2. Deteksi gerak jalan berikutnya, tapi gumpalan yang identitasnya sudah ditemukan
   lewat warna diabaikan — supaya satu mobil tidak dihitung dua kali.
3. Gumpalan gerak yang identitasnya belum terwakili ditambahkan.

Mobil besar tetap ditangani jalur warna yang lebih pasti; mobil kecil atau yang warnanya
bercampur tertangkap lewat gerakan; mobil berhenti tidak hilang karena jalur warna tidak
peduli benda itu bergerak. Biayanya dua deteksi per frame, bukan satu.

### Engine settings

| Setting | Fungsi |
|---|---|
| Detection FPS | 15 cukup. Naikkan kalau mobil cepat, turunkan kalau CPU berat |
| Pixel sampling | `Every 2nd` = 4× lebih murah, biasanya masih akurat |
| Colour tolerance | Selonggar apa pencocokan warna. Naikkan kalau titik tidak terdeteksi |
| Min blob pixels | Minimal piksel agar dianggap mobil |
| Min lap (s) | Redam trigger dobel di garis finish |
| Stopped after (s) | Berapa lama diam sampai ditandai berhenti |
| Coast when unseen (ms) | Berapa lama track meluncur pakai kecepatan terakhir saat titik hilang |
| Trigger match | 0.82 default. Turunkan kalau trigger tidak pernah nyala |

### Apakah tracking tetap jalan saat livestreaming?

Ya — selama tab operator masih hidup dan capture belum dihentikan. Tapi ada satu jebakan
nyata yang perlu kamu tahu.

**Tab yang tersembunyi dikekang browser.** Kalau kamu pindah ke tab lain atau meminimize
jendela, Chrome mengekang timer halaman itu. Diukur di sini, loop 66 ms (target 15fps)
merosot jadi **rata-rata 431 ms dengan stall sampai 1 detik**.

Tiga lapis pertahanan sudah dipasang:

| Lapis | Efek |
|---|---|
| **Frame-driven capture** | Kalau browser mendukung `MediaStreamTrackProcessor` (Chrome 94+), frame diambil langsung dari pipeline capture, bukan dari timer. Tidak ada timer untuk dikekang. Pill di halaman Vision menampilkan `frame-driven` kalau jalur ini aktif. |
| **Audio keep-alive** | Tab yang mengeluarkan audio dikecualikan dari pengekangan. Nada 30 Hz dengan gain 0.0001 (tidak terdengar) berjalan selama capture aktif. Terukur memperbaiki interval dari 431 ms ke **97 ms**. |
| **Screen wake lock** | Mencegah layar tidur, yang di sebagian setup ikut membekukan window capture. |

Dan kalau ketiganya belum cukup, panel **memberi tahu, bukan diam**: banner merah muncul
menyebut fps yang sebenarnya tercapai begitu deteksi melambat di bawah 60% target.

**Cara aman:** taruh panel operator di jendela terpisah, terlihat di monitor kedua,
jangan diminimize. Itu satu-satunya kondisi yang dijamin tidak dikekang sama sekali.

Satu hal yang meringankan: deteksi crossing menguji **segmen perpindahan** antar sampel,
bukan "apakah mobil sedang dekat garis". Jadi kalau frame rate sempat anjlok, lap tetap
terdeteksi — yang berkurang adalah presisi waktunya, bukan lapnya. Yang benar-benar hilang
hanya kalau satu sampel melompati dua garis sekaligus.

### Kalau modenya tidak punya minimap

Minimap tracking mati total. Pakai **Trigger zone** (cocokkan gambar banner finish) atau
**OCR lap counter**, plus hotkey `Q W E R T Y U I` sebagai jaring pengaman. Semua jalur
masuk lewat pintu yang sama di server, jadi timing tetap konsisten.

## 4. Layout editor

Halaman **Layout** di panel adalah kanvas 1920×1080 berisi overlay sungguhan, bukan mockup.

- **Drag** widget mana pun untuk memindahkan. Snap otomatis ke safe area, ke tengah kanvas,
  dan ke tepi widget lain. Tahan **Alt** untuk mengabaikan snap.
- **Handle sudut** untuk mengubah lebar.
- **Panah** menggeser 1px, **Shift+panah** 10px.
- Panel kanan: nilai X / Y / lebar / skala persis, tombol rata kiri-tengah-kanan-atas-bawah,
  dan toggle *Include in this layout* untuk membuang widget dari layout ini.
- **Use game frame as backdrop** mengambil satu frame dari capture emulator sebagai latar
  kanvas, jadi kamu bisa menata overlay tepat di atas tampilan game sungguhan.

Style global juga di sini: accent, opacity panel, corner radius, drop shadow, dan density
(*compact* memperpendek baris untuk grid besar).

Layout dan style ikut tersimpan bersama event, dan sampai ke OBS di frame berikutnya —
tidak perlu refresh Browser Source.

## 5. OBS

**Satu Browser Source saja**, 1920×1080:

```
http://localhost:4700/overlay/all.html
```

Semua widget ada di dalamnya; posisinya diatur di halaman Layout. Tiap Browser Source
tambahan berarti satu proses browser tambahan yang harus dikomposit OBS — itu penyebab
lag yang paling sering, bukan overlay-nya.

URL per widget masih tersedia kalau kamu memang butuh fade tiap widget terpisah **di dalam
OBS** (bukan dari panel):

| Overlay | URL |
|---|---|
| Leaderboard | `/overlay/leaderboard.html` |
| Timing tower | `/overlay/tower.html` |
| Status bar | `/overlay/status.html` |
| Lower third | `/overlay/lowerthird.html` |
| Gap bar | `/overlay/gap.html` |
| Results | `/overlay/results.html` |

Background sudah transparan, tidak perlu custom CSS di OBS.

Parameter URL:

| Parameter | Efek |
|---|---|
| `?force=1` | Paksa semua widget tampil, abaikan toggle — buat cek layout |
| `?motion=calm` | Matikan animasi ambient (sheen, garis berjalan, pulse) |
| `?motion=full` | Paksa animasi ambient nyala walau OS minta *reduce motion* |
| `?edit=1` | Mode layout editor (dipakai oleh halaman Layout di panel) |

### Animasi

Overlay bergerak di dua level.

**Event-driven** — selalu aktif, karena gerakannya membawa informasi:

- Posisi berubah → baris benar-benar meluncur ke tempat barunya (FLIP), plus sapuan
  hijau kalau naik / merah kalau turun, dan panah ▲/▼ jumlah posisi.
- Lap selesai → baris itu berdenyut dengan garis accent.
- Best lap baru → sel waktu disapu ungu.
- Angka apa pun berubah (gap, interval, lap counter, fastest lap) → nilai baru naik masuk,
  angka posisi ikut *pop*.
- Bendera berubah → pill bendera kena wipe putih dan labelnya diganti dengan animasi.
- Gap bar → angka jadi hijau saat gap mengecil, merah saat melebar.
- Widget muncul/hilang → masuk dari sisi tempatnya berada (leaderboard dari kiri, tower dari
  kanan, status dari atas, lower third dari kiri dengan blur, results scale + blur),
  baris-barisnya menyusul dengan stagger.

**Ambient** — loop halus supaya panel tidak terlihat seperti PNG mati: sheen melintasi kartu,
garis accent merayap di header, tick berdenyut, bar warna leader berkilat, energi berjalan di gap bar.
Matikan dengan `?motion=calm` kalau dirasa mengganggu.

Baris leaderboard dan timing tower memakai DOM reconciliation berbasis key — node baris
dipakai ulang antar update, jadi animasi tidak pernah terpotong oleh re-render.

### Kalau lag: urutan optimasi

Deteksi kita jalan di bawah 10 ms per frame. Yang biasanya membuat berat adalah emulator,
encoder video OBS, dan piksel yang dipindah percuma. Urutkan dari yang terbesar.

**Aplikasi ini sudah default ke profil low-spec.** Saat pertama dibuka di sebuah browser,
preset Low spec dipakai otomatis dan overlay memulai dalam Lite mode. Naikkan ke Balanced
atau Quality kapan saja lewat kartu **Performance** di halaman Vision.

| Preset | Detection FPS | Pixel sampling | Capture width | Preview |
|---|---|---|---|---|
| **Low spec** (default) | 10 | Every 3rd | 1280 px | Off |
| Balanced | 15 | Every 2nd | 1600 px | 10 fps |
| Quality | 24 | Every pixel | Native | 30 fps |

**Lite mode** (Layout → Overlay style, default menyala) mematikan setiap animasi overlay yang
berjalan terus-menerus — sheen, garis merayap, tick berdenyut, kilat bar pemimpin — plus drop
shadow. Animasi yang membawa informasi tetap jalan: tukar posisi, lap masuk, ganti bendera.

Kartu **Performance** juga menampilkan biaya aslinya secara live: resolusi dan fps capture yang
benar-benar didapat, fps deteksi tercapai, dan berapa persen frame yang tidak pernah disentuh.

Tiga preset itu:

| Preset | Detection FPS | Pixel sampling | Capture width | Preview |
|---|---|---|---|---|
| Low spec | 10 | Every 3rd | 1280 px | Off |
| Balanced | 15 | Every 2nd | 1600 px | 10 fps |
| Quality | 24 | Every pixel | Native | 30 fps |

Tiga pemborosan yang sudah dihapus dari kode:

| Sebelumnya | Sekarang |
|---|---|
| Capture diminta 60fps padahal deteksi cuma butuh 15 | Frame rate diminta sesuai Detection FPS, bisa diubah live tanpa memilih window ulang |
| Seluruh frame 1920×1080 disalin tiap tick untuk membaca minimap 200×180 | Hanya region yang kamu gambar yang disalin, dipak dalam satu atlas kecil. Penghematannya tampil live di kartu Performance |
| Preview menggambar feed game 30fps terus-menerus | Preview jadi dial, termasuk **Off**. Deteksi tetap jalan penuh |

Pixel sampling diukur dengan 12 mobil, rata-rata tiga kali jalan: `Every pixel` 13.8 ms,
`Every 2nd` 9.2 ms, `Every 3rd` 7.0 ms per frame. Akurasi tidak berubah — lap tetap tepat
dalam 1–4 ms di ketiga level, semua uji lolos. Angka itu dari harness yang menyalin piksel
dengan loop JavaScript; di browser sungguhan penyalinannya dikerjakan GPU, jadi selisihnya
lebih besar lagi.

### Kalau deteksi cuma dapat 1-5 fps

Hampir selalu bukan karena komputernya lambat:

1. **Detection FPS memang rendah.** Preset Low spec memasang 10, jadi 10 adalah batas atas.
   Pakai preset **Smooth 30**, atau set sendiri. Capture ikut diminta ulang di frame rate itu.
2. **Jendela capture di background.** Tab tersembunyi dikekang browser. Biarkan terlihat.
3. **Region kebesaran atau bertumpuk.** Kartu Performance menyebut piksel per frame; kalau
   angkanya lebih besar dari frame itu sendiri, ada region yang bertumpuk dan menyalin
   piksel yang sama dua kali.

Batas atas terukur, sumber 982×462, region minimap 900×344:

| Konfigurasi | Piksel/frame | Biaya | Batas atas |
|---|---|---|---|
| 2 region bertumpuk, Every pixel | 712.008 | 27,6 ms | 36 fps |
| 1 region, Every pixel | 309.600 | 11,6 ms | 86 fps |
| 1 region, Every 2nd | 77.400 | 5,7 ms | 176 fps |

Yang mahal bukan matematikanya — 309 ribu piksel hanya 6 ms. Yang mahal adalah membaca
piksel balik dari GPU (`getImageData`), dan biaya itu hampir tidak turun walau sampling
dinaikkan. Itu sebabnya *Every 3rd* tidak lebih cepat dari *Every 2nd*.

**Deteksi di luar main thread.** Kalau browser mendukungnya, seluruh jalur piksel pindah
ke Web Worker — frame dikirim langsung ke sana, yang kembali hanya koordinat. Terukur
**48 fps** end-to-end pada region 900×344. Pill di halaman Vision menampilkan `worker`
kalau jalur ini aktif. Worker dimatikan otomatis kalau ada region OCR atau trigger aktif,
karena keduanya membaca piksel di main thread.

**Yang tidak dimuat sampai dibutuhkan:**

| Bagian | Biaya | Dimuat kapan |
|---|---|---|
| Editor layout | satu salinan penuh overlay (36KB JS + 23KB CSS + WebSocket + render loop) | saat halaman Layout dibuka |
| Preview overlay | satu salinan penuh overlay lagi | hanya kalau toggle *Show live preview* dinyalakan |
| Halaman Help | 44KB teks | saat halaman Help dibuka |
| Mesin OCR | 67KB | saat ada region OCR yang dibaca |

Dulu kedua iframe overlay itu menyala di setiap panel — dua aplikasi penuh berjalan di
latar belakang walau halamannya tidak pernah dibuka. Terukur: dua tab panel dulu membuka
**6 koneksi WebSocket**, sekarang **2**.

Overlay juga berhenti memperbarui widget yang sedang disembunyikan, dan preview capture
berhenti menggambar saat halaman Vision tidak terbuka.

**Di OBS** — ini biasanya biang terbesarnya:

- Encoder → **hardware** (NVENC / QuickSync / AMF). x264 memakai CPU dan paling sering jadi penyebab lag.
- Output resolution → 1280×720 kalau spek rendah. Overlay tetap tajam.
- FPS → 30, bukan 60.
- Cukup **satu** Browser Source. Tambahkan `?motion=calm` di URL-nya.

### Dua cara menjalankan

Pemilih **Capture source** ada di halaman Vision, di sebelah tombol deteksi.

| Pilihan | Artinya |
|---|---|
| **Auto** | Pakai capture perangkat ini kalau ada, kalau tidak pakai capture node yang terhubung. Default. |
| **This device** | Semua di satu komputer. Tombol *Select emulator window* aktif, deteksi jalan di browser ini. |
| **Capture node** | Mesin yang membuka `/node.html` yang meng-capture. Pemilih window lokal dimatikan. |

Keterangan di bawah tombol selalu menyebut mesin mana yang sedang menjalankan deteksi.
Pilihannya tersimpan per browser.

Jangan menjalankan deteksi di dua mesin sekaligus untuk lintasan yang sama — tiap lap
akan tercatat dua kali. Aplikasi memperingatkan dan menyebut mesin mana yang memegangnya.

### Punya PC + laptop + HP? Ini pembagiannya

Aturan keras: **deteksi harus jalan di mesin yang menampilkan video game-nya**, karena
capture terjadi di dalam tab browser dan tab itu harus bisa melihat window game.

| Perangkat | Menjalankan |
|---|---|
| **HP** | FR Legends. Colok USB ke PC, tampilkan dengan `scrcpy` |
| **PC (utama)** | scrcpy + server + OBS + **capture node** (`/node.html`) |
| **Laptop** | Panel operator, buka `http://<ip-PC>:4700` |

`/node.html` hanya melakukan capture dan deteksi — tanpa tabel, tanpa preview, tanpa editor.
Setiap piksel yang tidak digambar ulang adalah tenaga yang tersisa untuk encoder OBS. Node itu
juga tinggal dibiarkan terbuka dan terlihat, jadi masalah pengekangan tab tidak pernah terjadi.

Kalibrasi tetap bisa dari laptop: node mengirim snapshot preview 2×/detik, dan halaman Vision
di laptop menggambarnya, jadi Minimap zone, racing line, dan garis timing bisa digambar dari
sana. Pengecualian: **Capture ref** untuk trigger zone membaca piksel lokal, jadi harus
dilakukan di mesin yang meng-capture.

Kalau deteksi sudah jalan di satu mesin, mesin kedua yang mencoba menyalakannya akan bertanya
dulu — dua node akan mencatat tiap lap dua kali.

**Emulator** — kalau tetap memakai emulator, ini komponen terberat di seluruh setup:

- Turunkan resolusi ke 1280×720, batasi FPS 30–60, batasi core dan RAM.
- Pastikan virtualisasi (VT-x / AMD-V) aktif di BIOS.
- **Paling ampuh: pakai HP asli, bukan emulator.** Jalankan game di HP, tampilkan ke PC lewat
  `scrcpy` (gratis, lewat USB). scrcpy hanya mendekode video — jauh lebih ringan daripada
  menjalankan Android di PC. Panel dan OBS meng-capture window scrcpy seperti window biasa.

**Apakah perlu jadi aplikasi native?** Tidak, dan itu tidak menyelesaikan masalahnya.
Biaya terbesar ada di emulator dan encoder video — dua hal yang tidak berubah kalau aplikasi
ini ditulis ulang. Deteksinya sendiri sudah di bawah 10 ms per frame; menulis ulang jadi native
mungkin menghemat beberapa milidetik dan ~200 MB RAM, dengan biaya berminggu-minggu kerja dan
kehilangan overlay yang langsung bisa dipakai OBS.

### Beban animasi

Overlay dirancang supaya animasinya composited-only. Yang dihindari, dan alasannya:

| Dihindari | Kenapa |
|---|---|
| `backdrop-filter` | Browser Source OBS punya backdrop transparan — blur-nya membakar satu GPU pass per frame per kartu tanpa mengubah apa pun di layar. Gameplay ada di bawahnya di compositor OBS, bukan di belakang elemen ini. |
| Animasi `box-shadow` / `background` | Repaint tiap frame. Highlight baris dipindah ke pseudo-element yang dicat sekali lalu hanya di-fade (`opacity`). |
| `filter: blur()` saat transisi masuk | Rasterisasi ulang seluruh widget tiap frame. Diganti `transform` + `opacity`. |
| `will-change: transform` permanen | Bikin layer compositor untuk tiap baris selamanya. Dihapus — WAAPI mempromosikan baris hanya selama benar-benar bergerak. |
| Browser Source per widget | Tiap source = satu proses browser penuh untuk OBS. Pakai satu `all.html` dan atur posisi di halaman Layout. |
| Reflow paksa per sel | Animasi nilai dipindah ke Web Animations API, jadi satu baris yang berubah tidak lagi memicu layout flush per sel. |

Selain itu, overlay menghitung signature dari semua yang benar-benar digambar dan
melewati render kalau signature-nya sama. Vision mengirim `progress` ~4×/detik yang
tidak mengubah apa pun di layar; push seperti itu sekarang menghasilkan nol pekerjaan DOM.
Pengukuran: 60 push progress berturut-turut → 0 mutasi DOM.

Kalau masih berat, `?motion=calm` mematikan semua loop ambient dan hanya menyisakan
animasi event-driven.

Panel operator juga: preview capture dibatasi 30fps (bukan 60), dan tabel klasemen serta
daftar region hanya dibangun ulang kalau isinya benar-benar berubah.

### "Overlay-ku kelihatan diam, tidak ada animasi"

Cek berurutan:

1. **Apakah ada yang berubah?** Ini penyebab paling sering. Animasi yang mencolok itu
   *event-driven* — dipicu posisi tukar, lap masuk, best lap, bendera ganti. Kalau race
   status `idle`/`formation` dan tidak ada lap masuk, tidak ada yang perlu dianimasikan;
   yang jalan cuma ambient yang memang halus.
   Buka **Overlays → Motion check → Play animation rehearsal**. Tombol itu memutar ulang
   semua animasi di semua overlay yang terhubung tanpa menyentuh data balapan. Kalau
   rehearsal terlihat, animasinya sehat — yang kurang cuma event.
2. **Cache OBS.** Browser Source di OBS menyimpan versi lama JS/CSS. Server sekarang
   mengirim `Cache-Control: no-cache, no-store`, tapi kalau overlay sempat dibuka sebelum
   perbaikan itu: klik kanan source → **Properties → Refresh cache of current page**.
3. **Animasi Windows dimatikan.** Settings → Accessibility → Visual effects →
   *Animation effects* off membuat browser melaporkan `prefers-reduced-motion: reduce`,
   dan semua loop ambient dimatikan. Paksa nyala dengan `?motion=full` di URL Browser Source.
4. **Hardware acceleration.** Kalau overlay tersendat di OBS, kecilkan Browser Source ke
   1920×1080 tepat (bukan di-scale) dan pastikan OBS tidak berjalan di mode software renderer.

Semua toggle visibility ada di halaman **Overlays** di panel — perubahan sampai ke OBS instan
lewat WebSocket, tanpa refresh.

### Trigger lap dari perangkat lain

```
GET http://<ip-lan>:4700/api/lap/<driverId>
```

Driver ID ada di halaman Drivers. Berguna untuk Stream Deck, AutoHotkey, atau HP sebagai tombol lap.

---

## 6. Model AI sendiri (opsional)

Kalau mau deteksi objek beneran — mobil, garis finish, elemen HUD — latih model YOLO sendiri
dan taruh export ONNX di `public/models/frlegends.onnx` + `frlegends.labels.json`,
lalu klik **Load model** di halaman Vision.

Cara merekam, melabeli, dan melatihnya: lihat [TRAINING.md](TRAINING.md).

Model itu **pelengkap**, bukan pengganti. Minimap tracking + trigger zone sudah cukup untuk
menghitung lap dan posisi tanpa training apa pun.

---

## 7. Struktur

```
server/
  index.js      Express + WebSocket, serve panel & overlay
  state.js      State balapan authoritative: lap, gap, posisi, bendera, persistensi
public/
  index.html    Panel operator
  js/
    shared.js   Bus WebSocket + formatter waktu, dipakai panel & overlay
    capture.js  getDisplayMedia, crop ROI, preprocessing OCR
    tracker.js  Color LUT, connected components, tracker prediktif, geometri garis
    vision.js   Orkestrasi deteksi: tracking, garis timing, trigger NCC, OCR
    detector.js Runner ONNX YOLO opsional
    panel.js    Semua UI operator
  overlay/
    overlay.js  Renderer semua widget + layout editor
    overlay.css Desain overlay
    *.html      Satu halaman per widget untuk OBS
data/state.json Auto-save state (roster, kalibrasi, event)
```

---

## 8. Catatan jujur soal keterbatasan

- **Deteksi tergantung tampilan game.** Kalau mode yang kamu pakai tidak punya minimap dengan
  titik warna berbeda per pemain, minimap tracking tidak akan jalan — pakai trigger zone atau OCR.
  Kalibrasi ulang tiap ganti map/mode.
- **Warna pembalap harus berbeda satu sama lain.** Dua mobil dengan warna nyaris sama akan
  saling tertukar. Lookup cube memilih yang terdekat, jadi jarak antar warna adalah
  jaminan akurasinya.
- **Satu window = satu sudut pandang.** Kalau kamera spectator hanya mengikuti satu mobil,
  OCR/trigger hanya bisa memberi data untuk mobil itu (*focus driver*). Posisi penuh semua mobil
  hanya realistis lewat minimap.
- **Timing tidak lagi terkunci frame rate**, karena perpotongan garis diinterpolasi — pada uji
  simulasi hasilnya tepat di milidetik. Tapi itu presisi terhadap *apa yang tampil di layar*:
  latensi emulator dan encoding capture tetap ada. Cukup untuk siaran; untuk protes hasil resmi
  yang beda tipis, tetap jangan.
- **Panel harus tetap terbuka dan terlihat.** Tab tersembunyi dikekang browser; ada tiga lapis
  penangkal dan banner peringatan, tapi kondisi yang dijamin aman tetap: jendela terlihat,
  tidak diminimize. Lihat bagian *Apakah tracking tetap jalan saat livestreaming?*
