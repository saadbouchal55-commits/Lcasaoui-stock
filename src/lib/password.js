// Password hashing. bcryptjs (pure JS) is used deliberately: no native build
// step, so it installs cleanly on Hostinger shared hosting.
import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
