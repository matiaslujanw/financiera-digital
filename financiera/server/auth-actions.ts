"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db, dbReady } from "./db";
import { AuthUsers } from "./db/auth";
import { Member, User } from "./db/schema";
import { createSession, destroySession, hashPassword, verifyPassword } from "./auth";
import { bootstrapGuild } from "./bootstrap";

export interface AuthState {
	error?: string;
}

const registerSchema = z.object({
	name: z.string().trim().min(1, "Ingresá tu nombre"),
	email: z.string().trim().toLowerCase().email("Email inválido"),
	password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
	guildName: z.string().trim().min(1, "Ingresá el nombre del negocio"),
});

async function firstGuildSlug(userId: string): Promise<string | null> {
	const member = await db.query.Member.findFirst({
		where: eq(Member.userId, userId),
		with: { guild: true },
		orderBy: (m, { asc }) => [asc(m.createdAt)],
	});
	return member?.guildSlug ?? null;
}

export async function registerAction(
	_prev: AuthState,
	formData: FormData,
): Promise<AuthState> {
	await dbReady;

	const parsed = registerSchema.safeParse({
		name: formData.get("name"),
		email: formData.get("email"),
		password: formData.get("password"),
		guildName: formData.get("guildName"),
	});
	if (!parsed.success) {
		return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
	}
	const { name, email, password, guildName } = parsed.data;

	const existing = await db.query.AuthUsers.findFirst({
		where: eq(AuthUsers.email, email),
	});
	if (existing) return { error: "Ya existe una cuenta con ese email" };

	const passwordHash = await hashPassword(password);
	const [authUser] = await db
		.insert(AuthUsers)
		.values({ email, passwordHash })
		.returning();
	await db.insert(User).values({ id: authUser!.id, email, firstname: name });

	const { guildSlug } = await bootstrapGuild({ userId: authUser!.id, guildName });
	await createSession(authUser!.id);

	redirect(`/dashboard/${guildSlug}/transactions`);
}

const loginSchema = z.object({
	email: z.string().trim().toLowerCase().email("Email inválido"),
	password: z.string().min(1, "Ingresá tu contraseña"),
});

export async function loginAction(
	_prev: AuthState,
	formData: FormData,
): Promise<AuthState> {
	await dbReady;

	const parsed = loginSchema.safeParse({
		email: formData.get("email"),
		password: formData.get("password"),
	});
	if (!parsed.success) {
		return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
	}
	const { email, password } = parsed.data;

	const authUser = await db.query.AuthUsers.findFirst({
		where: eq(AuthUsers.email, email),
	});
	if (!authUser || !(await verifyPassword(password, authUser.passwordHash))) {
		return { error: "Email o contraseña incorrectos" };
	}

	await createSession(authUser.id);
	const guildSlug = await firstGuildSlug(authUser.id);
	redirect(guildSlug ? `/dashboard/${guildSlug}/transactions` : "/");
}

export async function logoutAction(): Promise<void> {
	await destroySession();
	redirect("/login");
}
