# TADZKIR — Pengingat tugas, agar tidak terlupa.

Aplikasi web frontend-only (HTML, CSS, JavaScript Vanilla). Data disimpan di LocalStorage browser.

## Menjalankan
Service worker & PWA butuh `http://localhost` atau HTTPS (bukan `file://`):
```
cd tadzkir
python3 -m http.server 8080     # lalu buka http://localhost:8080
```
Membuka `index.html` langsung juga bisa, tetapi tanpa PWA/offline.

## Reminder
Pengingat dihitung dari deadline: `deadline − k × interval`. Nada notifikasi bisa diganti dengan audio sendiri (Pengaturan, maks 1 MB; hanya berbunyi saat aplikasi terbuka). Fitur v2: tugas berulang, prioritas, kategori, subtugas, undo hapus, snooze, suara, export .ics, urut manual (seret, desktop), dan pengingat backup 14 hari.
dan juga saat aplikasi dibuka kembali (pengingat yang terlewat langsung ditampilkan). Notifikasi background
saat browser tertutup TIDAK dijamin tanpa backend/Push server.

## Deploy
- GitHub Pages: push ke repo → Settings → Pages → pilih branch `main` / root.
- Netlify: drag & drop folder `tadzkir` di app.netlify.com/drop.
- Vercel: `npx vercel` di folder project (framework: Other, tanpa build).
