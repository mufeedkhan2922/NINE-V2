import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/trading/db";

const SESSION_COOKIE = "nine_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

type User = { id: string; email: string; role: string };

function hashPassword(password: string, salt: string): string { return scryptSync(password, salt, 64).toString("hex"); }
function passwordHash(password: string): string { const salt = randomBytes(16).toString("hex"); return `${salt}:${hashPassword(password, salt)}`; }
function verifyPassword(password: string, stored: string): boolean { const [salt, digest] = stored.split(":"); if (!salt || !digest) return false; const actual = Buffer.from(hashPassword(password, salt), "hex"); const expected = Buffer.from(digest, "hex"); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function ensureAdminUser(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  const email = (process.env.NINE_ADMIN_EMAIL || "admin@nine.local").trim().toLowerCase();
  const password = process.env.NINE_ADMIN_PASSWORD;
  if (!password) return;
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!existing) db.prepare("INSERT INTO users (id,email,password_hash,role,created_at,disabled) VALUES (?,?,?,?,?,0)").run(`USR-${randomBytes(8).toString("hex")}`, email, passwordHash(password), "ADMIN", Date.now());
}

function readCookie(request: Request): string | null {
  const header = request.headers.get("cookie") || "";
  const match = header.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null;
}

export function getCurrentUser(request: Request): User | null {
  ensureAdminUser();
  const token = readCookie(request);
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0`).get(tokenHash(token), Date.now()) as any;
  return row ? { id: row.id, email: row.email, role: row.role } : null;
}

export function requireUser(request: Request): User {
  const user = getCurrentUser(request);
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export function login(email: string, password: string): { user: User; token: string } | null {
  ensureAdminUser();
  const row = db.prepare("SELECT * FROM users WHERE email=? AND disabled=0").get(email.trim().toLowerCase()) as any;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)").run(`SES-${randomBytes(8).toString("hex")}`, row.id, tokenHash(token), Date.now(), Date.now() + SESSION_TTL_MS);
  return { user: { id: row.id, email: row.email, role: row.role }, token };
}

export function logout(request: Request): void {
  const token = readCookie(request);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeSeconds)}${secure}`;
}
export function clearSessionCookie(): string { const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""; return SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure; }


export function requireRole(
  request: Request,
  roles: string[],
): User {
  const user = requireUser(request);
  if (!roles.includes(user.role)) {
    throw new Error("FORBIDDEN");
  }
  return user;
}

export function requireAdmin(
  request: Request,
): User {
  return requireRole(request, ["ADMIN"]);
}
