import type { Metadata } from "next";

import { AccountsWorkspace } from "~/components/dashboard/accounts-workspace";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";

export const metadata: Metadata = { title: "Cuentas" };

export default async function AccountsPage(props: {
	params: Promise<{ guildSlug: string }>;
}) {
	const { guildSlug } = await props.params;
	await prefetch(trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug }));

	return (
		<HydrateClient>
			<AccountsWorkspace guildSlug={guildSlug} />
		</HydrateClient>
	);
}
