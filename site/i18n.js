/*
 * The words the public site speaks. The switching lives in js/i18n-core.js.
 *
 * Kept apart from the console's dictionary on purpose: making a landing page carry four
 * hundred operator strings to translate eight of its own is a real cost on the one page
 * where load time is visible to a stranger.
 */
(function () {
  'use strict';
  if (!window.FRL_I18N || !window.FRL_I18N.install) return;

  var KEEP = [
    'FRL BROADCAST', 'supabase-config.js', 'npm start', 'http://localhost:4700',
    'NUSANTARA DRIFT LEAGUE', 'NDL3', 'ROUND 1', 'EBISU MINAMI', 'you@league.example',
    'FR Legends', 'OBS', 'VSC', 'APK', 'REPORT', 'APP', 'Supabase'
  ];

  var ID = {
    // ---------------------------------------------------------------- navigation
    'The console': 'Konsol',
    'How it works': 'Cara kerjanya',
    'Driver app': 'Aplikasi driver',
    'Open the dashboard': 'Buka dashboard',
    'Get the driver app': 'Ambil aplikasi driver',
    'Back to the site': 'Kembali ke situs',
    'Sign in': 'Masuk',
    'Sign out': 'Keluar',

    // ---------------------------------------------------------------- notice
    'Want the commentator and fully automatic timing?': 'Mau pakai komentator dan timing otomatis penuh?',
    'The website runs your event, the audience poll and the driver app. But the spoken commentator, the natural voice, and fully automatic live timing read straight from the game only run in the free desktop app. That part needs a program on your own machine, not this website.': 'Website menjalankan event, voting penonton, dan aplikasi driver. Tapi komentator suara, suara natural, dan timing otomatis penuh yang dibaca langsung dari game hanya jalan di aplikasi desktop gratis. Bagian itu butuh program di mesin kamu sendiri, bukan di website ini.',

    // ---------------------------------------------------------------- hero
    'Race control for your FR Legends league.': 'Race control untuk liga FR Legends kamu.',
    'Live timing, flags and OBS overlays from one console, with every flag going straight to the drivers’ phones.':
      'Timing langsung, bendera, dan overlay OBS dari satu konsol, dan tiap bendera langsung sampai ke HP driver.',
    'Live timing, flags and OBS overlays from one console, with every flag going straight to the drivers\' phones.':
      'Timing langsung, bendera, dan overlay OBS dari satu konsol, dan tiap bendera langsung sampai ke HP driver.',

    // ---------------------------------------------------------------- console section
    'One console runs the whole session.': 'Satu konsol menjalankan seluruh sesi.',
    'Timing, the flag, the grid, penalties and every overlay come from the same screen. What you change here is on the stream in the same second.':
      'Timing, bendera, grid, penalti, dan semua overlay berasal dari layar yang sama. Yang kamu ubah di sini muncul di stream pada detik yang sama.',

    // ---------------------------------------------------------------- capabilities
    'Everything a league night needs, in one place.': 'Semua yang dibutuhkan malam balapan, di satu tempat.',
    'Timing': 'Timing',
    'Live classification with gaps, last lap and best lap': 'Klasemen langsung dengan gap, lap terakhir, dan lap terbaik',
    'Predicted running order between timing crossings': 'Perkiraan urutan di antara dua lintasan timing',
    'Pit, DNF and manual lap correction': 'Pit, DNF, dan koreksi lap manual',
    'Results export at the end of the session': 'Ekspor hasil di akhir sesi',
    'Race control': 'Race control',
    'Formation, green, yellow, safety car, VSC, red, chequered':
      'Formasi, hijau, kuning, safety car, VSC, merah, kotak-kotak',
    'Automatic flags for stopped cars, with the operator able to take over':
      'Bendera otomatis untuk mobil yang berhenti, dan operator bisa mengambil alih',
    'Time penalties, drive throughs, warnings and disqualification':
      'Penalti waktu, drive through, peringatan, dan diskualifikasi',
    'Investigations that stay open until a steward decides':
      'Investigasi yang tetap terbuka sampai steward memutuskan',
    'Broadcast': 'Siaran',
    'Overlays for leaderboard, tower, gap, lower third, results and track map':
      'Overlay untuk leaderboard, tower, gap, lower third, hasil, dan peta trek',
    'Scenes that switch and transition inside one browser source':
      'Scene yang berganti dan bertransisi di dalam satu browser source',
    'Ten themes, plus your league logo in the status bar':
      'Sepuluh tema, plus logo ligamu di status bar',
    'Highlight markers written as you go, for the VOD edit':
      'Penanda highlight dicatat sambil jalan, untuk edit VOD',
    'Championship': 'Championship',
    'Points scheme you set yourself': 'Skema poin yang kamu atur sendiri',
    'Results kept per round': 'Hasil disimpan per ronde',
    'Standings on screen and on its own page': 'Klasemen di layar dan di halamannya sendiri',
    'Drift': 'Drift',
    'Tandem battles with judging': 'Tandem battle dengan penjurian',
    'Brackets that follow the running order': 'Bracket yang mengikuti urutan',
    'Scores on the overlay as they are given': 'Skor tampil di overlay begitu diberikan',
    'Tracking': 'Pelacakan',
    'Cars followed by colour on the capture feed': 'Mobil diikuti lewat warna di feed capture',
    'The circuit learned from the first clean laps': 'Sirkuit dipelajari dari beberapa lap bersih pertama',
    'Capture from this machine or from a phone': 'Capture dari mesin ini atau dari HP',

    // ---------------------------------------------------------------- the two paths
    'Two people use this, and they use it differently.':
      'Dua orang memakai ini, dan cara pakainya berbeda.',
    'RACE CONTROL': 'RACE CONTROL',
    'DRIVERS': 'DRIVER',
    'Sign in and open your event': 'Masuk dan buka event kamu',
    'Your event is yours. Two leagues running the same night never see each other’s timing.':
      'Event kamu milik kamu. Dua liga yang balapan di malam yang sama tidak akan pernah melihat timing satu sama lain.',
    'Your event is yours. Two leagues running the same night never see each other\'s timing.':
      'Event kamu milik kamu. Dua liga yang balapan di malam yang sama tidak akan pernah melihat timing satu sama lain.',
    'Build the grid': 'Susun grid',
    'Add drivers yourself, or accept the ones who sign in from the app. Accepting one puts them on the grid.':
      'Tambahkan driver sendiri, atau terima yang mendaftar lewat aplikasi. Menerima satu driver langsung menaruhnya di grid.',
    'Point OBS at the overlay': 'Arahkan OBS ke overlay',
    'One browser source per overlay, or one scene source for all of them.':
      'Satu browser source per overlay, atau satu scene source untuk semuanya.',
    'Run the session': 'Jalankan sesinya',
    'Start the race, work the flags, hand out penalties. The drivers see it on their phones.':
      'Mulai balapan, mainkan benderanya, jatuhkan penalti. Driver melihatnya di HP masing-masing.',
    'Install the app': 'Pasang aplikasinya',
    'One Android file, about 33 KB. No store account needed.':
      'Satu file Android, sekitar 33 KB. Tidak perlu akun toko aplikasi.',
    'Register once': 'Daftar sekali',
    'Racing name, number and a password. Race control decides who gets in.':
      'Nama balap, nomor, dan kata sandi. Race control yang menentukan siapa yang masuk.',
    'Sign in to the event': 'Masuk ke event',
    'The server address your race control gives you, your number, your password.':
      'Kode event dari race control kamu, nomormu, dan kata sandimu.',
    'Turn on the floating flag': 'Nyalakan bendera mengambang',
    'It rides over FR Legends while you drive, at whatever size you drag it to.':
      'Dia menumpang di atas FR Legends saat kamu menyetir, dengan ukuran sebesar apa pun yang kamu mau.',

    // ---------------------------------------------------------------- driver app
    'The flag reaches the driver, not just the stream.':
      'Benderanya sampai ke driver, bukan cuma ke stream.',
    'A phone in a pocket is no use mid corner, so the app draws its own window on top of the game. Flags land there in about a second. Penalties arrive with the steward’s reason attached, in the same words race control typed.':
      'HP di dalam saku tidak ada gunanya di tengah tikungan, jadi aplikasinya menggambar jendelanya sendiri di atas game. Bendera sampai di situ dalam sekitar satu detik. Penalti datang lengkap dengan alasan steward, persis kata-kata yang diketik race control.',
    'A phone in a pocket is no use mid corner, so the app draws its own window on top of the game. Flags land there in about a second. Penalties arrive with the steward\'s reason attached, in the same words race control typed.':
      'HP di dalam saku tidak ada gunanya di tengah tikungan, jadi aplikasinya menggambar jendelanya sendiri di atas game. Bendera sampai di situ dalam sekitar satu detik. Penalti datang lengkap dengan alasan steward, persis kata-kata yang diketik race control.',
    'Download the driver app': 'Unduh aplikasi driver',
    'APK · 33 KB · Android 7.0 and up': 'APK · 33 KB · Android 7.0 ke atas',
    'Floating window': 'Jendela mengambang',
    'Drag it anywhere, drag the corner to any size down to a thumbnail. It stays where you put it.':
      'Geser ke mana saja, tarik sudutnya sampai sekecil thumbnail. Dia tetap di tempat kamu menaruhnya.',
    'Penalties': 'Penalti',
    'A banner with what you were given and why, then the window goes back to the flag.':
      'Banner berisi apa yang kamu dapat dan kenapa, lalu jendelanya kembali ke bendera.',
    'Permission': 'Izin',
    'Android asks once for permission to draw over other apps. Without it the window cannot appear.':
      'Android meminta izin sekali untuk menggambar di atas aplikasi lain. Tanpa itu jendelanya tidak bisa muncul.',
    'Signing in': 'Cara masuk',
    'Type the event code race control gives you, four to twelve letters, like NDL3, not this website’s address. A link they send you works too.':
      'Ketik kode event yang diberikan race control, empat sampai dua belas huruf, seperti NDL3, bukan alamat situs ini. Tautan yang mereka kirim juga bisa.',

    // ---------------------------------------------------------------- closing
    'Ready for the next round.': 'Siap untuk ronde berikutnya.',
    'Set up the event, hand the drivers the app, and go live.':
      'Siapkan event-nya, bagikan aplikasinya ke driver, lalu mulai siaran.',

    // ---------------------------------------------------------------- image descriptions
    'Broadcast overlay showing a green flag, the event name, lap counter and a ten car leaderboard.':
      'Overlay siaran menampilkan bendera hijau, nama event, penghitung lap, dan leaderboard sepuluh mobil.',
    'The operator console: session timer, flag buttons from formation to chequered, live classification with per driver lap and penalty controls, and event details.':
      'Konsol operator: timer sesi, tombol bendera dari formasi sampai kotak-kotak, klasemen langsung dengan kontrol lap dan penalti per driver, serta detail event.',
    'An Android phone showing the driver app with a floating blue window reading UNDER INVESTIGATION over the app, and a notification giving the reason.':
      'HP Android menampilkan aplikasi driver dengan jendela biru mengambang bertuliskan UNDER INVESTIGATION di atas aplikasi, dan notifikasi berisi alasannya.',

    // ---------------------------------------------------------------- sign in
    'Not connected yet': 'Belum tersambung',
    'Sign in needs a Supabase project before it can do anything.':
      'Halaman masuk butuh project Supabase sebelum bisa melakukan apa pun.',
    'Put your project URL and anon key into': 'Masukkan URL project dan anon key kamu ke',
    ', then redeploy. Until then this page has nothing to sign you in to.':
      ', lalu deploy ulang. Sampai itu dilakukan, halaman ini tidak punya tempat untuk memasukkan kamu.',
    'Your event, your grid, your overlays.': 'Event kamu, grid kamu, overlay kamu.',
    'Email': 'Email',
    'Password': 'Kata sandi',
    'First time here? Create an account': 'Baru pertama kali? Buat akun',
    'Already have an account? Sign in': 'Sudah punya akun? Masuk',
    'Create an account': 'Buat akun',
    'Signed in': 'Sudah masuk',
    'Race control opens from the dashboard and runs in this browser. Your events, your grid and your driver sign-ins are all there.':
      'Race control dibuka dari dashboard dan berjalan di browser ini. Event, grid, dan pendaftaran driver kamu semuanya ada di sana.',

    // ---------------------------------------------------------------- dashboard
    'Your events': 'Event kamu',
    'Loading your events…': 'Memuat event kamu…',
    'One event is one room. Two leagues racing the same night never see each other’s timing.':
      'Satu event adalah satu ruang. Dua liga yang balapan di malam yang sama tidak akan pernah melihat timing satu sama lain.',
    'One event is one room. Two leagues racing the same night never see each other\'s timing.':
      'Satu event adalah satu ruang. Dua liga yang balapan di malam yang sama tidak akan pernah melihat timing satu sama lain.',
    'New event': 'Event baru',
    'The code is what drivers type into the app and what the overlays take in their URL. Keep it unambiguous: no letter O next to a zero.':
      'Kode inilah yang diketik driver di aplikasi dan yang dibaca overlay dari URL-nya. Buat yang tidak membingungkan: jangan ada huruf O di sebelah angka nol.',
    'Event name': 'Nama event',
    'Code': 'Kode',
    'Round': 'Ronde',
    'Track': 'Trek',
    'Total laps': 'Jumlah lap',
    'Create event': 'Buat event',
    '4 to 12 letters and digits': '4 sampai 12 huruf dan angka',
    'No events yet. Make one above.': 'Belum ada event. Buat satu di atas.',
    'Open race control': 'Buka race control',
    'Race report': 'Laporan balapan',
    'Copy': 'Salin',
    'Copied': 'Tersalin',
    'drivers type': 'driver mengetik',
    'into the driver app': 'di aplikasi driver',
    'Driver sign-ins': 'Pendaftaran driver',
    'idle': 'siaga',
    'green': 'hijau',
    'yellow': 'kuning',
    'red': 'merah',
    'safety': 'safety car',
    'formation': 'formasi',
    'finished': 'selesai',
    'Accept': 'Terima',
    'No': 'Tolak',
    'Nobody has signed in yet.': 'Belum ada yang mendaftar.',
    'waiting': 'menunggu',
    'no round set': 'ronde belum diisi',
    'no track': 'trek belum diisi',
    'laps': 'lap',
    'flag': 'bendera',
    'This site has no Supabase project configured yet.':
      'Situs ini belum dikonfigurasi dengan project Supabase.',
    'That code is already taken. Pick another.': 'Kode itu sudah dipakai. Pilih yang lain.',
    // The tab title and the description a search engine shows.
    'FRL Broadcast: live timing and overlays for FR Legends leagues':
      'FRL Broadcast: timing langsung dan overlay untuk liga FR Legends',
    'Race control, automatic flags, penalties and OBS overlays for FR Legends leagues. Drivers get every flag on their phone through a floating window.':
      'Race control, bendera otomatis, penalti, dan overlay OBS untuk liga FR Legends. Driver menerima tiap bendera di HP lewat jendela mengambang.',
    'Sign in to FRL Broadcast': 'Masuk ke FRL Broadcast',
    'Sign in to run your FR Legends league event.': 'Masuk untuk menjalankan event liga FR Legends kamu.',

    'pending': 'menunggu',
    'approved': 'diterima',
    'rejected': 'ditolak',

    // ---------------------------------------------------------------- what's new
    'What\'s new': 'Yang baru',
    'Team radio, on air': 'Radio tim, tayang',
    'A driver types a call (like BOX BOX) in the app, it reaches every teammate\'s floating window, shows on the broadcast, and is read aloud, then clears itself after 10 to 20s.':
      'Pembalap mengetik pesan (mis. BOX BOX) di app, sampai ke jendela mengambang tiap rekan setim, muncul di siaran, dan dibacakan suara, lalu hilang sendiri setelah 10 to 20 detik.',
    'Eight more skins': 'Delapan skin baru',
    'DTM, Formula E, GTWC, IMSA, IndyCar, NASCAR, Porsche Cup and Super GT, eleven looks in all.':
      'DTM, Formula E, GTWC, IMSA, IndyCar, NASCAR, Porsche Cup, dan Super GT, total sebelas tampilan.',
    'Scene stingers': 'Stinger antar-scene',
    'An accent-colour wipe with your wordmark plays when you switch event scenes, only on scenes, never on a flag.':
      'Sapuan warna aksen dengan wordmark-mu muncul saat ganti scene event, hanya saat scene, tak pernah saat flag.',
    'Race recap to Discord': 'Ringkasan balapan ke Discord',
    'A written summary of the race, built for you and posted to Discord in one click.':
      'Ringkasan balapan tertulis, dibuatkan untukmu dan dikirim ke Discord sekali klik.',
    'More broadcast tools': 'Lebih banyak alat siaran',
    'Highlight-reel marker export, a multiview control room, and saved "looks" that store a skin + theme you can reapply.':
      'Ekspor penanda highlight reel, ruang kontrol multiview, dan "look" tersimpan yang menyimpan skin + tema untuk dipakai ulang.',
    'Self-updating overlay': 'Overlay perbarui-sendiri',
    'The overlay heals its own connection and picks up each new version on its own, no more refreshing the OBS source after an update.':
      'Overlay memulihkan koneksinya sendiri dan mengambil tiap versi baru otomatis, tak perlu lagi refresh source OBS tiap update.',
    'The console keeps getting better. The latest additions:':
      'Konsol terus berkembang. Tambahan terbaru:',
    'Broadcast skins': 'Skin siaran',
    'MotoGP, WEC and F1 on top of Classic, class grouping, 3-letter codes, team-colour tabs and a custom header wordmark. A skin changes shape; the theme still sets colours.':
      'MotoGP, WEC, dan F1 selain Classic, pengelompokan kelas, kode 3-huruf, tab warna tim, dan wordmark header custom. Skin mengubah bentuk; tema tetap mengatur warna.',
    'New overlay widgets': 'Widget overlay baru',
    'Fastest-lap banner, sector-time card, team radio, audience poll, sponsor rotator, pre-show countdown and a driver intro card, each a toggle you can place on the layout.':
      'Banner lap tercepat, kartu waktu sektor, radio tim, voting penonton, rotator sponsor, hitung mundur pra-acara, dan kartu perkenalan pembalap, masing-masing toggle yang bisa kamu taruh di layout.',
    'Manual mode': 'Mode manual',
    'For a low-spec machine with no camera: set the order by drag or ▲▼, add laps by hand, by typed time, or with a per-driver stopwatch.':
      'Untuk mesin spek rendah tanpa kamera: atur urutan lewat geser atau ▲▼, tambah lap manual, lewat waktu ketik, atau dengan stopwatch tiap pembalap.',
    'Public live page': 'Halaman live publik',
    'A no-login page viewers follow on their phone, classification, flag, fastest lap and championship, plus live audience voting.':
      'Halaman tanpa login yang diikuti penonton di HP, klasemen, bendera, lap tercepat, dan championship, plus voting penonton langsung.',
    'Shortcuts & Stream Deck': 'Pintasan & Stream Deck',
    'Bind any control to a key you choose; a Stream Deck Hotkey button sends the same keystroke, no plugin, no server.':
      'Ikat kontrol apa pun ke tombol pilihanmu; tombol Hotkey Stream Deck mengirim keystroke yang sama, tanpa plugin, tanpa server.',
    'OBS WebSocket': 'OBS WebSocket',
    'Optional: let the console cut OBS scenes on a flag and save a replay clip on a marker.':
      'Opsional: biarkan konsol mengganti scene OBS saat flag dan menyimpan klip replay saat marker.',
    'Faster operating': 'Operasi lebih cepat',
    'One-click scene bar, an auto-director for the fastest-lap banner and results, and undo with Ctrl+Z.':
      'Bar scene satu klik, auto-director untuk banner lap tercepat dan hasil, serta undo dengan Ctrl+Z.',
    'Bilingual manual': 'Manual dua bahasa',
    'The in-console Help now covers every feature in both English and Indonesian.':
      'Menu Help di konsol kini mencakup tiap fitur dalam bahasa Inggris dan Indonesia.'
  };

  window.FRL_I18N.install(ID, KEEP);
})();
