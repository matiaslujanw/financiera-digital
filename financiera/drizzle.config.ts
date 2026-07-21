import type { Config } from "drizzle-kit";

export default {
	schema: ["./server/db/schema.ts", "./server/db/auth.ts"],
	out: "./drizzle",
	dialect: "postgresql",
} satisfies Config;
