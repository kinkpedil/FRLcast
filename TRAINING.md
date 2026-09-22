# Melatih model deteksi untuk FR Legends

Opsional. Minimap tracking + trigger zone di panel sudah bisa menghitung lap dan posisi
tanpa model apa pun. Model dipakai kalau kamu mau deteksi objek yang lebih tahan terhadap
perubahan kamera — misal mendeteksi mobil dari view belakang, atau mengenali garis finish
tanpa harus capture patch referensi tiap ganti map.

Target akhir: satu file `public/models/frlegends.onnx` + `public/models/frlegends.labels.json`.

---

## 1. Kumpulkan data

Rekam gameplay sesuai kondisi siaran sebenarnya — resolusi sama, map sama, jumlah mobil sama.

```bash
# potong video jadi frame, 2 frame per detik sudah cukup
ffmpeg -i rekaman.mp4 -vf fps=2 dataset/raw/frame_%05d.jpg
```

Target minimum yang realistis:

| Kelas | Jumlah frame berlabel |
|---|---|
| `car` | 800–1500 |
| `finish_line` | 300–600 |
| `hud_lap` / `hud_time` | 200–400 |

Variasikan: siang/malam, map berbeda, mobil berbeda, kamera dekat/jauh, ada asap drift.
Model yang cuma dilatih di satu map akan gagal di map lain.

## 2. Labeli

Pakai [Label Studio](https://labelstud.io/), [CVAT](https://www.cvat.ai/), atau Roboflow.
Export dalam format **YOLO**.

Saran daftar kelas — kecil dan konsisten lebih baik daripada banyak dan berantakan:

```json
["car", "player_car", "finish_line", "minimap_dot", "hud_lap", "hud_time"]
```

Simpan file itu nanti sebagai `frlegends.labels.json`. **Urutannya harus sama persis
dengan urutan kelas saat training** — indeks kelas dari model dipetakan ke array ini.

## 3. Latih

```bash
pip install ultralytics
```

`data.yaml`:

```yaml
path: ./dataset
train: images/train
val: images/val
names:
  0: car
  1: player_car
  2: finish_line
  3: minimap_dot
  4: hud_lap
  5: hud_time
```

```bash
yolo detect train model=yolov8n.pt data=data.yaml epochs=120 imgsz=640 batch=16
```

Pakai `yolov8n` (nano). Model ini jalan di WASM di dalam browser — model besar akan
membuat FPS deteksi anjlok saat kamu juga sedang streaming.

Cek hasil di `runs/detect/train/results.png`. Kalau mAP50 di bawah ~0.7, tambah data
sebelum lanjut; jangan tambal dengan menurunkan threshold.

## 4. Export ke ONNX

```bash
yolo export model=runs/detect/train/weights/best.pt format=onnx opset=12 imgsz=640 simplify=True
```

Salin hasilnya:

```
public/models/frlegends.onnx
public/models/frlegends.labels.json
```

## 5. Pakai di panel

Halaman **Vision / AI** → **Load model**. Kotak deteksi muncul di preview.
`onnxruntime-web` diambil dari CDN sekali (butuh internet saat pertama load model).

Runner-nya ada di [`public/js/detector.js`](public/js/detector.js): preprocessing letterbox,
decode head YOLOv8 `[1, 4+nc, 8400]`, lalu NMS. Kalau kamu pakai arsitektur dengan bentuk
output berbeda, sesuaikan `decode()` di file itu.

---

## Menyambungkan deteksi ke event lap

Secara default model hanya menggambar kotak di preview — sengaja, supaya kamu bisa mengukur
akurasinya dulu sebelum ia boleh menyentuh timing.

Kalau sudah yakin, sambungkan di `panel.js` pada tempat `modelBoxes` di-set. Pola yang masuk akal:

```js
// contoh: mobil pemain menyentuh garis finish -> catat lap
const line = modelBoxes.find((b) => b.label === 'finish_line');
const me = modelBoxes.find((b) => b.label === 'player_car');
if (line && me && overlaps(me, line)) {
  bus.action('lap.record', {
    driverId: state.overlay.focusDriverId,
    source: 'model',
    minLapMs: vision.settings.minLapMs   // debounce tetap dipakai
  });
}
```

Selalu lewat `lap.record` dengan `minLapMs`, jangan tulis lap langsung — server yang menolak
trigger dobel, dan itu yang menjaga timing tetap waras kalau model tiba-tiba noisy di tengah siaran.
