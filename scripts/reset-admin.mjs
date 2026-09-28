import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Usage: printf "%s\\n" "$NZUWH_ADMIN_PASSWORD" | node scripts/reset-admin.mjs admin@example.com');
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
const sqlEmail = email.replaceAll("'", "''");
const sql = `DELETE FROM sessions WHERE organiser_id = (SELECT id FROM organisers WHERE email = '${sqlEmail}' AND role = 'admin');
UPDATE organisers SET password_salt = '${salt}', password_hash = '${hash}', password_iterations = 220000,
  failed_logins = 0, locked_until = NULL WHERE email = '${sqlEmail}' AND role = 'admin';
SELECT changes() AS reset_admin_count;
`;

const file = await open('.admin-reset.sql', 'wx', 0o600).catch(error => {
  if (error.code === 'EEXIST') throw new Error('Remove the existing .admin-reset.sql after using it, then run this command again.');
  throw error;
});
try { await file.writeFile(sql); } finally { await file.close(); }
console.log('Created .admin-reset.sql. Apply it with Wrangler, check reset_admin_count is 1, then delete this file.');
