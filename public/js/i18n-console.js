/*
 * The operator console, in Indonesian.
 *
 * Loaded after i18n-core.js, which owns the switching. This file is only vocabulary.
 *
 * ------------------------------------------------------------------ why this exists
 *
 * The console was English while its own manual was Indonesian, and a handful of hints in
 * the middle of the interface had been written in Indonesian too — a paragraph about
 * predicted running order, the note about picking a car's colour, the tracking legend. So
 * the tool read as two languages at once, and no switch could have fixed it, because there
 * was no single source language to switch away from.
 *
 * Those hints have been turned back into English in the markup. English is now the source
 * everywhere and this file carries the other half, which is what makes the switch possible
 * at all.
 *
 * ------------------------------------------------------------------ what is not here
 *
 * The manual on the Help page. It is eight hundred lines of prose that is already written
 * in Indonesian, and a rushed English version of a document people read when something has
 * gone wrong would be worse than leaving it in one language. It stays Indonesian until it
 * gets the attention it deserves.
 */
(function () {
  'use strict';
  if (!window.FRL_I18N || !window.FRL_I18N.install) return;

  // Names, addresses, file names, units and the vocabulary that is the same in a paddock
  // whichever language is being spoken.
  var KEEP = [
    'FRL Broadcast', 'OBS', 'VSC', 'CSV', 'FPS', 'ONNX', 'YouTube chapters', 'MotoGP',
    'http', 'https', '/driver.html', '/overlay/all.html', '/report.html',
    '/overlay/commentary.html', 'http://localhost:4700/overlay/all.html',
    'http://localhost:4700/node.html', 'http://HOST:4700/api/lap/<driverId>',
    'public/models/frlegends.onnx', 'frlegends.labels.json', 'TRAINING.md',
    'num,name,team,car,color', 'Alt', 'Space', 'Q W E R T Y U I', '10px', '5 fps',
    '10 fps', '30 fps', '1600 px', '1280 px', '960 px', 'Window Capture', 'Browser',
    'Browser Source', 'Drift', 'Vision / AI',
    // Placeholder examples: they are meant to be typed over, not read.
    'FR LEGENDS LEAGUE'
  ];

  var ID = {
    // ---------------------------------------------------------------- sidebar
    'Operator console': 'Konsol operator',
    'Race control': 'Race control',
    'Event scenes': 'Scene event',
    'Championship': 'Championship',
    'Drivers': 'Pembalap',
    'Drift battles': 'Drift battle',
    'Overlays': 'Overlay',
    'Layout': 'Tata letak',
    'OBS setup': 'Setup OBS',
    'Help': 'Panduan',
    'Manual': 'Panduan',
    'Lap hotkeys': 'Hotkey lap',
    'fire a lap for drivers 1-8.': 'mencatat lap untuk pembalap 1-8.',
    'start / green flag.': 'mulai / bendera hijau.',
    'Nothing matches.': 'Tidak ada yang cocok.',
    'Every page in this console, and how to use it. It switches language with the rest of the app.':
      'Tiap halaman di konsol ini, dan cara memakainya. Bahasanya ikut berganti bersama sisa aplikasi.',

    // ---------------------------------------------------------------- race control
    'Authoritative timing. Everything here is live on the overlays instantly.':
      'Timing yang menjadi acuan. Semua di sini langsung tayang di overlay.',
    'Session': 'Sesi',
    'IDLE': 'SIAGA',
    'Race time': 'Waktu balapan',
    'Leader lap': 'Lap pemimpin',
    'Fastest lap': 'Lap tercepat',
    'Start race': 'Mulai balapan',
    'Reset': 'Reset',
    'Export result': 'Ekspor hasil',
    'Show logo': 'Tampilkan logo',
    'Hand back to auto': 'Kembalikan ke otomatis',
    'Formation': 'Formasi',
    'Green': 'Hijau',
    'Yellow': 'Kuning',
    'Safety car': 'Safety car',
    'Red': 'Merah',
    'Chequered': 'Kotak-kotak',
    'Live classification': 'Klasemen langsung',
    'Event details': 'Detail event',
    'Event name': 'Nama event',
    'Round': 'Ronde',
    'Track': 'Trek',
    'Session type': 'Jenis sesi',
    'Race': 'Balapan',
    'Qualifying': 'Kualifikasi',
    'Practice': 'Latihan',
    'Drift (score)': 'Drift (skor)',
    'Session label': 'Label sesi',
    'Total laps': 'Jumlah lap',
    'Accent colour': 'Warna aksen',
    'Predicted running order': 'Perkiraan urutan',
    'the ~ mark on the overlay': 'tanda ~ di overlay',
    'With one timing point, a position is only confirmed as a car crosses the line. This carries every car forward at the pace of its own last lap, so an overtake shows when it happens. Lap times stay measured, never predicted.':
      'Dengan satu titik timing, posisi hanya terkonfirmasi saat mobil melintas garis. Ini membawa tiap mobil maju sesuai pace lap terakhirnya, jadi overtake terlihat saat terjadi. Waktu lap tetap hasil pengukuran, tidak diprediksi.',

    'Driver sign-ins': 'Pendaftaran pembalap',
    'none waiting': 'tidak ada yang menunggu',
    'Drivers sign in on their phone at': 'Pembalap mendaftar dari HP di',
    'Accepting one puts them on the grid and starts sending them flags.':
      'Menerima satu pendaftaran langsung menaruhnya di grid dan mulai mengirimi bendera.',
    'Their phone will warn about the certificate the first time — that is expected on a private network. Tapping through it is what lets flag alerts work at all; on the plain':
      'HP mereka akan memperingatkan soal sertifikat saat pertama kali — itu wajar di jaringan pribadi. Menekan lanjut adalah yang membuat notifikasi bendera bisa jalan; di alamat',
    'address Android silently blocks them.': 'biasa, Android memblokirnya diam-diam.',

    'Sessions & grid': 'Sesi & grid',
    'Classify session': 'Simpan hasil sesi',
    'Grid from current order': 'Grid dari urutan sekarang',
    'Clear grid': 'Kosongkan grid',
    'Before the flag the grid decides the running order. Without one the leaderboard falls back to roster order, which is not the order on track.':
      'Sebelum bendera, grid yang menentukan urutan. Tanpa grid, leaderboard memakai urutan daftar pembalap — dan itu bukan urutan di trek.',

    '0 open': '0 terbuka',
    'Time penalty': 'Penalti waktu',
    'Warning': 'Peringatan',
    'Drive through': 'Drive through',
    'Black flag': 'Bendera hitam',
    'Disqualify': 'Diskualifikasi',
    'Issue': 'Jatuhkan',
    'Automatic findings': 'Temuan otomatis',
    'Jump start': 'Start mencuri',
    'Track limits': 'Batas trek',
    'Warnings allowed': 'Peringatan yang dibolehkan',
    'Penalty seconds': 'Detik penalti',
    'Apply immediately, no investigation': 'Langsung berlaku, tanpa investigasi',
    'Automatic flags': 'Bendera otomatis',
    'Neutralise when a car stops on track': 'Netralkan saat ada mobil berhenti di trek',
    'Raise which flag': 'Bendera yang dikibarkan',
    'Yellow flag': 'Bendera kuning',
    'Virtual safety car': 'Virtual safety car',
    'Blue flags for cars being lapped': 'Bendera biru untuk mobil yang akan dilewati',
    'Chequered at the scheduled distance': 'Kotak-kotak saat jarak yang dijadwalkan tercapai',
    'Cars stopped for a red': 'Jumlah mobil berhenti untuk bendera merah',
    'Seconds clear before green': 'Detik trek bersih sebelum hijau',
    'Laps before an unserved drive-through becomes a black flag':
      'Lap sebelum drive-through yang tidak dijalani jadi bendera hitam',
    '0 = off': '0 = mati',
    'Only jump starts and track limits can be detected — both are geometry the system already measures. Contact and blocking are judgement calls and are never raised automatically.':
      'Hanya start mencuri dan batas trek yang bisa dideteksi — keduanya geometri yang memang sudah diukur sistem. Kontak dan menghalangi adalah penilaian manusia, dan tidak pernah diangkat otomatis.',

    'Highlights for the VOD': 'Highlight untuk VOD',
    'not recording': 'tidak merekam',
    'Start markers': 'Mulai penanda',
    'Stop': 'Berhenti',
    'Mark now': 'Tandai sekarang',
    'Nudge, if you hit Record in OBS a moment earlier or later':
      'Geser, kalau kamu menekan Record di OBS sedikit lebih awal atau lebih lambat',
    'Marker CSV': 'CSV penanda',
    'Subtitles (.srt)': 'Subtitle (.srt)',
    'Clear': 'Kosongkan',
    'Press': 'Tekan',
    'at the same moment you press Record in OBS. Every overtake, fastest lap, pit stop and battle result is timestamped against that moment, so the edit list is written while you broadcast.':
      'di saat yang sama kamu menekan Record di OBS. Tiap salip, lap tercepat, pit stop, dan hasil battle diberi stempel waktu terhadap momen itu, jadi daftar editnya tertulis sambil kamu siaran.',
    'Recent events': 'Kejadian terbaru',

    // ---------------------------------------------------------------- event scenes
    'One overlay URL, several looks. Clicking a scene puts it on air and cross-fades the overlay; the Overlays and Layout pages then edit that scene.':
      'Satu URL overlay, beberapa tampilan. Mengklik sebuah scene menayangkannya dan membuat overlay bertransisi; halaman Overlay dan Tata letak lalu mengedit scene itu.',
    'Scenes': 'Scene',
    'Duplicate current': 'Duplikat yang aktif',
    'On air': 'Tayang',
    'Transition length': 'Durasi transisi',
    'OBS needs only': 'OBS hanya butuh',
    '. Scene changes happen inside it, so there is nothing to switch on the OBS side and no second browser source to load.':
      '. Pergantian scene terjadi di dalamnya, jadi tidak ada yang perlu diganti di sisi OBS dan tidak perlu browser source kedua.',

    // ---------------------------------------------------------------- drivers
    'Colour matters: the vision engine tracks each car by its minimap colour, so use the exact in-game colour.':
      'Warna itu penting: mesin visi melacak tiap mobil lewat warnanya di minimap, jadi pakai warna persis seperti di game.',
    'Roster': 'Daftar pembalap',
    '0 cars': '0 mobil',
    'Add driver': 'Tambah pembalap',
    'Import CSV': 'Impor CSV',
    'Export CSV': 'Ekspor CSV',
    'CSV columns:': 'Kolom CSV:',

    // ---------------------------------------------------------------- championship
    'Points across rounds. Each round is banked as a scored snapshot, so editing the roster later never rewrites what somebody won in March.':
      'Poin lintas ronde. Tiap ronde disimpan sebagai cuplikan yang sudah diskor, jadi mengubah daftar pembalap nanti tidak akan menulis ulang apa yang seseorang menangkan bulan lalu.',
    'Race report': 'Laporan balapan',
    'Report': 'Laporan',
    'Copy': 'Salin',
    'Open': 'Buka',
    'One page for the people who were not watching: winner and margin, fastest lap, every steward decision with its reason, who gained the most places, and where the championship stands with this round counted. It needs no login, so the link can go straight into the league channel, and':
      'Satu halaman untuk orang yang tidak menonton: pemenang dan selisihnya, lap tercepat, tiap keputusan steward beserta alasannya, siapa yang naik paling banyak, dan posisi championship dengan ronde ini dihitung. Tidak perlu login, jadi tautannya bisa langsung masuk ke channel liga, dan',
    'Copy for Discord': 'Salin untuk Discord',
    'on the page gives you the text rather than a screenshot.':
      'di halaman itu memberi kamu teksnya, bukan tangkapan layar.',
    'Standings': 'Klasemen',
    '0 rounds': '0 ronde',
    'Rounds': 'Ronde',
    'Bank current result': 'Simpan hasil sekarang',
    'Bank that session': 'Simpan sesi itu',
    'Scoring': 'Penilaian',
    'Championship name': 'Nama championship',
    'Points per position, first place first': 'Poin per posisi, juara pertama duluan',
    'Club': 'Klub',
    'Podium only': 'Podium saja',
    'Fastest lap bonus': 'Bonus lap tercepat',
    'Pole bonus': 'Bonus pole',
    'Drop each driver’s worst results': 'Buang hasil terburuk tiap pembalap',
    "Drop each driver's worst results": 'Buang hasil terburuk tiap pembalap',
    'Changing these affects rounds banked from now on. To apply them to a round already banked, press':
      'Mengubah ini berlaku untuk ronde yang disimpan mulai sekarang. Untuk menerapkannya ke ronde yang sudah tersimpan, tekan',
    'Rescore': 'Hitung ulang',
    'on that round — deliberately, one at a time.': 'di ronde itu — sengaja, satu per satu.',
    'Export': 'Ekspor',
    'Standings CSV': 'CSV klasemen',
    'Turn on the': 'Nyalakan',
    'overlay from the Overlays page to put the table on the broadcast.':
      'dari halaman Overlay untuk menaruh tabelnya di siaran.',

    // ---------------------------------------------------------------- drift
    'Tandem knockout: judged qualifying runs seed the bracket, then two runs per battle with the lead swapped, and the judges call it.':
      'Tandem gugur: run kualifikasi yang dinilai menentukan unggulan bracket, lalu dua run per battle dengan posisi depan ditukar, dan juri yang memutuskan.',
    'Format': 'Format',
    'Bracket size': 'Ukuran bracket',
    'Top 4': '4 besar',
    'Great 8': '8 besar',
    'Top 16': '16 besar',
    'Top 32': '32 besar',
    'Judges': 'Juri',
    'Qualifying runs': 'Run kualifikasi',
    'Max One More Time': 'Maksimum One More Time',
    'Empty seats become byes, so an eleven-car entry fits a sixteen-car bracket without inventing drivers.':
      'Slot kosong jadi bye, jadi sebelas peserta muat di bracket enam belas tanpa mengarang pembalap.',
    'Build bracket': 'Susun bracket',
    'Best run counts. Order here becomes the seeding.':
      'Run terbaik yang dihitung. Urutan di sini jadi unggulan.',
    'Battle': 'Battle',
    'Bracket': 'Bracket',
    'Clear bracket': 'Kosongkan bracket',

    // ---------------------------------------------------------------- vision
    'Share the emulator window, mark the regions the AI should watch, then let it call the laps.':
      'Bagikan window emulator, tandai area yang harus diawasi AI, lalu biarkan dia yang mencatat lap.',
    'Capture': 'Capture',
    'no source': 'tidak ada sumber',
    'Select emulator window': 'Pilih window emulator',
    'Start AI detection': 'Mulai deteksi AI',
    'idle': 'siaga',
    'Capture source': 'Sumber capture',
    'Auto': 'Otomatis',
    'This device': 'Perangkat ini',
    'Capture node': 'Node capture',
    'No capture source': 'Tidak ada sumber capture',
    'Click': 'Klik',
    'and pick your Android emulator': 'lalu pilih emulator Android kamu',
    '(LDPlayer / BlueStacks / scrcpy) from the window list.':
      '(LDPlayer / BlueStacks / scrcpy) dari daftar window.',
    'Pick the driver first': 'Pilih pembalapnya dulu',
    ", then click their car in the image above. That pixel's colour is used directly, which is far more accurate than guessing at a colour picker.":
      ', lalu klik mobilnya di gambar di atas. Warna piksel itu langsung dipakai — jauh lebih akurat daripada menebak lewat color picker.',
    'Draw tool': 'Alat gambar',
    'Minimap zone — find the cars': 'Area minimap — cari mobilnya',
    'Finish line — click 2 points': 'Garis finis — klik 2 titik',
    'Sector line — click 2 points': 'Garis sektor — klik 2 titik',
    'Pit lane zone': 'Area pit lane',
    'Trigger zone (image match)': 'Area pemicu (cocokkan gambar)',
    'OCR — lap counter': 'OCR — penghitung lap',
    'OCR — lap time': 'OCR — waktu lap',
    'OCR — position': 'OCR — posisi',
    'OCR — speed': 'OCR — kecepatan',
    'OCR — driver name': 'OCR — nama pembalap',
    'Model zone (ONNX)': 'Area model (ONNX)',
    'Mode': 'Mode',
    'Draw regions': 'Gambar area',
    'Draw racing line (inside minimap)': 'Gambar racing line (di dalam minimap)',
    'Pick car colour from the image': 'Ambil warna mobil dari gambar',
    'Clear line': 'Hapus garis',
    'Relearn circuit': 'Pelajari ulang sirkuit',
    'Minimap zone': 'Area minimap',
    'What': 'Apa',
    'How': 'Caranya',
    'Gives you': 'Hasilnya',
    'Detection log': 'Log deteksi',
    'Timing lines': 'Garis timing',
    'No lines yet. Pick': 'Belum ada garis. Pilih',
    'Finish line': 'Garis finis',
    'above and click two points across the track on the minimap. Add':
      'di atas lalu klik dua titik memotong trek di minimap. Tambahkan',
    'Sector line': 'Garis sektor',
    's in racing order — 2 sector lines gives you 3 sectors.':
      ' sesuai urutan balapan — 2 garis sektor memberi 3 sektor.',
    'Regions': 'Area',
    'Nothing calibrated yet.': 'Belum ada yang dikalibrasi.',
    'Tracking': 'Pelacakan',
    'whether the car is being found': 'apakah mobilnya ketemu',
    'seen': 'terlihat',
    "= the detector found that car's colour a moment ago.":
      '= detektor menemukan warna mobil itu barusan.',
    'not found': 'tidak ketemu',
    "= not found: check the driver's colour, raise Colour tolerance, lower Min blob pixels, or set Pixel sampling to":
      '= tidak ketemu: cek warna pembalap, naikkan Colour tolerance, turunkan Min blob pixels, atau set Pixel sampling ke',
    'Every pixel': 'Tiap piksel',
    'if the car is small on screen.': 'kalau mobilnya kecil di layar.',
    'Engine settings': 'Pengaturan mesin',
    'Tracking method': 'Metode pelacakan',
    "Colour — match the car's colour": 'Warna — cocokkan warna mobil',
    'Motion — find what moves against the static circuit':
      'Gerak — cari yang bergerak terhadap sirkuit yang diam',
    'Hybrid — colour first, motion fills the gaps':
      'Hibrida — warna dulu, gerak menutup celahnya',
    'Motion sensitivity': 'Sensitivitas gerak',
    'Detection FPS': 'FPS deteksi',
    'Min lap (s)': 'Lap minimum (dtk)',
    'Colour tolerance': 'Toleransi warna',
    'Min blob pixels': 'Piksel blob minimum',
    'Trigger match': 'Kecocokan pemicu',
    'Racing line direction': 'Arah racing line',
    'Forward': 'Maju',
    'Reverse': 'Mundur',
    'Pixel sampling': 'Pencuplikan piksel',
    'Every pixel (accurate)': 'Tiap piksel (akurat)',
    'Every 2nd (4× cheaper)': 'Tiap ke-2 (4× lebih ringan)',
    'Every 3rd (9× cheaper)': 'Tiap ke-3 (9× lebih ringan)',
    'Stopped after (s)': 'Dianggap berhenti setelah (dtk)',
    'Coast when unseen (ms)': 'Meluncur saat tak terlihat (md)',
    'Time from drawn lines': 'Waktu dari garis yang digambar',
    'recommended': 'disarankan',
    'Fallback: lap when a car wraps the racing line':
      'Cadangan: lap saat mobil menyelesaikan racing line',
    'Count laps from trigger zones': 'Hitung lap dari area pemicu',
    'Count laps from OCR lap counter': 'Hitung lap dari penghitung lap OCR',
    'Performance': 'Performa',
    'Low spec': 'Spek rendah',
    'Balanced': 'Seimbang',
    'Smooth 30': 'Mulus 30',
    'Quality': 'Kualitas',
    'Capture width cap': 'Batas lebar capture',
    'Native (no cap)': 'Asli (tanpa batas)',
    'Preview': 'Pratinjau',
    'Off (lightest)': 'Mati (paling ringan)',
    'Trained model (optional)': 'Model terlatih (opsional)',
    'Drop a YOLOv8/YOLO11 export at': 'Taruh hasil ekspor YOLOv8/YOLO11 di',
    'with': 'bersama',
    ', then load it here. See': ', lalu muat di sini. Lihat',
    'for how to record and label your own FR Legends footage.':
      'untuk cara merekam dan melabeli rekaman FR Legends kamu sendiri.',
    'Load model': 'Muat model',
    'not loaded': 'belum dimuat',
    'Overlay model boxes on preview': 'Tampilkan kotak model di pratinjau',

    // ---------------------------------------------------------------- overlays
    'Toggle what is on screen. Changes hit OBS in under a frame.':
      'Nyalakan atau matikan apa yang tampil. Perubahan sampai ke OBS dalam kurang dari satu frame.',
    'Editing scene': 'Sedang mengedit scene',
    '— switch scenes on the Event scenes page.': '— ganti scene di halaman Scene event.',
    'Visibility': 'Tampil',
    'Leaderboard (left rail)': 'Leaderboard (rel kiri)',
    'Timing tower (right rail)': 'Timing tower (rel kanan)',
    'Status bar (top)': 'Status bar (atas)',
    'Lower third (focus driver)': 'Lower third (pembalap fokus)',
    'Battle / gap bar': 'Bar battle / gap',
    'Results screen': 'Layar hasil',
    'Track map (live car positions)': 'Peta trek (posisi mobil langsung)',
    'Tandem battle (drift)': 'Tandem battle (drift)',
    'Bracket (drift)': 'Bracket (drift)',
    'Starting grid': 'Grid start',
    'Head to head': 'Adu dua pembalap',
    'Championship standings': 'Klasemen championship',
    'Pick a widget to edit its size and position. Click one here or on the canvas.':
      'Pilih widget untuk mengatur ukuran dan posisinya. Klik salah satu di sini atau di kanvas.',
    'No widget selected.': 'Belum ada widget dipilih.',
    'No widgets shown on this scene.': 'Tidak ada widget yang tampil di scene ini.',
    'Apply to OBS': 'Terapkan ke OBS',
    'Class': 'Kelas',
    'Photo URL': 'URL foto',
    'highlight clips exported': 'klip highlight diekspor',
    'Look applied': 'Look diterapkan',
    'Look saved': 'Look disimpan',
    'Name the preset first': 'Beri nama preset dulu',
    'No result yet.': 'Belum ada hasil.',
    'wins': 'menang',
    'ahead of': 'unggul atas',
    'Podium': 'Podium',
    'Most places gained': 'Naik posisi terbanyak',
    'Copied': 'Disalin',
    'Endurance: a race run to a clock. Positions rank by distance; it ends when the timer runs out and scores the championship.': 'Endurance: balapan berbasis waktu. Posisi diurut berdasarkan jarak; selesai saat waktu habis dan dihitung ke championship.',
    'Practice: a timed session for laps only — it changes nothing.': 'Practice: sesi berwaktu untuk latihan lap saja — tidak mengubah apa pun.',
    'Qualifying: a timed session; the chequered flag sets the starting grid by best lap.': 'Qualifying: sesi berwaktu; bendera kotak-kotak menyusun grid start berdasarkan lap terbaik.',
    'Grid reversed': 'Grid dibalik',
    'Grid randomised': 'Grid diacak',
    'Shuffle into a random grid?': 'Acak jadi grid random?',
    'Sent': 'Terkirim',
    'Failed — check the URL': 'Gagal — cek URL',
    'Paste a webhook URL first': 'Tempel URL webhook dulu',
    'Sending…': 'Mengirim…',
    'Result': 'Hasil',
    'connected to this channel.': 'terhubung ke channel ini.',
    'Undid last action': 'Aksi terakhir dibatalkan',
    'Scene:': 'Scene:',
    'laps': 'lap',
    'Lap to all': 'Lap ke semua',
    'Set position': 'Atur posisi',
    'Set lap count': 'Atur jumlah lap',
    'Turn Manual mode on to arrange the field by hand.': 'Nyalakan Mode manual untuk mengatur urutan secara manual.',
    'Auto-director on': 'Auto-director aktif',
    'Auto-director off': 'Auto-director mati',
    'Link copied': 'Tautan disalin',
    'Shortcuts reset': 'Pintasan direset',
    'Poll opened': 'Voting dibuka',
    'Poll closed': 'Voting ditutup',
    'Countdown set': 'Hitung mundur diset',
    'Clip saved': 'Klip disimpan',
    'OPEN': 'BUKA',
    'votes': 'suara',
    'closed': 'tertutup',
    'Tower title': 'Judul menara',
    'The wordmark shown above the countdown in the WEC skin. Put your series name here.': 'Wordmark di atas hitung mundur pada skin WEC. Isi nama seri kamu di sini.',
    'Dragging and resizing preview here only. Click Apply to OBS to push the changes to every overlay. The count shows how many widgets have un-applied moves.':
      'Geser dan ubah ukuran hanya jadi pratinjau di sini. Klik Terapkan ke OBS untuk mengirim perubahan ke semua overlay. Angka menunjukkan berapa widget yang belum diterapkan.',
    'Layout pushed to overlays': 'Tata letak dikirim ke overlay',
    'Layout applied to OBS': 'Tata letak diterapkan ke OBS',
    'Discard pending changes': 'Buang perubahan tertunda',
    'Pending changes discarded': 'Perubahan tertunda dibuang',
    'No pending changes': 'Tidak ada perubahan tertunda',
    'Head to head picks': 'Pilihan adu dua pembalap',
    'Closest fight, automatically': 'Duel terdekat, otomatis',
    'These two drivers': 'Dua pembalap ini',
    'Driver A': 'Pembalap A',
    'Driver B': 'Pembalap B',
    'Motion check': 'Cek animasi',
    'Play animation rehearsal': 'Putar gladi animasi',
    'Replays every overlay animation on all connected overlays — entrance, position swap, lap pulse, best-lap sweep, flag wipe — without touching race data. Use it to confirm motion is reaching OBS. Most overlay motion is':
      'Memutar ulang tiap animasi overlay di semua overlay yang tersambung — masuknya widget, tukar posisi, denyut lap, sapuan lap terbaik, usapan bendera — tanpa menyentuh data balapan. Pakai untuk memastikan animasinya sampai ke OBS. Sebagian besar animasi overlay itu',
    'event-driven': 'digerakkan kejadian',
    ': with the race idle and no laps coming in, there is nothing to animate.':
      ': kalau balapan siaga dan tidak ada lap masuk, tidak ada yang bisa dianimasikan.',

    'Spoken commentary': 'Komentator suara',
    'off': 'mati',
    'Commentator on': 'Komentator nyala',
    'reads the race out loud': 'membacakan balapan dengan suara',
    'OBS source': 'Sumber OBS',
    'Add this as': 'Tambahkan ini sebagai',
    'one': 'satu',
    'Browser Source, and only one. Every copy works the same lines out from the same race and would speak them in chorus. Its audio arrives in the OBS mixer, so put it under the game.':
      'Browser Source, dan hanya satu. Tiap salinan menghitung kalimat yang sama dari balapan yang sama dan akan bicara berbarengan. Suaranya masuk ke mixer OBS, jadi taruh levelnya di bawah suara game.',
    'How much it talks': 'Seberapa banyak dia bicara',
    'Calm — flags, penalties, the lead': 'Tenang — bendera, penalti, pimpinan',
    'Normal — and overtakes, fastest laps, pit stops':
      'Normal — plus salip-menyalip, lap tercepat, pit stop',
    'Busy — and the outlook, gaps, who is in trouble':
      'Ramai — plus prediksi, gap, siapa yang bermasalah',
    'Voice language': 'Bahasa suara',
    'Indonesian': 'Indonesia',
    'English': 'Inggris',
    'Voice': 'Suara',
    'Best one for the language': 'Yang terbaik untuk bahasanya',
    'Hear this voice': 'Dengarkan suara ini',
    'Speed': 'Kecepatan',
    'Volume': 'Volume',
    'The words follow the voice. Pick a language with no voice installed and it is spoken':
      'Teksnya mengikuti suara. Pilih bahasa yang suaranya belum terpasang, dan dia akan diucapkan',
    'and written': 'dan ditulis',
    'in whatever voice the machine does have, rather than one language read by the mouth of another.':
      'dalam suara apa pun yang dipunyai mesin ini, bukan satu bahasa dibaca oleh mulut bahasa lain.',
    'This list is': 'Daftar ini milik',
    'this': 'mesin ini',
    "machine's. If OBS runs somewhere else, that machine needs the same voice installed — the overlay says so if it is missing, and falls back to the best one it has for the language.":
      '. Kalau OBS jalan di komputer lain, mesin itu butuh suara yang sama terpasang — overlay akan memberi tahu kalau tidak ada, dan turun ke suara terbaik yang dia punya untuk bahasa itu.',
    'Show the caption on screen': 'Tampilkan teks di layar',
    'How to say a name': 'Cara melafalkan nama',
    'Every speech engine mangles a racing name eventually. Write it the way it should sound and it applies everywhere it is spoken.':
      'Tiap mesin suara pada akhirnya merusak nama balap. Tulis sesuai bunyinya, dan itu berlaku di mana pun nama itu diucapkan.',
    'Save pronunciations': 'Simpan pelafalan',

    'Focus driver': 'Pembalap fokus',
    'Drives the lower third, the gap bar, and which driver un-assigned trigger zones fire laps for.':
      'Menentukan lower third, bar gap, dan pembalap mana yang dicatat lapnya oleh area pemicu yang belum ditugaskan.',
    'Ticker': 'Teks berjalan',
    'Auto ticker from race events': 'Teks berjalan otomatis dari kejadian balapan',
    'Update ticker': 'Perbarui teks berjalan',
    'Auto-fill from race': 'Isi otomatis dari balapan',
    'Live preview': 'Pratinjau langsung',
    'Show live preview': 'Tampilkan pratinjau langsung',
    'runs a second copy of the overlay': 'menjalankan satu salinan overlay lagi',
    'The real output is the Browser Source in OBS. This preview is only a convenience, and it costs a whole extra overlay instance to run.':
      'Keluaran sebenarnya adalah Browser Source di OBS. Pratinjau ini cuma kemudahan, dan biayanya satu instance overlay penuh.',

    // ---------------------------------------------------------------- layout
    'Layout editor': 'Editor tata letak',
    'Arrange every widget on one 1920×1080 canvas, then point OBS at a single Browser Source.':
      'Atur tiap widget di satu kanvas 1920×1080, lalu arahkan OBS ke satu Browser Source.',
    '— only the widgets that scene shows appear here. Other scenes keep their own arrangement.':
      '— hanya widget yang ditampilkan scene itu yang muncul di sini. Scene lain punya susunannya sendiri.',
    'Canvas': 'Kanvas',
    'Use game frame as backdrop': 'Pakai frame game sebagai latar',
    'Clear backdrop': 'Hapus latar',
    'Drag to move · corner handle resizes · arrows nudge ·':
      'Seret untuk memindah · pegangan sudut mengubah ukuran · panah menggeser halus ·',
    'ignores snapping': 'mengabaikan snap',
    'The dashed frame is the broadcast safe area. Widgets snap to it, to the canvas centre, and to each other.':
      'Bingkai putus-putus itu area aman siaran. Widget menempel padanya, ke tengah kanvas, dan satu sama lain.',
    'Widget': 'Widget',
    'none': 'tidak ada',
    'Click a widget on the canvas to edit it.': 'Klik widget di kanvas untuk mengeditnya.',
    'Width (0 = auto)': 'Lebar (0 = otomatis)',
    'Scale %': 'Skala %',
    'Panel opacity': 'Kepekatan panel',
    'Corner radius': 'Radius sudut',
    'Drop shadow': 'Bayangan',
    'Lite mode': 'Mode ringan',
    'low-end GPU': 'GPU kelas bawah',
    'Turns off the ambient animation and the shadows on the overlay. Event animation — a position swap, a lap landing, a flag change — keeps running.':
      'Mematikan animasi ambient dan bayangan di overlay. Animasi event — tukar posisi, lap masuk, ganti bendera — tetap jalan.',
    'Whole layout': 'Seluruh tata letak',
    'Reset all positions': 'Reset semua posisi',
    'Layout and style are saved with the event, so OBS picks them up on the next frame — no need to refresh the Browser Source.':
      'Tata letak dan gaya disimpan bersama event, jadi OBS mengambilnya di frame berikutnya — tidak perlu me-refresh Browser Source.',

    // ---------------------------------------------------------------- OBS setup
    'Add each of these as a': 'Tambahkan tiap alamat ini sebagai',
    ', 1920 × 1080, with a transparent background.': ', 1920 × 1080, dengan latar transparan.',
    'Recommended — one source': 'Disarankan — satu sumber',
    'All-in-one': 'Semua dalam satu',
    'One Browser Source carries every widget. Arrange them on the':
      'Satu Browser Source membawa semua widget. Aturlah di halaman',
    'page instead of adding a source per widget — each extra Browser Source is a whole extra browser process for OBS to composite.':
      'daripada menambah satu sumber per widget — tiap Browser Source tambahan adalah satu proses browser penuh yang harus digabung OBS.',
    'Commentator': 'Komentator',
    'A Browser Source that makes sound rather than pictures. Its audio arrives in the OBS mixer, so set its level under the game. Add it':
      'Browser Source yang menghasilkan suara, bukan gambar. Suaranya masuk ke mixer OBS, jadi atur levelnya di bawah suara game. Tambahkan',
    'once': 'sekali saja',
    '— a second copy would work out the same lines and speak them in chorus. Switch it on and choose how much it talks on the':
      '— salinan kedua akan menghitung kalimat yang sama dan bicara berbarengan. Nyalakan dan atur seberapa banyak dia bicara di halaman',
    'page.': '.',
    'Individual sources (only if you need per-widget fades in OBS)':
      'Sumber terpisah (hanya kalau kamu butuh fade per widget di OBS)',
    'Recommended scene layout': 'Susunan scene yang disarankan',
    '1. Source': '1. Sumber',
    '→ your Android emulator (this is the gameplay).':
      '→ emulator Android kamu (ini gameplay-nya).',
    '2. Source': '2. Sumber',
    '(one source with everything), or add the individual URLs above if you want to fade widgets separately in OBS.':
      '(satu sumber berisi semuanya), atau tambahkan URL terpisah di atas kalau kamu ingin mem-fade widget satu per satu di OBS.',
    '3. In the browser source properties tick': '3. Di properti browser source, matikan',
    'Shutdown source when not visible': 'Shutdown source when not visible',
    'off, and leave': ', dan biarkan',
    'Refresh browser when scene becomes active': 'Refresh browser when scene becomes active',
    'off — the overlay reconnects on its own.':
      'tetap mati — overlay menyambung ulang sendiri.',
    '4. Custom CSS field in OBS: leave empty. The pages are already transparent.':
      '4. Kolom Custom CSS di OBS: biarkan kosong. Halamannya memang sudah transparan.',
    '5. Keep this operator tab open on a second monitor. Capture and detection run in this tab.':
      '5. Biarkan tab operator ini terbuka di monitor kedua. Capture dan deteksi berjalan di tab ini.',
    'Network': 'Jaringan',
    'Different IPs on WiFi and Ethernet are normal. What matters is that both devices sit on the same subnet — then the second device just opens the address below.':
      'IP berbeda di WiFi dan Ethernet itu wajar. Yang penting kedua perangkat berada di subnet yang sama — setelah itu perangkat kedua tinggal membuka alamat di bawah.',
    'Connected right now': 'Terhubung sekarang',
    'Multi-device setup': 'Setup banyak perangkat',
    'Open this on the machine that shows the game. It runs capture and detection and nothing else, and shares a preview so you can still draw regions from the operator panel on another device. Everything else — race control, drivers, overlays, layout — is done from this panel over the network.':
      'Buka ini di komputer yang menampilkan game. Dia hanya menjalankan capture dan deteksi, lalu membagikan pratinjau supaya kamu tetap bisa menggambar area dari panel operator di perangkat lain. Sisanya — race control, pembalap, overlay, tata letak — dikerjakan dari panel ini lewat jaringan.',
    'Remote lap trigger': 'Pemicu lap jarak jauh',
    'Any device on your LAN can fire a lap with a plain GET request — handy for a phone or a Stream Deck:':
      'Perangkat mana pun di jaringanmu bisa mencatat lap lewat GET biasa — berguna untuk HP atau Stream Deck:',
    'Driver IDs are listed on the Drivers page.':
      'ID pembalap ada di halaman Pembalap.',

    // ---------------------------------------------------------------- runtime, panel.js
    'URL copied': 'URL disalin',
    'Ticker updated': 'Teks berjalan diperbarui',
    'Rehearsal sent to overlays': 'Gladi dikirim ke overlay',
    'Pronunciations saved': 'Pelafalan disimpan',
    'PowerShell command copied': 'Perintah PowerShell disalin',
    'netsh command copied': 'Perintah netsh disalin',
    'No markers to export': 'Tidak ada penanda untuk diekspor',
    'waiting': 'menunggu',
    'signed in': 'terdaftar',
    'nothing open': 'tidak ada yang terbuka',
    'under investigation': 'sedang diselidiki',
    'Nobody has signed in yet.': 'Belum ada yang mendaftar.',
    'Accept': 'Terima',
    'No': 'Tolak',
    'Nothing connected yet.': 'Belum ada yang tersambung.',
    'Operator panel': 'Panel operator',
    'Overlay (OBS or preview)': 'Overlay (OBS atau pratinjau)',
    'Other client': 'Klien lain',
    'No rounds banked yet. Finish a race, then': 'Belum ada ronde tersimpan. Selesaikan balapan, lalu',
    // ---------------------------------------------------------------- found by ?i18n=debug
    'FR Legends — Broadcast Operator': 'FR Legends — Operator Siaran',
    '⇤ Left': '⇤ Kiri',
    '↔ Centre': '↔ Tengah',
    'Right ⇥': 'Kanan ⇥',
    '⇡ Top': '⇡ Atas',
    '↕ Middle': '↕ Tengah',
    'Bottom ⇣': 'Bawah ⇣',
    'Include in this layout': 'Sertakan di tata letak ini',
    'Reset this widget to default': 'Kembalikan widget ini ke bawaan',
    'League branding': 'Identitas liga',
    'no logo': 'tidak ada logo',
    'Choose logo': 'Pilih logo',
    'League name, shown beside the logo': 'Nama liga, tampil di samping logo',
    'Show in the status bar': 'Tampilkan di status bar',
    'Beside the flag': 'Di samping bendera',
    'Alternate with the flag': 'Bergantian dengan bendera',
    'Seconds on each': 'Detik untuk masing-masing',
    'PNG, JPEG, WebP or SVG, under 2MB. A transparent PNG sits best on the bar.':
      'PNG, JPEG, WebP, atau SVG, di bawah 2MB. PNG transparan paling pas di bar.',
    'Overlay style': 'Gaya overlay',
    'Reason — shown on the broadcast': 'Alasan — tampil di siaran',
    'One message per line': 'Satu pesan per baris',
    'Search… try: sector, OBS, colour, throttle': 'Cari… misal: sektor, OBS, warna, throttle',
    // The placeholder holds a newline; norm() collapses it, so the key is a space.
    'Kinkpedil = Kinkpedil Reysing One name per line, written = spoken':
      'Kinkpedil = Kinkpedil Reysing. Satu nama per baris, tertulis = terucap',

    // ---------------------------------------------------------------- overlay themes
    'The default. Near-black panels, teal accent, quiet lines.':
      'Bawaan. Panel nyaris hitam, aksen teal, garis yang tenang.',
    'Hard black, white accent, hairline rules. Reads as motorsport television.':
      'Hitam pekat, aksen putih, garis setipis rambut. Terbaca seperti siaran motorsport.',
    'High contrast with a glow. Loud on a dark stream, and meant to be.':
      'Kontras tinggi dengan pendar. Mencolok di stream gelap, dan memang disengaja.',
    'Cool blues on deep navy. Calm, easy to read over bright gameplay.':
      'Biru sejuk di atas navy pekat. Tenang, mudah dibaca di atas gameplay terang.',
    'Warm amber on brown-black. Suits evening and drift events.':
      'Amber hangat di atas cokelat-hitam. Cocok untuk event malam dan drift.',
    'Light panels with dark text — the one to use over dark gameplay.':
      'Panel terang dengan teks gelap — pilihan untuk di atas gameplay gelap.',
    'No colour at all. Driver colours still show, nothing else competes with them.':
      'Tanpa warna sama sekali. Warna pembalap tetap tampil, tidak ada yang menyainginya.',
    'Amber terminal. Monospace throughout, square corners, scanline-era.':
      'Terminal amber. Monospace seluruhnya, sudut siku, era scanline.',
    'Heavy opaque panels and big radii. Holds up on a small phone screen.':
      'Panel tebal dan sudut membulat besar. Tetap terbaca di layar HP kecil.',
    'Deep navy and gold. The classic championship-coverage look.':
      'Navy pekat dan emas. Tampilan liputan championship klasik.',
    'Alternate the league logo with the flag in the status bar':
      'Bergantian antara logo liga dan bendera di status bar',
    'run 1': 'run 1',
    'run 2': 'run 2',

    // ---------------------------------------------------------------- runtime, panel.js
    //
    // Everything below was found by walking every page with the switch on and asking
    // FRL_I18N.missing() what it had not been given. Live race text — the event log, the
    // network adapter names — is marked data-i18n-skip in the markup instead: a driver
    // called "Copy" or a penalty reason matching a key would otherwise be translated
    // mid-race, which is the one place this must never be clever.
    'cars': 'mobil',
    'marks': 'penanda',
    'recording': 'merekam',
    'signed in': 'terdaftar',
    'none waiting': 'tidak ada yang menunggu',
    'none': 'tidak ada',
    'any driver': 'pembalap mana pun',
    'no classified sessions': 'tidak ada sesi tersimpan',
    'Driver ID': 'ID pembalap',
    'ON AIR': 'TAYANG',
    'Logo on': 'Logo nyala',
    'ms cross-fade when a scene changes': 'ms transisi saat scene berganti',
    'No events yet.': 'Belum ada kejadian.',
    'No rounds yet.': 'Belum ada ronde.',
    'No rounds banked yet. Finish a race, then press': 'Belum ada ronde tersimpan. Selesaikan balapan, lalu tekan',
    'No classified sessions yet. Press': 'Belum ada sesi tersimpan. Tekan',
    'when one finishes to archive the result.': 'saat satu sesi selesai untuk mengarsipkan hasilnya.',
    'No grid set — the field will line up in roster order.':
      'Grid belum diatur — peserta akan berbaris sesuai urutan daftar.',
    'Pick a pair in the bracket below to put it on air.':
      'Pilih satu pasangan di bracket bawah untuk menayangkannya.',
    'Enter qualifying scores, then press Build bracket.':
      'Isi skor kualifikasi, lalu tekan Susun bracket.',
    'Flags are automatic — setting one by hand takes control':
      'Bendera otomatis — mengatur satu secara manual akan mengambil alih',
    'Automatic flags are off': 'Bendera otomatis dimatikan',
    'Logo and flag are both on screen the whole time':
      'Logo dan bendera sama-sama tampil sepanjang waktu',
    'markers land exactly where the clock says': 'penanda jatuh persis di waktu yang tertera',
    'Detection idle': 'Deteksi siaga',
    'Regions are calibrated but detection is not running':
      'Area sudah dikalibrasi tapi deteksi belum berjalan',
    'Pick the game window on this device first': 'Pilih window game di perangkat ini dulu',
    'Pick the game window on this device with': 'Pilih window game di perangkat ini lewat',

    // Region descriptions, on the Vision page.
    'Minimap (auto position + laps)': 'Minimap (posisi + lap otomatis)',
    'The rectangle containing the in-game minimap.': 'Kotak yang memuat minimap di dalam game.',
    'Drag it tight around the minimap. Every car is found inside this box by its colour, so keep HUD elements of similar colour outside it.':
      'Tarik rapat mengelilingi minimap. Tiap mobil dicari di dalam kotak ini lewat warnanya, jadi jauhkan elemen HUD berwarna mirip dari dalamnya.',
    'Live position of every car, which feeds lap counting, sector splits, the running order and the track map overlay.':
      'Posisi langsung tiap mobil, yang menjadi dasar penghitungan lap, split sektor, urutan, dan overlay peta trek.',
    'closes the lap': 'menutup lap',
    'split 1': 'split 1',
    'split 2': 'split 2',
    'split 3': 'split 3',
    'Sector 1': 'Sektor 1',
    'Sector 2': 'Sektor 2',
    'Sector 3': 'Sektor 3',

    // The firewall walkthrough, which is the longest thing an operator reads here.
    'Use this': 'Pakai ini',
    'The other device must be on the same': 'Perangkat satunya harus berada di',
    'network — check its IP starts the same way. If it does and the page still will not load, Windows Firewall is blocking the port: Windows denies inbound connections by default, and a server started from a terminal never raises the usual prompt.':
      'yang sama — periksa apakah IP-nya diawali sama. Kalau sudah sama dan halamannya tetap tidak terbuka, Windows Firewall memblokir port-nya: Windows menolak koneksi masuk secara bawaan, dan server yang dijalankan dari terminal tidak pernah memunculkan izin yang biasa.',
    '1. Open a terminal as Administrator on this machine':
      '1. Buka terminal sebagai Administrator di komputer ini',
    '(Win+X → Terminal (Admin)).': '(Win+X → Terminal (Admin)).',
    '2. PowerShell': '2. PowerShell',
    '— this is what Terminal (Admin) opens:': '— ini yang dibuka Terminal (Admin):',
    'or Command Prompt': 'atau Command Prompt',
    '— the netsh form only works in cmd.exe, PowerShell eats its quotes:':
      '— bentuk netsh hanya jalan di cmd.exe, PowerShell memakan tanda kutipnya:',
    '3. Verify': '3. Pastikan',
    '— in any terminal,': '— di terminal mana pun,',
    'should print the rule.': 'akan menampilkan aturannya.',
    '4. Test': '4. Uji',
    '— from the other device open': '— dari perangkat satunya, buka',
    ', or run': ', atau jalankan',

    // Widget names, as they appear in a scene summary rather than on a toggle.
    'Leaderboard': 'Leaderboard',
    'Timing tower': 'Timing tower',
    'Status bar': 'Status bar',
    'Lower third': 'Lower third',
    'Gap bar': 'Bar gap',
    'Results': 'Hasil',
    'Track map': 'Peta trek',
    'Tandem battle': 'Tandem battle',
    'Starting grid': 'Grid start',
    'Head to head': 'Adu dua pembalap',
    '+ Lap': '+ Lap',
    '. The overlay in OBS picks from its own list, which on the same machine is this one.':
      '. Overlay di OBS memilih dari daftarnya sendiri, yang di komputer yang sama adalah daftar ini.',

    'Broadcast skin': 'Skin siaran',
    'Classic': 'Klasik',
    'MotoGP': 'MotoGP',
    'The skin reshapes the widgets; the template below still sets the colours, so any combination works. Classic is the original look.':
      'Skin mengubah bentuk widget; template di bawah tetap mengatur warnanya, jadi kombinasi apa pun bisa. Klasik adalah tampilan asli.',
    'Loading the manual…': 'Memuat panduan…',

    // ---------------------------------------------------------------- version + updates
    'Version and updates': 'Versi dan update',
    'You are running': 'Kamu memakai',
    'Check for updates': 'Cek update',
    "What's new in each version": 'Apa yang baru di tiap versi',
    'Tell me about beta versions': 'Beri tahu saya soal versi beta',
    'Betas get new features first, so you can try them before race day. Do not run a beta at a real event. The normal download never becomes a beta.':
      'Versi beta mendapat fitur baru lebih dulu, jadi bisa kamu coba sebelum hari race. Jangan pakai versi beta di event sungguhan. Download biasa tidak pernah berubah jadi beta.',
    'Update available': 'Ada update',
    'The website always runs the newest version. The desktop app tells you itself when it has an update.':
      'Website selalu memakai versi terbaru. Aplikasi desktop akan memberi tahu sendiri kalau ada update.',
    'Could not reach the FRLcast server.': 'Tidak bisa menghubungi server FRLcast.',
    'A newer version is available:': 'Ada versi yang lebih baru:',
    'Could not check for updates (offline?).': 'Tidak bisa mengecek update (sedang offline?).',
    'This is the newest version.': 'Ini versi terbaru.',
    'This copy runs from source, so it updates with git rather than by itself.':
      'Salinan ini berjalan dari source code, jadi update-nya lewat git, bukan otomatis.',
    'Installing the update and restarting. This window reloads by itself.':
      'Memasang update dan me-restart. Jendela ini akan memuat ulang sendiri.',
    'Downloading the update:': 'Mengunduh update:',
    'Checking the download...': 'Memeriksa hasil unduhan...',
    'is available.': 'sudah tersedia.',
    'You have': 'Versimu sekarang',
    'Hide': 'Tutup',
    "What's new": 'Apa yang baru',
    'Update now': 'Update sekarang',
    'Download': 'Unduh',
    'Hide until the next version': 'Sembunyikan sampai versi berikutnya',
    'Later': 'Nanti',
    'A race is running. Finish it first: updating restarts the server.':
      'Race sedang berjalan. Selesaikan dulu: update akan me-restart server.',
    'The update did not finish:': 'Update tidak selesai:',
    'Full changelog': 'Changelog lengkap',
    'Update to': 'Update ke',
    'now?': 'sekarang?',
    'FRLcast restarts (about a minute). Your event, drivers, API key, voices and logo are kept, and your data is backed up first.':
      'FRLcast akan restart (sekitar satu menit). Event, pembalap, API key, voice, dan logo tetap aman, dan datamu di-backup dulu.',

    // ---------------------------------------------------------------- online link
    'Drivers from anywhere (online link)': 'Pembalap dari mana saja (link online)',
    'off': 'mati',
    'not linked': 'belum terhubung',
    'online': 'online',
    'waiting': 'menunggu',
    'not yet': 'belum',
    'just now': 'barusan',
    'ago': 'lalu',
    'Online: drivers anywhere type the event code': 'Online: pembalap dari mana saja mengetik kode event',
    'in the driver app.': 'di aplikasi driver.',
    'This copy has no online project configured, so the online link is not available.':
      'Salinan ini tidak punya proyek online, jadi link online tidak tersedia.',
    'For an online league: drivers join from anywhere with the driver app and an event code, while race control runs here with everything the desktop app has.':
      'Untuk liga online: pembalap bergabung dari mana saja lewat aplikasi driver dan kode event, sementara race control tetap berjalan di sini dengan semua fitur aplikasi desktop.',
    'Sign in with your FRLcast website account (the one for the dashboard). Only a sign-in token is kept on this PC, never your password.':
      'Masuk dengan akun website FRLcast kamu (yang dipakai untuk dashboard). Yang disimpan di PC ini hanya token login, bukan password-mu.',
    'Email': 'Email',
    'Password': 'Password',
    'Signed in as': 'Masuk sebagai',
    'Pick the event your drivers will join.': 'Pilih event yang akan diikuti pembalapmu.',
    'Link': 'Hubungkan',
    'You have no events on the website yet.': 'Kamu belum punya event di website.',
    'Create one on the dashboard': 'Buat satu di dashboard',
    'then come back here.': 'lalu kembali ke sini.',
    'Linking makes this PC the timing computer for that event: its grid, flags and penalties are replaced by the ones here. Do not also run the web console for it.':
      'Menghubungkan menjadikan PC ini komputer timing untuk event itu: grid, bendera, dan penaltinya diganti dengan yang ada di sini. Jangan jalankan console web untuk event yang sama.',
    'Online league, drivers at home?': 'Liga online, pembalap di rumah?',
    'Set up the online link': 'Atur link online',
    'No account yet?': 'Belum punya akun?',
    'Create one on the website': 'Buat di website',
    '(free, once), then sign in here.': '(gratis, cukup sekali), lalu masuk di sini.',
    'Use an event you already have': 'Pakai event yang sudah ada',
    'Or make a new one': 'Atau buat yang baru',
    'Make your event': 'Buat event-mu',
    'Code drivers type': 'Kode yang diketik pembalap',
    'Create and link': 'Buat dan hubungkan',
    '4 to 12 letters or digits, unique across every league on FRLcast. Avoid O next to 0.':
      '4 sampai 12 huruf atau angka, unik di semua liga FRLcast. Hindari huruf O di sebelah angka 0.',
    'Refresh list': 'Muat ulang daftar',
    'Sign in': 'Masuk',
    'Sign out': 'Keluar',
    'Event code': 'Kode event',
    'Drivers type this code in the driver app, from anywhere. Their sign-ins appear on the Race page to accept, and flags, positions and penalties reach their phones.':
      'Pembalap mengetik kode ini di aplikasi driver, dari mana saja. Pendaftaran mereka muncul di halaman Race untuk diterima, dan bendera, posisi, serta penalti sampai ke HP mereka.',
    'Last sent': 'Terakhir dikirim',
    'last checked': 'terakhir dicek',
    'Keep FRLcast running during the event.': 'Biarkan FRLcast tetap jalan selama event.',
    'Unlink': 'Putuskan',
    'Unlink? Drivers using the event code stop receiving flags until you link again.':
      'Putuskan link? Pembalap yang memakai kode event berhenti menerima bendera sampai kamu menghubungkan lagi.',
    'Sign out and unlink? Drivers using the event code stop receiving flags.':
      'Keluar dan putuskan link? Pembalap yang memakai kode event berhenti menerima bendera.',

    'pending': 'menunggu',
    'approved': 'diterima',
    'rejected': 'ditolak'
  };

  window.FRL_I18N.install(ID, KEEP);
})();
