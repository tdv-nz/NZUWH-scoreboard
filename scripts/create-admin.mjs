import { createHash, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Usage: printf "%s\\n" "$NZUWH_ADMIN_PASSWORD" | node scripts/create-admin.mjs organiser@example.com');
  process.exit(1);
}
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const password = raw.replace(/\r?\n$/, '');
if (password.length < 12 || password.length > 256) {
  console.error('Password must be 12–256 characters.');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 220_000, 32, 'sha512').toString('hex');
const sql = `INSERT INTO organisers (id,email,role,password_salt,password_hash,password_iterations) VALUES ('${randomUUID()}','${email.replaceAll("'", "''")}','admin','${salt}','${hash}',220000);\n`;
const file = await open('.admin-bootstrap.sql', 'wx', 0o600).catch(error => {
  if (error.code === 'EEXIST') throw new Error('Remove the existing .admin-bootstrap.sql after using it, then run this command again.');
  throw error;
});
try { await file.writeFile(sql); } finally { await file.close(); }
console.log('Created .admin-bootstrap.sql. Apply it with Wrangler, then delete this file.');
