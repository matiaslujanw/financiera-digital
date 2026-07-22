import type { Metadata } from "next";

import { AccountsSummary } from "~/components/dashboard/accounts-summary";
import { CreateTransactionInline } from "~/components/dashboard/create-transaction-inline";
import { TransactionsTable } from "~/components/dashboard/transactions-table";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

export const metadata: Metadata = { title: "Transacciones" };

export default async function TransactionsPage(props: {
	params: Promise<{ guildSlug: string }>;
}) {
	const { guildSlug } = await props.params;
	await prefetch(trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug }));
	await prefetch(trpc.transaction.countByGuildSlug.queryOptions({ guildSlug }));

	return (
		<HydrateClient>
			<div className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:p-6">
				<CreateTransactionInline guildSlug={guildSlug} />
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<TransactionsTable guildSlug={guildSlug} />
				</div>
				<AccountsSummary guildSlug={guildSlug} />
			</div>
		</HydrateClient>
	);
}
