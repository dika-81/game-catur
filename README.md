# Chess AI · PGSD UPI Serang

Permainan catur melawan Stockfish 18 yang berjalan sepenuhnya di browser. Aplikasi ini hanya menggunakan HTML, CSS, JavaScript, dan WebAssembly—tidak memerlukan Flask, Python, executable Windows, database, atau API eksternal.

## Fitur

- Pemain putih melawan Stockfish WebAssembly
- Empat level kesulitan (depth 2, 4, 6, dan 9)
- Validasi langkah lengkap, termasuk rokade, en passant, dan pilihan promosi
- Sorotan bidak terpilih, target legal, langkah terakhir, dan raja yang sedang diskak
- Timer 10 menit untuk kedua pihak
- Evaluasi posisi Stockfish setiap lima detik
- Riwayat langkah, suara langkah, status skakmat/stalemate/remis, dan mulai ulang
- Sesi tiap tab tersimpan di `sessionStorage`
- Tata letak responsif untuk desktop dan ponsel

## Menjalankan secara lokal

Browser melarang pemuatan WebAssembly Worker dari `file://`, jadi gunakan server statis apa pun. Contoh:

```powershell
python -m http.server 8000
```

Kemudian buka `http://localhost:8000`.

## Mempublikasikan ke GitHub Pages

1. Unggah seluruh isi folder ini ke branch utama repositori GitHub.
2. Buka **Settings → Pages**.
3. Pada **Build and deployment**, pilih **Deploy from a branch**.
4. Pilih branch utama dan folder **/(root)**, lalu simpan.

Semua URL aset bersifat relatif sehingga situs tetap bekerja pada alamat proyek seperti `https://nama.github.io/nama-repo/`.

## Pengujian

```powershell
npm test
```

Pengujian mencakup aturan langkah, rokade, en passant, promosi, skakmat, stalemate, format timer, path GitHub Pages, dan validitas berkas WebAssembly.

## Lisensi pihak ketiga

- Stockfish.js / Stockfish 18: GPL-3.0. Lihat [`licenses/STOCKFISH-GPL-3.0.txt`](licenses/STOCKFISH-GPL-3.0.txt). Sumber: <https://github.com/nmrugg/stockfish.js> dan <https://github.com/official-stockfish/Stockfish>.
- chess.js 1.4.0: BSD-2-Clause. Lihat [`licenses/CHESSJS-BSD-2-CLAUSE.txt`](licenses/CHESSJS-BSD-2-CLAUSE.txt).
