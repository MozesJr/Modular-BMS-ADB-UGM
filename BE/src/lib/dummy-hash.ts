// Hash bcrypt (cost 12) dari string acak yang dibuang: dipakai agar verifikasi kredensial untuk email yang
// TIDAK terdaftar menghabiskan waktu yang sama dengan email terdaftar (mencegah enumerasi lewat waktu respons).
// Bukan secret; tidak cocok dengan password siapa pun.
export const DUMMY_PASSWORD_HASH =
  "$2a$12$iMJFywEjbRKV.YS7h1U0P.OA8I4glHgIaPAsr.9k3rZVVSqVCFpyu";
