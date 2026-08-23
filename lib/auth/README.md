# Autentikasi akun tunggal sementara

Implementasi ini adalah pengamanan sementara untuk satu akun server-side. Password disimpan sebagai PBKDF2-HMAC-SHA256 dan session ditandatangani HMAC-SHA256 dengan masa berlaku absolut 60 menit.

Session bersifat stateless. Logout hanya menghapus cookie browser aktif; token yang telah dicuri tidak dapat dicabut secara terpusat sebelum kedaluwarsa karena belum ada database atau session store.

Pembatas percobaan login menggunakan memory proses dengan ukuran dan waktu hidup terbatas. Pada Vercel serverless, memory tidak dibagi secara global antar-instance. Jika mode akun tunggal dipakai lebih lama, limiter harus diganti dengan provider atau central store.

Identitas klien hanya mempercayai `x-vercel-forwarded-for` ketika `VERCEL=1`. Pada reverse proxy Debian/Nginx, set `MAWAR_AUTH_TRUST_PROXY=1` hanya jika Nginx menghapus header forwarding dari klien dan selalu menulis ulang `X-Forwarded-For` dari alamat koneksi tepercaya. Tanpa konfigurasi eksplisit, header forwarding diabaikan dan bucket `unknown` digunakan.

## Credential environment

Password asli hanya disimpan pengguna di password manager atau catatan terenkripsi. Password tidak dapat dipulihkan dari hash PBKDF2.

Generator menampilkan dua format dari credential yang sama. Pada `.env.local` Next.js, karakter `$` pada hash ditulis sebagai `\$`; helper formatter hanya mengubah representasi dotenv, bukan byte hash. Vercel Dashboard dan direct environment memakai `$` biasa—jangan menyalin backslash dari blok lokal ke Vercel. Nilai environment lokal memerlukan restart/rebuild agar terbaca, sedangkan perubahan environment Vercel baru berlaku pada deployment berikutnya.

Jangan menyimpan password plaintext pada file environment.

Implementasi ini bukan SSO dan bukan sistem multi-user final.
