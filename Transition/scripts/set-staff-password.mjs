#!/usr/bin/env node
// Set (or reset) a staff member's sign-in password from your own machine.
// Needed for the Main Admin (wmt@…), whose password can't be set from the
// website, and handy for any account you need to fix by hand.
//
//   node scripts/set-staff-password.mjs wmt@ececontactcenters.com
//
// You'll be asked for the password twice (typing is hidden). Uses
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and
// AUTH_PASSWORD_PEPPER from .env.local — the SAME pepper the live site uses.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
for (const line of fs.readFileSync(path.join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const { _internal } = await import(pathToFileURL(path.join(here, "..", "..", "api", "auth.js")).href);

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(prompt); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const email = String(process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/set-staff-password.mjs <email>");
  process.exit(1);
}
const E = _internal.env();
const staff = await _internal.getStaff(E, email);
if (!staff) {
  console.error(`No staff member with email ${email}.`);
  process.exit(1);
}
const pw = await askHidden(`New password for ${staff.name} (${email}): `);
const again = await askHidden("Type it again: ");
if (pw !== again) { console.error("Passwords don't match — nothing changed."); process.exit(1); }
if (pw.length < 8) { console.error("Use at least 8 characters for this one."); process.exit(1); }
await _internal.upsertAuthUser(E, staff, email, pw);
await _internal.log(E, "PASSWORD_SET_BY_SCRIPT", "server", email, "Password set with scripts/set-staff-password.mjs.");
console.log(`✓ Password set for ${email}. Sign in at the website with it.`);
