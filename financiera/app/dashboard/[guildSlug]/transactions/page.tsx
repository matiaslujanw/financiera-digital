import type { Metadata } from "next";

import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { AccountsSummary } from "~/components/dashboard/accounts-summary";
import { TransactionsTable } from "~/components/dashboard/transactions-table";

export const metadata: Metadata = { title: "Transacciones" };

export default async function TransactionsPage(props: {
	params: Promise<{ guildSlug: string }>;
}) {
	const { guildSlug } = await props.params;

	prefetch(trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug }));
	prefetch(trpc.transaction.countByGuildSlug.queryOptions({ guildSlug }));

	return (
		<HydrateClient>
			<div className="flex h-full min-h-0 gap-4 p-4">
				<AccountsSummary guildSlug={guildSlug} />
				<div className="min-h-0 flex-1">
					<TransactionsTable guildSlug={guildSlug} />
				</div>
			</div>
		</HydrateClient>
	);
}
