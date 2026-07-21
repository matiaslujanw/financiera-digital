import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getSessionUser } from "~/server/auth";
import { db } from "~/server/db";
import { Member } from "~/server/db/schema";
import { LogoutButton } from "~/components/auth/logout-button";
import { Badge } from "~/components/ui/badge";
import {
	DashboardMobileNav,
	DashboardSidebar,
} from "~/components/dashboard/dashboard-sidebar";

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
		<div className="flex min-h-screen flex-1">
			<DashboardSidebar
				guildSlug={guildSlug}
				guildName={member.guild.name}
			/>
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="bg-background/95 sticky top-0 z-30 flex h-16 items-center justify-between border-b px-4 backdrop-blur sm:px-6">
					<div className="flex min-w-0 items-center gap-3">
						<DashboardMobileNav guildSlug={guildSlug} />
						<span className="truncate font-semibold md:hidden">
							{member.guild.name}
						</span>
						<Badge variant="secondary" className="hidden sm:inline-flex">
							{member.role}
						</Badge>
					</div>
					<div className="flex items-center gap-3">
						<span className="text-muted-foreground hidden text-sm sm:inline">
							{user.firstname ?? user.email}
						</span>
						<LogoutButton />
					</div>
				</header>
				<main className="min-h-0 flex-1">{props.children}</main>
			</div>
		</div>
	);
}
