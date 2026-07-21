// Reemplazo local del `auth.users` de Supabase.
// En el proyecto original, User.id referenciaba a la tabla de Supabase Auth.
// Acá manejamos las credenciales nosotros mismos en esta tabla.

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const AuthUsers = pgTable("authUser", {
	id: uuid("id").notNull().primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	passwordHash: text("passwordHash").notNull(),
	createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuthUserSchema = typeof AuthUsers.$inferSelect;
