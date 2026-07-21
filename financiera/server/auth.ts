import "server-only";

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db, dbReady } from "./db";
import { Session } from "./db/schema";

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = "financiera_session";
const SESSION_TTL_DAYS = 30;

// --- Password hashing (scrypt nativo de node, sin deps) ---
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16).toString("hex");
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	return `${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const [salt, key] = stored.split(":");
	if (!salt || !key) return false;
	const derived = (await scryptAsync(password, salt, 64)) as Buffer;
	const keyBuf = Buffer.from(key, "hex");
	return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}

// --- Sesiones ---
export async function createSession(userId: string): Promise<string> {
	await dbReady;
	const token = randomUUID() + randomUUID();
	const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
	await db.insert(Session).values({ token, userId, expiresAt });
	const store = await cookies();
	store.set(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		expires: expiresAt,
	});
	return token;
}

export async function destroySession(): Promise<void> {
	const store = await cookies();
	const token = store.get(SESSION_COOKIE)?.value;
	if (token) {
		await dbReady;
		await db.delete(Session).where(eq(Session.token, token));
	}
	store.delete(SESSION_COOKIE);
}

/** Devuelve el usuario logueado (o null) leyendo la cookie de sesión. */
export async function getSessionUser() {
	const store = await cookies();
	const token = store.get(SESSION_COOKIE)?.value;
	if (!token) return null;

	await dbReady;
	const session = await db.query.Session.findFirst({
		where: eq(Session.token, token),
		with: { user: true },
	});
	if (!session || session.expiresAt.getTime() < Date.now()) return null;
	return session.user;
}
