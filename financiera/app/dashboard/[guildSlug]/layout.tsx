import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getSessionUser } from "~/server/auth";
import { db } from "~/server/db";
import { Member } from "~/server/db/schema";
import { LogoutButton } from "~/components/auth/logout-button";
import { Badge } from "~/components/ui/badge";

export default async function GuildLayout(props: {
	children: React.ReactNode;
	params: Promise<{ guildSlug: string }>;
}) {
	const { guildSlug } = await props.params;

	const user = await getSessionUser();
	if (!user) redirect("/login");

	const member = await db.query.Member.findFirst({
		where: and(
			eq(Member.userId, user.id),
			eq(Member.guildSlug, guildSlug),
			eq(Member.discharged, true),
		),
		with: { guild: true },
	});
	if (!member?.guild) redirect("/");

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<header className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-3">
					<span className="text-lg font-semibold">{member.guild.name}</span>
					<Badge variant="secondary">{member.role}</Badge>
				</div>
				<div className="flex items-center gap-3">
					<span className="text-muted-foreground text-sm">
						{user.firstname ?? user.email}
					</span>
					<LogoutButton />
				</div>
			</header>
			<div className="min-h-0 flex-1">{props.children}</div>
		</div>
	);
}
