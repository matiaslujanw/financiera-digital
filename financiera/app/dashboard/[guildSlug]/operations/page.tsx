import type { Metadata } from "next";

import { OperationsWorkspace } from "~/components/dashboard/operations-workspace";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

export const metadata: Metadata = { title: "Operaciones" };

export default async function OperationsPage(props: {
	params: Promise<{ guildSlug: string }>;
}) {
	const { guildSlug } = await props.params;
	await prefetch(
		trpc.operation.byGuildSlug.infiniteQueryOptions(
			{ guildSlug, limit: 25 },
			{ getNextPageParam: (last) => last.nextCursor ?? undefined },
		),
	);

	return (
		<HydrateClient>
			<OperationsWorkspace guildSlug={guildSlug} />
		</HydrateClient>
	);
}
