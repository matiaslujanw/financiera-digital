import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getSessionUser } from "~/server/auth";
import { db } from "~/server/db";
import { Member } from "~/server/db/schema";

export default async function Home() {
	const user = await getSessionUser();
	if (!user) redirect("/login");

	const member = await db.query.Member.findFirst({
		where: eq(Member.userId, user.id),
		orderBy: (m, { asc }) => [asc(m.createdAt)],
	});
	if (!member) redirect("/login");

	redirect(`/dashboard/${member.guildSlug}/transactions`);
}
