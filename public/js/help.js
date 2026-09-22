/*
 * The operator manual, in two languages.
 *
 * ------------------------------------------------------------------ why it was rewritten
 *
 * The previous version opened by telling the reader that everything runs locally on their
 * own machine, that there is no external server and that no internet is needed. All three
 * were true when it was written and none of them are true now: an event can live in
 * Postgres, race control can run from a browser tab with no server on the operator's
 * machine at all, and the driver app talks to the event rather than to a laptop.
 *
 * A manual that is wrong is worse than no manual, because it is read at exactly the moment
 * somebody is already confused.
 *
 * ------------------------------------------------------------------ why it is shaped like this
 *
 * Both languages sit side by side on every block rather than in two separate documents.
 * Two documents drift: somebody corrects a sentence in one, the other keeps the old claim,
 * and nobody notices until a reader follows the stale half. Here a block physically cannot
 * hold one language without the other being next to it.
 *
 * The rest of the product translates through a dictionary keyed by English sentences. That
 * suits interface labels and fails for long prose — paragraph-length keys are unreadable
 * and a table row is not a sentence. So the manual carries its own translations and the
 * Help page is marked data-i18n-skip.
 */

/** Pick one language out of anything below: a string, a {en, id} pair, or an array of either. */
function pick(value, lang) {
  if (Array.isArray(value)) return value.map((v) => pick(v, lang));
  if (value && typeof value === 'object') return value[lang] ?? value.en;
  return value;
}

const T = (en, id) => ({ en: en, id: id });

const SECTIONS = [

  // ---------------------------------------------------------------- what this is
  {
    id: 'overview',
    title: T('What this is', 'Gambaran umum'),
    blocks: [
      { type: 'p', text: T(
        'This turns an FR Legends session into a broadcast: live timing, a leaderboard, OBS overlays, penalties with reasons, and a flag on every driver’s phone.',
        'Ini mengubah sesi FR Legends jadi siaran: timing langsung, leaderboard, overlay OBS, penalti beserta alasannya, dan bendera di HP tiap pembalap.') },

      { type: 'h', text: T('Two ways to run it', 'Dua cara menjalankannya') },
      {
        type: 'table',
        head: T(['Way', 'What runs where', 'Use it when'],
                ['Cara', 'Apa jalan di mana', 'Pakai kalau']),
        rows: [
          [T('<b>Hosted</b>', '<b>Hosted</b>'),
           T('The event lives in Postgres. Race control is a browser tab on the website. Nothing runs on your machine but the browser.',
             'Event tersimpan di Postgres. Race control adalah tab browser di website. Tidak ada yang jalan di mesinmu selain browser.'),
           T('Drivers are in different places, or you want the overlays and the report reachable from anywhere.',
             'Pembalap tersebar di tempat berbeda, atau kamu ingin overlay dan laporan bisa dibuka dari mana saja.')],
          [T('<b>Local</b>', '<b>Lokal</b>'),
           T('A small server on your own machine holds the event. Everything talks to it over your network.',
             'Server kecil di mesinmu sendiri yang memegang event. Semuanya bicara ke sana lewat jaringanmu.'),
           T('Everybody is in one room, or the internet is not dependable that night.',
             'Semua orang ada di satu ruangan, atau internetnya tidak bisa diandalkan malam itu.')]
        ]
      },
      { type: 'note', text: T(
        'The console, the overlays and the driver app are the same in both. What changes is where the event is kept. An overlay address with <code>?event=CODE</code> in it is a hosted event; without one it looks for a server on the machine it was opened from.',
        'Konsol, overlay, dan aplikasi driver sama persis di keduanya. Yang berbeda cuma di mana event-nya disimpan. Alamat overlay dengan <code>?event=KODE</code> berarti event hosted; tanpa itu, dia mencari server di mesin tempat halaman itu dibuka.') },

      { type: 'h', text: T('The pieces', 'Bagian-bagiannya') },
      {
        type: 'table',
        head: T(['Piece', 'Job'], ['Bagian', 'Tugasnya']),
        rows: [
          [T('Operator console', 'Konsol operator'),
           T('This screen. Flags, grid, penalties, overlays, and — in a hosted event — the timing itself.',
             'Layar ini. Bendera, grid, penalti, overlay, dan — di event hosted — timing-nya sendiri.')],
          [T('Overlays', 'Overlay'),
           T('Transparent 1920×1080 pages OBS takes as a Browser Source.',
             'Halaman transparan 1920×1080 yang diambil OBS sebagai Browser Source.')],
          [T('Driver app', 'Aplikasi driver'),
           T('An Android window that floats over the game with the current flag, and shows penalties with the reason you typed.',
             'Jendela Android yang mengambang di atas game dengan bendera terkini, dan menampilkan penalti beserta alasan yang kamu ketik.')],
          [T('Vision / AI', 'Vision / AI'),
           T('Watches the game window and calls the laps. Runs in this tab, on the machine showing the game.',
             'Mengawasi window game dan mencatat lap. Jalan di tab ini, di mesin yang menampilkan game.')]
        ]
      },
      { type: 'warn', text: T(
        '<b>One console at a time.</b> In a hosted event this tab is the timing computer: it works out positions and gaps and writes them. Two tabs open on the same event would each believe they were the only one.',
        '<b>Satu konsol saja dalam satu waktu.</b> Di event hosted, tab ini adalah komputer timing-nya: dia yang menghitung posisi dan gap lalu menulisnya. Dua tab terbuka di event yang sama akan sama-sama mengira dirinya satu-satunya.') }
    ]
  },

  // ---------------------------------------------------------------- hosted
  {
    id: 'hosted',
    title: T('Running a hosted event', 'Menjalankan event hosted'),
    blocks: [
      { type: 'p', text: T(
        'No server to start, nothing to install. You need the website, a sign-in, and OBS.',
        'Tidak ada server yang perlu dinyalakan, tidak ada yang perlu dipasang. Kamu cuma butuh website, akun, dan OBS.') },
      {
        type: 'steps',
        items: [
          T('Sign in on the site and open <b>your events</b>. Make an event: a name and a short code drivers can type, like <code>NDL3</code>.',
            'Masuk ke situs lalu buka <b>Event kamu</b>. Buat event: satu nama dan satu kode pendek yang bisa diketik pembalap, misalnya <code>NDL3</code>.'),
          T('Press <b>Open race control</b>. That is this console, pointed at the event. <b>Leave the tab open</b> for the whole session.',
            'Tekan <b>Buka race control</b>. Itu konsol ini, diarahkan ke event tersebut. <b>Biarkan tabnya terbuka</b> selama sesi berlangsung.'),
          T('Copy the <b>OBS</b> address from the event card and add it in OBS as a Browser Source, 1920×1080.',
            'Salin alamat <b>OBS</b> dari kartu event lalu tambahkan di OBS sebagai Browser Source, 1920×1080.'),
          T('Give drivers the event code. They type it into the app, register, and appear in <b>Driver sign-ins</b>.',
            'Berikan kode event ke pembalap. Mereka mengetiknya di aplikasi, mendaftar, lalu muncul di <b>Pendaftaran pembalap</b>.'),
          T('Accept each one. Accepting puts them on the grid and starts sending them flags.',
            'Terima satu per satu. Menerima langsung menaruh mereka di grid dan mulai mengirimi bendera.')
        ]
      },
      { type: 'note', text: T(
        'The sign-in queue is on both the dashboard and this console’s Race control page. They are the same queue, so accept somebody from wherever you happen to be.',
        'Antrean pendaftaran ada di dashboard dan juga di halaman Race control konsol ini. Keduanya antrean yang sama, jadi terima dari mana pun kamu sedang berada.') },
      { type: 'warn', text: T(
        'Capture and lap detection cannot run in a hosted event unless this tab is on the machine showing the game. The browser has to see the window to read it.',
        'Capture dan deteksi lap tidak bisa jalan di event hosted kecuali tab ini ada di mesin yang menampilkan game. Browser harus bisa melihat window-nya untuk membacanya.') }
    ]
  },

  // ---------------------------------------------------------------- local
  {
    id: 'local',
    title: T('Running it locally', 'Menjalankan secara lokal'),
    blocks: [
      { type: 'p', text: T(
        'A small server on your own machine holds the event. Everything on your network talks to it, and nothing leaves the building.',
        'Server kecil di mesinmu sendiri yang memegang event. Semua perangkat di jaringanmu bicara ke sana, dan tidak ada yang keluar dari ruangan.') },
      {
        type: 'steps',
        items: [
          T('In a terminal, from the project folder: <code>npm start</code>.',
            'Di terminal, dari folder proyek: <code>npm start</code>.'),
          T('Open <code>http://localhost:4700</code>. That is this console.',
            'Buka <code>http://localhost:4700</code>. Itu konsol ini.'),
          T('Add drivers on the <b>Drivers</b> page, or let them sign in from the app using the address shown on the Race control page.',
            'Tambahkan pembalap di halaman <b>Pembalap</b>, atau biarkan mereka mendaftar dari aplikasi memakai alamat yang tertera di halaman Race control.'),
          T('Point OBS at the overlay address on the <b>OBS setup</b> page.',
            'Arahkan OBS ke alamat overlay di halaman <b>Setup OBS</b>.')
        ]
      },
      { type: 'warn', text: T(
        'The server does not resume the race clock after a restart. If it stops while the flag is green, the session comes back red so you notice and decide yourself.',
        'Server tidak melanjutkan jam balapan setelah restart. Kalau dia mati saat bendera hijau, sesinya kembali dalam status merah supaya kamu sadar dan memutuskan sendiri.') },
      { type: 'note', text: T(
        'Everything is written to <code>data/state.json</code> as it happens. Back that file up before an event if the night matters.',
        'Semuanya ditulis ke <code>data/state.json</code> sambil jalan. Cadangkan file itu sebelum event kalau malam itu penting.') }
    ]
  },

  // ---------------------------------------------------------------- race control
  {
    id: 'race',
    title: T('Page: Race control', 'Halaman: Race control'),
    blocks: [
      { type: 'p', text: T(
        'The page you work from during a session. Everything here reaches the overlays in the same second.',
        'Halaman tempat kamu bekerja selama sesi. Semua di sini sampai ke overlay pada detik yang sama.') },
      {
        type: 'table',
        head: T(['Control', 'What it does'], ['Kontrol', 'Fungsinya']),
        rows: [
          [T('Start race', 'Mulai balapan'),
           T('Starts the clock and throws the green flag. The first lap is timed from this moment.',
             'Menjalankan jam dan mengibarkan bendera hijau. Lap pertama dihitung dari momen ini.')],
          [T('Flag buttons', 'Tombol bendera'),
           T('Formation, green, yellow, safety car, VSC, red, chequered. Pressing one by hand takes control away from the automatic flags until you hand it back.',
             'Formasi, hijau, kuning, safety car, VSC, merah, kotak-kotak. Menekan satu secara manual mengambil alih dari bendera otomatis sampai kamu mengembalikannya.')],
          [T('Live classification', 'Klasemen langsung'),
           T('Position, laps, last and best lap, gap. Each row has <b>+ Lap</b>, <b>Undo</b>, pit, a five second penalty and DNF.',
             'Posisi, lap, lap terakhir dan terbaik, gap. Tiap baris punya <b>+ Lap</b>, <b>Undo</b>, pit, penalti lima detik, dan DNF.')],
          [T('Race control (penalties)', 'Race control (penalti)'),
           T('Pick a driver, a kind, and type the reason. The reason goes out on the broadcast and to that driver’s phone, word for word.',
             'Pilih pembalap, jenisnya, lalu ketik alasannya. Alasan itu tayang di siaran dan sampai ke HP pembalap tersebut, kata demi kata.')],
          [T('Automatic findings', 'Temuan otomatis'),
           T('Jump starts and track limits only. Both are geometry the system already measures. Contact and blocking are judgement calls and are never raised automatically.',
             'Hanya start mencuri dan batas trek. Keduanya geometri yang memang sudah diukur sistem. Kontak dan menghalangi adalah penilaian manusia, dan tidak pernah diangkat otomatis.')],
          [T('Highlights for the VOD', 'Highlight untuk VOD'),
           T('Press <b>Start markers</b> at the same moment you press Record in OBS. Overtakes, fastest laps and pit stops are timestamped against that moment, then exported as YouTube chapters or CSV.',
             'Tekan <b>Mulai penanda</b> di saat yang sama kamu menekan Record di OBS. Salip, lap tercepat, dan pit stop diberi stempel waktu terhadap momen itu, lalu diekspor sebagai YouTube chapters atau CSV.')]
        ]
      },
      { type: 'note', text: T(
        'A penalty under investigation stays open and visible until a steward decides it. Nothing decides it for you.',
        'Penalti yang sedang diselidiki tetap terbuka dan terlihat sampai steward memutuskannya. Tidak ada yang memutuskan untukmu.') }
    ]
  },

  // ---------------------------------------------------------------- drivers and the app
  {
    id: 'drivers',
    title: T('Drivers and the app', 'Pembalap dan aplikasinya'),
    blocks: [
      { type: 'p', text: T(
        'A car can be entered by hand on the Drivers page, or a driver can sign in from their phone and be accepted.',
        'Sebuah mobil bisa dimasukkan manual di halaman Pembalap, atau pembalap mendaftar dari HP lalu diterima.') },
      { type: 'warn', text: T(
        '<b>Colour matters.</b> The vision engine finds each car by its minimap colour, so use the exact in-game colour. Two cars with close colours are two cars the detector will confuse.',
        '<b>Warna itu penting.</b> Mesin visi menemukan tiap mobil lewat warnanya di minimap, jadi pakai warna persis seperti di game. Dua mobil dengan warna berdekatan adalah dua mobil yang akan tertukar oleh detektor.') },

      { type: 'h', text: T('What the driver does', 'Yang dilakukan pembalap') },
      {
        type: 'steps',
        items: [
          T('Download the app from the website and install it. One Android file, about 33 KB.',
            'Unduh aplikasinya dari website lalu pasang. Satu file Android, sekitar 33 KB.'),
          T('Type the <b>event code</b> — not the website address. A link race control sends them works too, because the code is in it.',
            'Ketik <b>kode event</b> — bukan alamat website. Tautan yang dikirim race control juga bisa, karena kodenya ada di dalamnya.'),
          T('Register once with a racing name, a race number, a password, and optionally a team.',
            'Daftar sekali dengan nama balap, nomor, kata sandi, dan opsional nama tim.'),
          T('Allow drawing over other apps, then turn on the floating flag. Drag it anywhere, drag its corner to any size.',
            'Izinkan menggambar di atas aplikasi lain, lalu nyalakan bendera mengambang. Geser ke mana saja, tarik sudutnya sampai ukuran mana pun.')
        ]
      },
      { type: 'note', text: T(
        'The team a driver types goes onto their car when you accept them, so nobody in race control types a team list by hand. Leaving the box empty never clears a team you set yourself.',
        'Tim yang diketik pembalap langsung menempel di mobilnya saat kamu menerima pendaftarannya, jadi tidak ada yang perlu mengetik daftar tim di race control. Mengosongkan kolomnya tidak pernah menghapus tim yang kamu atur sendiri.') },
      { type: 'p', text: T(
        'Until you accept them they get no flags, and the app tells them that is what is happening rather than sitting silent.',
        'Sebelum kamu menerima mereka, mereka tidak menerima bendera apa pun — dan aplikasinya memberi tahu bahwa itulah yang sedang terjadi, bukan diam saja.') }
    ]
  },

  // ---------------------------------------------------------------- vision
  {
    id: 'vision',
    title: T('Page: Vision / AI', 'Halaman: Vision / AI'),
    blocks: [
      { type: 'p', text: T(
        'Share the game window, mark the regions to watch, and let it call the laps. It runs in this browser tab, on the machine showing the game.',
        'Bagikan window game, tandai area yang harus diawasi, lalu biarkan dia mencatat lap. Ini berjalan di tab browser ini, di mesin yang menampilkan game.') },
      { type: 'warn', text: T(
        '<b>Detection must run on the machine that shows the game.</b> Capture happens inside the tab, and the tab has to be able to see the window. Video cannot be detected from somewhere else.',
        '<b>Deteksi harus jalan di mesin yang menampilkan game.</b> Capture terjadi di dalam tab, dan tab itu harus bisa melihat window-nya. Video tidak bisa dideteksi dari jarak jauh.') },
      {
        type: 'table',
        head: T(['Setting', 'What it changes'], ['Pengaturan', 'Yang diubahnya']),
        rows: [
          [T('Tracking method', 'Metode pelacakan'),
           T('Colour matches each car’s colour. Motion finds what moves against a static circuit. Hybrid tries colour first and lets motion fill the gaps.',
             'Warna mencocokkan warna tiap mobil. Gerak mencari yang bergerak terhadap sirkuit yang diam. Hibrida mencoba warna dulu lalu gerak menutup celahnya.')],
          [T('Colour tolerance', 'Toleransi warna'),
           T('How far a pixel may be from the driver’s colour and still count. Raise it if cars are not found, lower it if two cars swap.',
             'Seberapa jauh sebuah piksel boleh menyimpang dari warna pembalap dan tetap dihitung. Naikkan kalau mobil tidak ketemu, turunkan kalau dua mobil tertukar.')],
          [T('Min blob pixels', 'Piksel blob minimum'),
           T('The smallest patch that counts as a car. Lower it when cars are small on screen.',
             'Bercak terkecil yang dianggap mobil. Turunkan kalau mobil kecil di layar.')],
          [T('Pixel sampling', 'Pencuplikan piksel'),
           T('Every pixel is accurate. Every 2nd is four times cheaper, every 3rd nine times. Use every pixel if cars are small.',
             'Tiap piksel itu akurat. Tiap ke-2 empat kali lebih ringan, tiap ke-3 sembilan kali. Pakai tiap piksel kalau mobilnya kecil.')],
          [T('Min lap', 'Lap minimum'),
           T('A crossing that arrives sooner than this is detector noise and is ignored. The manual <b>+ Lap</b> button ignores the rule.',
             'Crossing yang datang lebih cepat dari ini dianggap noise detektor dan diabaikan. Tombol <b>+ Lap</b> manual mengabaikan aturan ini.')]
        ]
      },
      { type: 'note', text: T(
        'The tracking list tells you what is happening: <b>seen</b> means the detector found that car’s colour a moment ago, <b>not found</b> means it did not.',
        'Daftar pelacakan memberi tahu apa yang sedang terjadi: <b>terlihat</b> berarti detektor baru saja menemukan warna mobil itu, <b>tidak ketemu</b> berarti tidak.') }
    ]
  },

  // ---------------------------------------------------------------- calibration
  {
    id: 'calibration',
    title: T('Calibration, step by step', 'Kalibrasi, langkah demi langkah'),
    blocks: [
      { type: 'p', text: T(
        'Do this once per map. Changing map or resolution means doing it again.',
        'Lakukan ini sekali per map. Ganti map atau resolusi berarti mengulanginya.') },
      {
        type: 'steps',
        items: [
          T('<b>Minimap zone</b> → drag a box tight around the in-game minimap. Keep HUD elements of a similar colour outside it.',
            'Tool <b>Area minimap</b> → tarik kotak rapat mengelilingi minimap di dalam game. Jauhkan elemen HUD berwarna mirip dari dalamnya.'),
          T('<b>Draw racing line</b> → click point by point along the track inside the minimap and close the loop. This gives the running order before the first lap, and feeds the track map overlay.',
            'Mode <b>Gambar racing line</b> → klik titik demi titik mengikuti jalur di dalam minimap, lalu tutup kembali ke titik awal. Ini memberi urutan sebelum lap pertama, dan menjadi dasar overlay peta trek.'),
          T('<b>Finish line</b> → click two points across the track at the start/finish, one each side.',
            'Tool <b>Garis finis</b> → klik dua titik memotong lintasan di garis start/finis, satu di tiap sisi.'),
          T('<b>Sector line</b> → repeat at each sector split, in racing order. Two sector lines give three sectors.',
            'Tool <b>Garis sektor</b> → ulangi di tiap pembagi sektor, urut sesuai arah balapan. Dua garis sektor menghasilkan tiga sektor.'),
          T('Optional: <b>Pit lane zone</b> → drag a box over the pit branch.',
            'Opsional: tool <b>Area pit lane</b> → tarik kotak di cabang pit.'),
          T('Check the <b>Timing lines</b> list. Make sure the order and the names are right.',
            'Cek daftar <b>Garis timing</b>. Pastikan urutan dan namanya benar.')
        ]
      },
      { type: 'h', text: T('Line direction', 'Arah garis') },
      { type: 'p', text: T(
        'A new line accepts both directions and sits in <i>learning direction</i>. The first car through sets the direction that counts, so a car wobbling over the line afterwards is not counted twice. <b>Flip</b> reverses it if it learned the wrong way.',
        'Garis yang baru digambar menerima dua arah dan berstatus <i>learning direction</i>. Mobil pertama yang melewatinya menetapkan arah yang dihitung, sehingga mobil yang goyang bolak-balik di atas garis tidak dihitung dua kali. <b>Flip</b> membalik arahnya kalau ternyata salah.') },
      { type: 'h', text: T('Order is enforced', 'Urutan dipaksa') },
      { type: 'p', text: T(
        'An out-of-order crossing is refused: sector 2 is not accepted before sector 1. That is what stops an occasionally wrong detector from corrupting the timing.',
        'Crossing yang tidak berurutan ditolak: sektor 2 tidak diterima kalau sektor 1 belum dilewati. Itulah yang membuat detektor yang sesekali salah tidak bisa merusak timing.') }
    ]
  },

  // ---------------------------------------------------------------- engine
  {
    id: 'engine',
    title: T('How detection works', 'Cara kerja deteksi'),
    blocks: [
      { type: 'p', text: T(
        'Every frame goes through four stages. All of it is ordinary arithmetic — no model, no GPU.',
        'Tiap frame melewati empat tahap. Semuanya aritmetika biasa — tanpa model, tanpa GPU.') },
      {
        type: 'table',
        head: T(['Stage', 'What happens'], ['Tahap', 'Isinya']),
        rows: [
          [T('1. Classify', '1. Classify'),
           T('Each minimap pixel becomes a driver index through a 32×32×32 colour cube built once when the roster changes. One array read per pixel.',
             'Tiap piksel di minimap jadi indeks pembalap lewat lookup cube warna 32×32×32 yang dibangun sekali saat roster berubah. Satu pembacaan array per piksel.')],
          [T('2. Blobs', '2. Blobs'),
           T('Connected components join neighbouring pixels. The largest per driver wins, so reflections and noise are dropped.',
             'Connected-component menyatukan piksel bertetangga. Yang terbesar per pembalap yang diambil, jadi pantulan dan noise terbuang.')],
          [T('3. Tracker', '3. Tracker'),
           T('Each car carries a position and a speed. When its blob is lost the track coasts on the last speed, and that speed is also how a stopped car is spotted.',
             'Tiap mobil punya posisi dan kecepatan. Saat blob-nya hilang, track meluncur pakai kecepatan terakhir — dan kecepatan itu juga yang dipakai untuk mendeteksi mobil berhenti.')],
          [T('4. Crossing', '4. Crossing'),
           T('The step between frames is tested for intersection with every timing line, including <i>where</i> in that step, so the time is interpolated.',
             'Perpindahan antar frame diuji perpotongannya dengan tiap garis timing — termasuk <i>di mana</i> dalam langkah itu, jadi waktunya diinterpolasi.')]
        ]
      },
      { type: 'h', text: T('Why it is cheap', 'Kenapa ini ringan') },
      { type: 'p', text: T(
        'The naive approach — for each driver, scan every pixel — costs one full pass per car. This is two passes however many cars there are. Measured on a 200×180 minimap: 4 cars 7.6 ms per frame, 12 cars 8.3 ms.',
        'Pendekatan naif "untuk tiap pembalap, pindai semua piksel" butuh satu lintasan penuh per mobil. Cara ini dua lintasan, berapa pun jumlah mobilnya. Terukur pada minimap 200×180: 4 mobil 7,6 ms per frame, 12 mobil 8,3 ms.') },
      { type: 'h', text: T('Why it is accurate', 'Kenapa ini akurat') },
      { type: 'p', text: T(
        'Because the crossing is interpolated, a lap time is not locked to a multiple of the frame interval. In a 15 fps simulation — 66.7 ms between frames — a 4.000 second lap reads 4.000 seconds. Detection that only knows which frame is out by up to ±66 ms.',
        'Karena perpotongan garis diinterpolasi, waktu lap tidak terkunci di kelipatan frame. Pada uji simulasi 15 fps — jarak antar frame 66,7 ms — lap 4,000 detik terbaca 4,000 detik. Deteksi yang cuma tahu "frame ke berapa" meleset sampai ±66 ms.') },
      { type: 'note', text: T(
        'Because it tests the movement segment rather than nearness to the line, a lower frame rate costs precision — it does not lose the lap.',
        'Karena yang diuji adalah segmen perpindahan, bukan kedekatan ke garis, frame rate yang turun mengurangi presisi waktu — bukan menghilangkan lapnya.') }
    ]
  },

  // ---------------------------------------------------------------- performance
  {
    id: 'performance',
    title: T('If it lags', 'Kalau lag'),
    blocks: [
      { type: 'note', text: T(
        '<b>This application already starts on the Low spec profile.</b> The first time it opens in a browser it picks Low spec and the overlay starts in Lite mode. Raise it to Balanced or Quality whenever you like — nothing is lost.',
        '<b>Aplikasi ini sudah berjalan dengan profil Spek rendah secara bawaan.</b> Saat pertama dibuka di sebuah browser, preset Spek rendah dipakai otomatis dan overlay memulai dalam Mode ringan. Naikkan ke Seimbang atau Kualitas kapan saja — tidak ada yang hilang.') },
      { type: 'p', text: T(
        'What makes a machine struggle during a broadcast is usually not this detection, which runs under 10 ms a frame. It is the emulator, the OBS video encoder, and pixels being moved around for nothing. Work down the list in order.',
        'Yang membuat komputer berat saat siaran biasanya bukan deteksi ini — deteksi jalan di bawah 10 ms per frame. Yang berat adalah emulator, encoder video OBS, dan piksel yang dipindah-pindah percuma. Kerjakan daftarnya berurutan.') },
      {
        type: 'table',
        head: T(['Try this', 'Why it helps'], ['Coba ini', 'Kenapa membantu']),
        rows: [
          [T('Lower <b>Detection FPS</b>', 'Turunkan <b>FPS deteksi</b>'),
           T('Timing precision drops, laps do not. 10 fps is plenty for a club race.',
             'Presisi waktu berkurang, lapnya tidak hilang. 10 fps sudah cukup untuk balapan klub.')],
          [T('Set <b>Preview</b> to Off', 'Set <b>Pratinjau</b> ke Mati'),
           T('Drawing the capture on screen costs more than reading it. Detection keeps running.',
             'Menggambar hasil capture di layar lebih mahal daripada membacanya. Deteksi tetap jalan.')],
          [T('Cap <b>Capture width</b>', 'Batasi <b>Lebar capture</b>'),
           T('Fewer pixels to move every frame, before anything even looks at them.',
             'Lebih sedikit piksel yang dipindah tiap frame, bahkan sebelum ada yang melihatnya.')],
          [T('Tighten the <b>Minimap zone</b>', 'Rapatkan <b>Area minimap</b>'),
           T('The detector only reads inside that box. A smaller box is less work per frame.',
             'Detektor hanya membaca di dalam kotak itu. Kotak lebih kecil berarti kerja lebih sedikit per frame.')],
          [T('Turn on <b>Lite mode</b> on the Layout page', 'Nyalakan <b>Mode ringan</b> di halaman Tata letak'),
           T('Stops the overlay’s ambient animation and shadows. Event animation keeps running.',
             'Mematikan animasi ambient dan bayangan overlay. Animasi event tetap jalan.')]
        ]
      },
      { type: 'warn', text: T(
        'If detection reports 1–5 fps it is almost never a slow computer. Look first at the emulator’s own frame rate, then at whether OBS is encoding on the CPU.',
        'Kalau deteksi cuma dapat 1–5 fps, hampir tidak pernah karena komputernya lambat. Periksa dulu frame rate emulatornya sendiri, lalu apakah OBS meng-encode pakai CPU.') }
    ]
  },

  // ---------------------------------------------------------------- overlays
  {
    id: 'overlays',
    title: T('Overlays, scenes and layout', 'Overlay, scene, dan tata letak'),
    blocks: [
      { type: 'p', text: T(
        'One Browser Source carries every widget. What is visible, where it sits and how it looks are all set here and reach OBS in under a frame.',
        'Satu Browser Source membawa semua widget. Apa yang tampil, di mana letaknya, dan bagaimana tampilannya semua diatur di sini dan sampai ke OBS dalam kurang dari satu frame.') },
      {
        type: 'table',
        head: T(['Widget', 'Shows'], ['Widget', 'Menampilkan']),
        rows: [
          [T('Leaderboard', 'Leaderboard'),
           T('Left rail: position, number, name, team, gap to the leader.',
             'Rail kiri: posisi, nomor, nama, tim, gap ke pemimpin.')],
          [T('Timing tower', 'Timing tower'),
           T('Right rail: position, sector pips, last lap, best lap, interval to the car ahead.',
             'Rail kanan: posisi, pip sektor, lap terakhir, lap terbaik, interval ke mobil di depan.')],
          [T('Status bar', 'Status bar'),
           T('Top: flag, event name, lap counter, race clock, fastest lap, your league logo.',
             'Atas: bendera, nama event, penghitung lap, jam balapan, lap tercepat, logo ligamu.')],
          [T('Lower third', 'Lower third'),
           T('The focus driver, with their last lap and any penalty.',
             'Pembalap fokus, dengan lap terakhir dan penaltinya kalau ada.')],
          [T('Gap bar / Head to head', 'Bar gap / Adu dua pembalap'),
           T('The closest fight on track, picked automatically or by you.',
             'Duel terdekat di trek, dipilih otomatis atau olehmu.')],
          [T('Track map', 'Peta trek'),
           T('Live car positions on the racing line you drew.',
             'Posisi mobil langsung di atas racing line yang kamu gambar.')],
          [T('Results / Standings', 'Hasil / Klasemen'),
           T('The classification at the flag, and the championship table.',
             'Klasemen saat bendera, dan tabel championship.')],
          [T('Fastest lap', 'Lap tercepat'),
           T('A banner naming who holds the fastest lap, in their team colour.',
             'Banner yang menyebut pemegang lap tercepat, dengan warna timnya.')],
          [T('Sector times', 'Waktu sektor'),
           T('The focus driver’s last lap split into sectors — purple best, green personal best, yellow set.',
             'Lap terakhir pembalap fokus dipecah per sektor — ungu terbaik sesi, hijau terbaik pribadi, kuning biasa.')],
          [T('Team radio', 'Radio tim'),
           T('A driver name and a quote you type — the radio card. Set the driver + text on the Overlays page.',
             'Nama pembalap dan kutipan yang kamu ketik — kartu radio. Atur pembalap + teks di halaman Overlay.')],
          [T('Audience poll', 'Voting penonton'),
           T('A live bar chart of viewer votes. Open the poll on the Overlays page (needs the votes table).',
             'Diagram batang suara penonton secara langsung. Buka voting di halaman Overlay (butuh tabel votes).')],
          [T('Sponsor', 'Sponsor'),
           T('A rotating sponsor strip — a label or a logo image, cycled every few seconds.',
             'Strip sponsor bergilir — teks atau gambar logo, berganti tiap beberapa detik.')],
          [T('Countdown', 'Hitung mundur'),
           T('A big clock counting down to a moment you set — a pre-show timer.',
             'Jam besar menghitung mundur ke waktu yang kamu set — timer pra-acara.')],
          [T('Driver intro', 'Perkenalan pembalap'),
           T('A large card for the focus driver: number, name, team, championship points.',
             'Kartu besar untuk pembalap fokus: nomor, nama, tim, poin championship.')]
        ]
      },
      { type: 'h', text: T('Broadcast skins', 'Skin siaran') },
      { type: 'p', text: T(
        'A skin reshapes the same widgets into a series look — Classic (the original), MotoGP (tilted number chips, black + orange, a session progress bar), WEC (navy endurance tower with class banners), and F1 (near-black tower, team-colour tabs, 3-letter codes, a purple fastest-lap pill). A skin changes shape; the theme still sets colours; any combination works. Pick it on the Overlays page. On WEC / MotoGP / F1 you can also set a custom header wordmark (Tower title).',
        'Skin membentuk ulang widget yang sama menjadi tampilan sebuah seri — Classic (asli), MotoGP (chip nomor miring, hitam + oranye, bar progres sesi), WEC (menara ketahanan navy dengan banner kelas), dan F1 (menara nyaris hitam, tab warna tim, kode 3-huruf, pil lap tercepat ungu). Skin mengubah bentuk; tema tetap mengatur warna; kombinasi apa pun bisa. Pilih di halaman Overlay. Di WEC / MotoGP / F1 kamu juga bisa mengatur wordmark header sendiri (Tower title).') },
      { type: 'p', text: T(
        'WEC groups the field by a driver’s Class (set on the Drivers page) with a coloured banner per class; F1 shows a 3-letter code taken from a driver’s short name.',
        'WEC mengelompokkan grid berdasarkan Class pembalap (diatur di halaman Drivers) dengan banner berwarna per kelas; F1 menampilkan kode 3-huruf dari nama pendek pembalap.') },
      { type: 'h', text: T('Scenes and the moment bar', 'Scene dan bar momen') },
      { type: 'p', text: T(
        'A scene is one set of visible widgets and one arrangement of them. The row of scene chips at the top of Race control puts any scene on air in one click and cross-fades the overlay. OBS needs only the one address — the change happens inside it, so there is no second Browser Source.',
        'Scene adalah satu set widget yang tampil beserta susunannya. Deretan chip scene di atas Race control menayangkan scene mana pun dengan satu klik dan membuat overlay bertransisi. OBS hanya butuh satu alamat — pergantiannya terjadi di dalamnya, jadi tidak perlu Browser Source kedua.') },
      { type: 'h', text: T('Layout editor', 'Editor tata letak') },
      { type: 'p', text: T(
        'On the Layout page, click a widget (or pick it from the list) to select it, then drag it or use the size/scale fields. Dragging reaches the overlays live; the Apply button forces every overlay to redraw the current layout if one ever looks out of date.',
        'Di halaman Layout, klik widget (atau pilih dari daftar) untuk memilihnya, lalu geser atau pakai kolom ukuran/skala. Menggeser langsung sampai ke overlay; tombol Apply memaksa semua overlay menggambar ulang tata letak sekarang jika ada yang terlihat kedaluwarsa.') },
      { type: 'h', text: T('Auto-director', 'Auto-director') },
      { type: 'p', text: T(
        'On the Overlays page, Auto-director flashes the fastest-lap banner for a few seconds whenever the record falls and brings up the results screen at the chequered flag. It only toggles widgets you can also toggle by hand.',
        'Di halaman Overlay, Auto-director menampilkan banner lap tercepat beberapa detik tiap rekor terpecah dan memunculkan layar hasil saat bendera kotak-kotak. Hanya menyalakan widget yang bisa kamu nyalakan sendiri.') },
      { type: 'note', text: T(
        'Layout and style are saved with the event, so OBS picks them up on the next frame — no need to refresh the Browser Source, though a hard re-add is still the surest way to load a new app version.',
        'Tata letak dan gaya disimpan bersama event, jadi OBS mengambilnya di frame berikutnya — tak perlu refresh Browser Source, meski hapus+tambah ulang tetap cara paling pasti memuat versi aplikasi baru.') }
    ]
  },

  // ---------------------------------------------------------------- manual mode
  {
    id: 'manual',
    title: T('Manual mode (no camera)', 'Mode manual (tanpa kamera)'),
    blocks: [
      { type: 'p', text: T(
        'For a low-spec machine that cannot run the tracker, the Manual control card on Race control lets you own the order and the laps by hand. Turn on Manual mode and the computed ranking is set aside — the field follows the order you arrange.',
        'Untuk mesin spek rendah yang tak kuat menjalankan tracker, kartu Manual control di Race control membuatmu mengatur urutan dan lap secara manual. Nyalakan Mode manual dan peringkat otomatis dikesampingkan — grid mengikuti urutan yang kamu susun.') },
      {
        type: 'table',
        head: T(['Control', 'What it does'], ['Kontrol', 'Fungsinya']),
        rows: [
          [T('Drag / ▲▼', 'Geser / ▲▼'),
           T('Change a driver’s position. It updates the overlays immediately.',
             'Mengubah posisi pembalap. Langsung memperbarui overlay.')],
          [T('+Lap', '+Lap'),
           T('Add a lap using the current time.', 'Menambah lap memakai waktu sekarang.')],
          [T('Type a lap time', 'Ketik lap time'),
           T('Enter 35.2, 35.200 or 1:35.200 then +Lap to record that exact time.',
             'Masukkan 35.2, 35.200 atau 1:35.200 lalu +Lap untuk mencatat waktu itu.')],
          [T('Stopwatch (⏱)', 'Stopwatch (⏱)'),
           T('Start, then stop to record the elapsed time as the lap.',
             'Start, lalu stop untuk mencatat waktu berjalan sebagai lap.')],
          [T('−', '−'),
           T('Remove the driver’s last lap.', 'Menghapus lap terakhir pembalap.')]
        ]
      },
      { type: 'note', text: T(
        'Ctrl+Z (or the Undo button) reverses the last race-control action, including a wrong manual lap or flag.',
        'Ctrl+Z (atau tombol Undo) membatalkan aksi race-control terakhir, termasuk lap atau flag manual yang salah.') }
    ]
  },

  // ---------------------------------------------------------------- public page + voting
  {
    id: 'public',
    title: T('Public live page & voting', 'Halaman publik & voting'),
    blocks: [
      { type: 'p', text: T(
        'A hosted event has a no-login page viewers can open to follow the race live on a phone: the classification, the flag, the fastest lap and the championship, updating automatically, with an ID / EN switch. Copy its link from the Public live timing box on Race control, or share /live?event=CODE.',
        'Event hosted punya halaman tanpa login yang bisa dibuka penonton untuk mengikuti balapan langsung di HP: klasemen, bendera, lap tercepat, dan championship, diperbarui otomatis, dengan pengalih ID / EN. Salin tautannya dari kotak Public live timing di Race control, atau bagikan /live?event=CODE.') },
      { type: 'h', text: T('Audience voting', 'Voting penonton') },
      { type: 'p', text: T(
        'Open a poll on the Overlays page (the options are your current drivers). Viewers vote on the live page and the tally moves in real time on the Audience poll overlay widget. Voting needs a one-time votes table in Supabase — run the migration SQL from the file you were given, then it just works.',
        'Buka voting di halaman Overlay (opsinya adalah daftar pembalapmu saat ini). Penonton memilih di halaman live dan hitungannya bergerak real-time di widget overlay Audience poll. Voting butuh tabel votes sekali saja di Supabase — jalankan SQL migration dari file yang diberikan, lalu langsung jalan.') }
    ]
  },

  // ---------------------------------------------------------------- OBS websocket
  {
    id: 'obsws',
    title: T('OBS control & clips (optional)', 'Kontrol OBS & klip (opsional)'),
    blocks: [
      { type: 'p', text: T(
        'Entirely optional: nothing connects until you press Connect. On OBS setup, the OBS control card lets the console drive OBS over WebSocket — cut cameras on a flag, and save a replay-buffer clip on a marker.',
        'Sepenuhnya opsional: tak ada yang konek sampai kamu tekan Connect. Di OBS setup, kartu OBS control membuat konsol mengendalikan OBS lewat WebSocket — ganti kamera saat flag, dan simpan klip replay buffer saat marker.') },
      {
        type: 'table',
        head: T(['Step', 'Do'], ['Langkah', 'Lakukan']),
        rows: [
          [T('1', '1'),
           T('In OBS, Tools → WebSocket Server Settings → enable, note the port and password.',
             'Di OBS, Tools → WebSocket Server Settings → aktifkan, catat port dan password.')],
          [T('2', '2'),
           T('For clips, enable the Replay Buffer (Settings → Output).',
             'Untuk klip, aktifkan Replay Buffer (Settings → Output).')],
          [T('3', '3'),
           T('Paste ws://localhost:4455 and the password, press Connect, then pick the scenes for Green and Caution.',
             'Tempel ws://localhost:4455 dan password, tekan Connect, lalu pilih scene untuk Green dan Caution.')]
        ]
      },
      { type: 'note', text: T(
        'Keep the address on localhost. The hosted console is https and browsers only allow ws:// to the loopback address; a LAN address is blocked. If your browser still blocks it, open the console over http on the same machine as OBS.',
        'Biarkan alamat di localhost. Konsol hosted memakai https dan browser hanya mengizinkan ws:// ke alamat loopback; alamat LAN diblokir. Kalau browser tetap memblokir, buka konsol lewat http di mesin yang sama dengan OBS.') }
    ]
  },

  // ---------------------------------------------------------------- commentary
  {
    id: 'commentary',
    title: T('The spoken commentator', 'Komentator suara'),
    blocks: [
      { type: 'p', text: T(
        'A Browser Source that makes sound instead of pictures. It reads the flags, the penalties with the reason you typed, the lead, overtakes — and, turned up, who is likely to win, who is fighting for a podium and whose pace is falling away.',
        'Browser Source yang menghasilkan suara, bukan gambar. Dia membacakan bendera, penalti beserta alasan yang kamu ketik, pimpinan, salip-menyalip — dan kalau dinaikkan, siapa yang mungkin menang, siapa yang memperebutkan podium, dan siapa yang pace-nya turun.') },
      {
        type: 'steps',
        items: [
          T('Switch it on in <b>Overlays → Spoken commentary</b> and choose how much it talks.',
            'Nyalakan di <b>Overlay → Komentator suara</b> dan pilih seberapa banyak dia bicara.'),
          T('Copy the address there and add it in OBS as a Browser Source — <b>once</b>, and only once.',
            'Salin alamatnya lalu tambahkan di OBS sebagai Browser Source — <b>satu kali saja</b>.'),
          T('Tick <b>Control audio via OBS</b> in the source properties, then set its level in the mixer under the game.',
            'Centang <b>Control audio via OBS</b> di properti source-nya, lalu atur levelnya di mixer di bawah suara game.')
        ]
      },
      { type: 'warn', text: T(
        '<b>Add it once.</b> Every copy works the same lines out from the same race and would speak them in chorus.',
        '<b>Tambahkan sekali saja.</b> Tiap salinan menghitung kalimat yang sama dari balapan yang sama dan akan bicara berbarengan.') },
      { type: 'h', text: T('Language and voice', 'Bahasa dan suara') },
      { type: 'p', text: T(
        'The words follow the voice, not the setting. Ask for Indonesian on a machine with no Indonesian voice and the commentary is spoken <i>and written</i> in English, because Indonesian read by an English voice is not an accent — it is unintelligible. The Overlays page names the voice it found.',
        'Teksnya mengikuti suara, bukan setelan. Minta bahasa Indonesia di mesin yang tidak punya suara Indonesia, dan komentarnya diucapkan <i>dan ditulis</i> dalam bahasa Inggris — karena bahasa Indonesia dibaca suara Inggris itu bukan aksen, melainkan tidak bisa dipahami. Halaman Overlay menyebutkan suara yang ditemukannya.') },
      { type: 'note', text: T(
        'Windows does not ship an Indonesian voice. To add one: Settings, Time &amp; language, Language &amp; region, Add a language, Indonesian — make sure <b>Speech</b> is ticked — then restart the browser and OBS.',
        'Windows tidak menyertakan suara Indonesia. Untuk menambahkannya: Settings, Time &amp; language, Language &amp; region, Add a language, Indonesian — pastikan <b>Speech</b> tercentang — lalu restart browser dan OBS.') },
      { type: 'p', text: T(
        'Every engine mangles a racing name eventually. The <b>How to say a name</b> box takes one per line, written = spoken, and applies everywhere that name is read out.',
        'Tiap mesin suara pada akhirnya merusak nama balap. Kotak <b>Cara melafalkan nama</b> menerima satu per baris, tertulis = terucap, dan berlaku di mana pun nama itu diucapkan.') }
    ]
  },

  // ---------------------------------------------------------------- report
  {
    id: 'report',
    title: T('The race report', 'Laporan balapan'),
    blocks: [
      { type: 'p', text: T(
        'One page for the people who were not watching: winner and margin, fastest lap, every steward decision with its reason, who gained the most places, and where the championship stands with this round counted.',
        'Satu halaman untuk orang yang tidak menonton: pemenang dan selisihnya, lap tercepat, tiap keputusan steward beserta alasannya, siapa yang naik paling banyak, dan posisi championship dengan ronde ini dihitung.') },
      { type: 'p', text: T(
        'It needs no login, so the link can go straight into your league channel. <b>Copy for Discord</b> on the page hands you the text rather than a screenshot, which means a driver can search for their own name in that channel six weeks later.',
        'Tidak perlu login, jadi tautannya bisa langsung masuk ke channel ligamu. <b>Salin untuk Discord</b> di halaman itu memberi teksnya, bukan tangkapan layar — artinya seorang pembalap bisa mencari namanya sendiri di channel itu enam minggu kemudian.') },
      { type: 'p', text: T(
        'The address is on the <b>Championship</b> page here, and on every event card on the dashboard.',
        'Alamatnya ada di halaman <b>Championship</b> di sini, dan di tiap kartu event di dashboard.') },
      { type: 'note', text: T(
        'Two things it will not do. It names no biggest mover when no starting grid was set — there is no honest way to know who gained. And it labels itself <b>provisional</b> until the race is flagged finished, so nobody pastes a result that is still moving.',
        'Dua hal yang tidak akan dilakukannya. Dia tidak menyebut biggest mover kalau grid start tidak diatur — tidak ada cara jujur untuk tahu siapa yang naik. Dan dia menandai dirinya <b>provisional</b> sampai balapan diberi bendera selesai, supaya tidak ada yang menempel hasil yang masih bergerak.') }
    ]
  },

  // ---------------------------------------------------------------- OBS
  {
    id: 'obs',
    title: T('OBS setup', 'Setup OBS'),
    blocks: [
      {
        type: 'steps',
        items: [
          T('Source <b>Window Capture</b> → the window showing the game. That is the gameplay.',
            'Source <b>Window Capture</b> → window yang menampilkan game. Itu gameplay-nya.'),
          T('Source <b>Browser</b> → the all-in-one overlay address, 1920×1080, transparent background.',
            'Source <b>Browser</b> → alamat overlay semua-dalam-satu, 1920×1080, latar transparan.'),
          T('In the browser source properties, leave <b>Shutdown source when not visible</b> and <b>Refresh browser when scene becomes active</b> both off — the overlay reconnects on its own.',
            'Di properti browser source, biarkan <b>Shutdown source when not visible</b> dan <b>Refresh browser when scene becomes active</b> sama-sama mati — overlay menyambung ulang sendiri.'),
          T('Custom CSS: leave it empty. The pages are already transparent.',
            'Custom CSS: biarkan kosong. Halamannya memang sudah transparan.'),
          T('Keep this operator tab open on a second monitor.',
            'Biarkan tab operator ini terbuka di monitor kedua.')
        ]
      },
      { type: 'note', text: T(
        'One Browser Source carries every widget. Adding a source per widget costs a whole extra browser process for OBS to composite each time.',
        'Satu Browser Source membawa semua widget. Menambah satu source per widget menghabiskan satu proses browser penuh yang harus digabung OBS tiap kalinya.') }
    ]
  },

  // ---------------------------------------------------------------- championship & drift
  {
    id: 'championship',
    title: T('Championship and drift', 'Championship dan drift'),
    blocks: [
      { type: 'p', text: T(
        'Each round is banked as a scored snapshot, so editing the roster later never rewrites what somebody won months ago.',
        'Tiap ronde disimpan sebagai cuplikan yang sudah diskor, jadi mengubah daftar pembalap nanti tidak pernah menulis ulang apa yang seseorang menangkan berbulan-bulan lalu.') },
      { type: 'p', text: T(
        'Set the points table yourself, with optional bonuses for fastest lap and pole and an optional drop-worst rule. Ties are settled by countback — most wins, then most seconds, and so on — because a championship that ends in a shrug is worse than one decided by a rule nobody likes.',
        'Atur tabel poinnya sendiri, dengan bonus opsional untuk lap tercepat dan pole, serta aturan buang-hasil-terburuk yang opsional. Nilai seri diselesaikan lewat countback — paling banyak menang, lalu paling banyak posisi kedua, dan seterusnya — karena championship yang berakhir tanpa kejelasan lebih buruk daripada yang diputuskan aturan yang tidak disukai siapa pun.') },
      { type: 'h', text: T('Drift', 'Drift') },
      { type: 'p', text: T(
        'Judged qualifying runs seed the bracket, then two runs per battle with the lead swapped, and the judges call it. Empty seats become byes, so eleven entries fit a sixteen-car bracket without inventing drivers.',
        'Run kualifikasi yang dinilai menentukan unggulan bracket, lalu dua run per battle dengan posisi depan ditukar, dan juri yang memutuskan. Slot kosong jadi bye, jadi sebelas peserta muat di bracket enam belas tanpa mengarang pembalap.') },
      { type: 'note', text: T(
        'A drift session is judged, not timed, so nothing here predicts a winner from pace. The commentator knows that too and says nothing about probabilities in a drift event.',
        'Sesi drift dinilai juri, bukan diukur waktu, jadi tidak ada di sini yang memprediksi pemenang dari pace. Komentator juga tahu itu dan tidak berbicara soal peluang di event drift.') }
    ]
  },

  // ---------------------------------------------------------------- timing rules
  {
    id: 'timing',
    title: T('Timing rules', 'Aturan timing'),
    blocks: [
      { type: 'p', text: T(
        'One place decides the timing: the server on a local event, this console on a hosted one. The overlays and the detector only report events — they never decide.',
        'Satu tempat yang memutuskan timing: server di event lokal, konsol ini di event hosted. Overlay dan detektor hanya melaporkan kejadian — mereka tidak pernah memutuskan.') },
      {
        type: 'table',
        head: T(['Rule', 'What it means'], ['Aturan', 'Artinya']),
        rows: [
          [T('Lap time', 'Waktu lap'),
           T('The gap between two finish-line crossings. The first lap is timed from the green flag.',
             'Selisih antara dua crossing garis finis. Lap pertama dihitung dari bendera hijau.')],
          [T('Sectors', 'Sektor'),
           T('The gap between consecutive crossings. N sector lines give N+1 sectors.',
             'Selisih antar crossing berurutan. N garis sektor menghasilkan N+1 sektor.')],
          [T('Order enforced', 'Urutan dipaksa'),
           T('Sector 2 is refused before sector 1 has been passed.',
             'Sektor 2 ditolak kalau sektor 1 belum dilewati.')],
          [T('Debounce', 'Debounce'),
           T('A crossing sooner than <b>Min lap</b> is ignored. The manual + Lap button ignores the rule.',
             'Crossing yang lebih cepat dari <b>Lap minimum</b> diabaikan. Tombol + Lap manual mengabaikan aturan ini.')],
          [T('Gap', 'Gap'),
           T('To the leader. A car a lap behind reads as "+1 LAP" rather than as a number of seconds.',
             'Ke pemimpin. Mobil yang tertinggal satu lap terbaca "+1 LAP", bukan sekian detik.')],
          [T('Interval', 'Interval'),
           T('To the car directly ahead.', 'Ke mobil tepat di depannya.')],
          [T('Penalties', 'Penalti'),
           T('Added to total time, so they move gaps and positions immediately.',
             'Ditambahkan ke waktu total, jadi langsung menggeser gap dan posisi.')],
          [T('Red flag', 'Bendera merah'),
           T('The clock stops, and the pause is subtracted from race time when it goes green again.',
             'Jam berhenti, dan jedanya dikurangkan dari waktu balapan saat hijau lagi.')]
        ]
      },
      { type: 'note', text: T(
        'A manual lap and a detected lap come in through the same door, so the two cannot possibly be treated differently.',
        'Lap manual dan lap hasil deteksi masuk lewat pintu yang sama, jadi keduanya tidak mungkin diperlakukan berbeda.') }
    ]
  },

  // ---------------------------------------------------------------- hotkeys
  {
    id: 'hotkeys',
    title: T('Hotkeys', 'Hotkey'),
    blocks: [
      { type: 'p', text: T(
        'Active whenever the focus is not inside a text field.',
        'Aktif selama fokus tidak sedang di dalam kolom isian.') },
      {
        type: 'table',
        head: T(['Key', 'Action'], ['Tombol', 'Aksi']),
        rows: [
          [T('<kbd>Space</kbd>', '<kbd>Space</kbd>'),
           T('Start the race if it has not started; after that, toggle green ↔ yellow.',
             'Start race kalau belum mulai; setelah itu, toggle hijau ↔ kuning.')],
          [T('<kbd>Q W E R T Y U I</kbd>', '<kbd>Q W E R T Y U I</kbd>'),
           T('Record a manual lap for P1 to P8 in the current classification order.',
             'Catat lap manual untuk P1 sampai P8 sesuai urutan klasemen saat itu.')],
          [T('<kbd>1</kbd>–<kbd>9</kbd>', '<kbd>1</kbd>–<kbd>9</kbd>'),
           T('Switch page.', 'Pindah halaman.')],
          [T('<kbd>←↑→↓</kbd>', '<kbd>←↑→↓</kbd>'),
           T('On the Layout page: nudge the selected widget.',
             'Di halaman Tata letak: geser widget yang terpilih.')],
          [T('<kbd>Ctrl</kbd>+<kbd>Z</kbd>', '<kbd>Ctrl</kbd>+<kbd>Z</kbd>'),
           T('Undo the last race-control action.', 'Membatalkan aksi race-control terakhir.')],
          [T('<kbd>M</kbd>', '<kbd>M</kbd>'),
           T('Drop a highlight marker (while recording markers).',
             'Menjatuhkan marker highlight (saat perekaman marker aktif).')]
        ]
      },
      { type: 'h', text: T('Custom shortcuts & Stream Deck', 'Pintasan custom & Stream Deck') },
      { type: 'p', text: T(
        'On the OBS setup page, Keyboard shortcuts lets you bind flags, Start, Undo, scene next/previous and any widget toggle to a key you choose. A Stream Deck’s Hotkey action sends the same keystroke to the console tab — so a Stream Deck button works with no plugin and no server: set the button to the key you picked here.',
        'Di halaman OBS setup, Keyboard shortcuts membiarkanmu mengikat bendera, Start, Undo, scene berikut/sebelumnya, dan toggle widget apa pun ke tombol pilihanmu. Aksi Hotkey di Stream Deck mengirim keystroke yang sama ke tab konsol — jadi tombol Stream Deck jalan tanpa plugin dan tanpa server: set tombolnya ke tombol yang kamu pilih di sini.') },
      { type: 'note', text: T(
        'The manual lap keys are a safety net. If detection misses one you can correct it without stopping the broadcast, and every action has an Undo.',
        'Tombol lap manual adalah jaring pengaman. Kalau deteksi meleset, kamu bisa mengoreksinya tanpa menghentikan siaran — dan tiap aksi punya Undo.') }
    ]
  },

  // ---------------------------------------------------------------- trouble
  {
    id: 'trouble',
    title: T('If something is wrong', 'Kalau ada masalah'),
    blocks: [
      {
        type: 'table',
        head: T(['Symptom', 'Cause and fix'], ['Gejala', 'Penyebab dan solusinya']),
        rows: [
          [T('The overlay in OBS is blank', 'Overlay di OBS kosong'),
           T('For a hosted event, the address needs <code>?event=CODE</code> on it. Without one the page looks for a server on the streaming machine, which is not there. Copy the address from the OBS setup page rather than typing it.',
             'Untuk event hosted, alamatnya wajib membawa <code>?event=KODE</code>. Tanpa itu, halamannya mencari server di mesin streaming yang memang tidak ada. Salin alamatnya dari halaman Setup OBS, jangan diketik manual.')],
          [T('Nothing updates any more', 'Tidak ada yang berubah lagi'),
           T('In a hosted event, race control is the timing computer. If you closed that tab, nothing is working the race out. Open it again — the event itself is safe in the database.',
             'Di event hosted, race control adalah komputer timing-nya. Kalau tabnya kamu tutup, tidak ada yang menghitung balapan. Buka lagi — event-nya sendiri aman di database.')],
          [T('A driver signed in but gets no flags', 'Pembalap sudah mendaftar tapi tidak dapat bendera'),
           T('They are waiting for you. Accept them in <b>Driver sign-ins</b>; the app tells them that is what is happening.',
             'Mereka sedang menunggumu. Terima di <b>Pendaftaran pembalap</b>; aplikasinya sudah memberi tahu bahwa itulah yang sedang terjadi.')],
          [T('The app says that is the website address', 'Aplikasi bilang itu alamat website'),
           T('It is. The app wants the event code — four to twelve letters — not the site the APK came from. A link with <code>?event=</code> in it works too.',
             'Memang begitu. Aplikasi meminta kode event — empat sampai dua belas huruf — bukan situs tempat APK-nya diunduh. Tautan yang mengandung <code>?event=</code> juga bisa.')],
          [T('Cars swap with each other', 'Mobil tertukar satu sama lain'),
           T('Two driver colours are too close. Change one, or lower <b>Colour tolerance</b> so a pixel has to match more exactly.',
             'Dua warna pembalap terlalu mirip. Ganti salah satunya, atau turunkan <b>Toleransi warna</b> supaya piksel harus lebih persis cocok.')],
          [T('Laps are not counted', 'Lap tidak terhitung'),
           T('Check detection is running and a finish line is drawn. Check the line is no longer <i>learning direction</i>. If the lap is genuinely very short, lower <b>Min lap</b>.',
             'Pastikan deteksi berjalan dan garis finis sudah digambar. Pastikan garisnya sudah tidak berstatus <i>learning direction</i>. Kalau lapnya memang sangat pendek, turunkan <b>Lap minimum</b>.')],
          [T('The commentator is silent in OBS', 'Komentator diam di OBS'),
           T('Its Browser Source needs <b>Control audio via OBS</b> ticked. That is the cause nine times out of ten. Test it in Chrome first to be sure the voice itself works.',
             'Browser Source-nya butuh <b>Control audio via OBS</b> dicentang. Itu penyebabnya sembilan dari sepuluh kali. Coba dulu di Chrome untuk memastikan suaranya sendiri berfungsi.')],
          [T('The overlay does not change in OBS', 'Overlay tidak berubah di OBS'),
           T('Right-click the source → Properties → <b>Refresh cache of current page</b>. Check the address is right and, for a local event, that the server is still running.',
             'Klik kanan source → Properties → <b>Refresh cache of current page</b>. Periksa alamatnya benar dan, untuk event lokal, servernya masih jalan.')],
          [T('The overlay looks frozen', 'Overlay terlihat diam'),
           T('Most overlay motion is event-driven — a position swap, a lap landing, a flag change. With the race idle there is nothing to animate. Use <b>Overlays → Play animation rehearsal</b> to prove motion is reaching OBS.',
             'Sebagian besar animasi overlay digerakkan kejadian — tukar posisi, lap masuk, ganti bendera. Kalau balapan siaga, tidak ada yang perlu dianimasikan. Pakai <b>Overlay → Putar gladi animasi</b> untuk membuktikan animasinya sampai ke OBS.')]
        ]
      }
    ]
  },

  // ---------------------------------------------------------------- files
  {
    id: 'files',
    title: T('Where things are kept', 'Di mana semuanya disimpan'),
    blocks: [
      {
        type: 'table',
        head: T(['Where', 'What'], ['Di mana', 'Apa']),
        rows: [
          [T('The event, hosted', 'Event, hosted'),
           T('Postgres. The grid, flags, penalties, the layout and every setting. Closing the console does not lose it; another machine can open the same event and carry on.',
             'Postgres. Grid, bendera, penalti, tata letak, dan semua pengaturan. Menutup konsol tidak menghilangkannya; mesin lain bisa membuka event yang sama dan melanjutkan.')],
          [T('The event, local', 'Event, lokal'),
           T('<code>data/state.json</code>, written as it happens. Back it up before an event that matters.',
             '<code>data/state.json</code>, ditulis sambil jalan. Cadangkan sebelum event yang penting.')],
          [T('Driver accounts', 'Akun pembalap'),
           T('Never in the state. Passwords are hashed and live where nothing else can reach them — not in any file the overlays or the network can read.',
             'Tidak pernah ada di dalam state. Kata sandi di-hash dan disimpan di tempat yang tidak bisa dijangkau apa pun — tidak di file mana pun yang bisa dibaca overlay atau jaringan.')],
          [T('Detection model', 'Model deteksi'),
           T('<code>public/models/</code>, if you use model-based detection at all. Optional.',
             '<code>public/models/</code>, kalau kamu memang memakai deteksi berbasis model. Opsional.')]
        ]
      },
      { type: 'note', text: T(
        'One lap of per-driver history — the individual lap times — lives only in the console tab and is not written to the database. Close race control mid-race and reopen it and the classification is intact, but the commentator needs a few laps before it will quote a probability again.',
        'Riwayat per pembalap — daftar waktu tiap lap — hanya hidup di tab konsol dan tidak ditulis ke database. Tutup race control di tengah balapan lalu buka lagi: klasemennya utuh, tapi komentator butuh beberapa lap sebelum mau menyebut angka peluang lagi.') }
    ]
  }
];

/**
 * The manual in one language.
 *
 * @param {string} lang  'en' or 'id'
 */
export function help(lang) {
  const l = lang === 'id' ? 'id' : 'en';
  return SECTIONS.map((s) => ({
    id: s.id,
    title: pick(s.title, l),
    blocks: s.blocks.map((b) => ({
      type: b.type,
      text: pick(b.text, l),
      items: b.items ? pick(b.items, l) : undefined,
      head: b.head ? pick(b.head, l) : undefined,
      rows: b.rows ? pick(b.rows, l) : undefined
    }))
  }));
}
