// Ruta: apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/page.tsx
import { Metadata } from "next";
import { CreateTransactionForm } from "../_components/transactions/create"; // Asumo que es la ruta correcta
import { TransactionsDataTable } from "./_components/data-table"; // Renombrado para claridad
import { GuildAccountSideNav } from "./_components/sidenav"; // Asumo que es la ruta correcta
import { prefetch, trpc } from "~/trpc/server";
import { ScrollArea } from "@acme/ui/scroll-area";
import { Suspense } from "react";
import { Icons } from "@acme/ui/icons";
import { CreateTransactionSkeleton } from "./_components/create-transaction-skeleton";
import { Skeleton } from "@acme/ui/skeleton";

export const metadata: Metadata = {
	title: 'Transacciones',
};

export default async function TransactionsPage(props: { params: Promise<{ guildSlug: string }> }) {
	const params = await props.params;

	// Prefetch otros datos necesarios
	void prefetch(trpc.dictionaryAccount.byGuildSlug.queryOptions({ guildSlug: params.guildSlug }));
	void prefetch(trpc.business.byGuildSlug.queryOptions({ guildSlug: params.guildSlug }));
	void prefetch(trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug: params.guildSlug }));
	// Nota: El prefetch para las transacciones de la tabla ya no es necesario aquí
	// si `TransactionsDataTable` usa `useInfiniteQuery`.

	return (
		<div className="flex flex-1 h-full w-full gap-2">
			<Suspense fallback={
				<Skeleton className="w-96 h-full" />
			}>
				<ScrollArea className="h-full rounded-lg bg-purple-500 border bg-background">
					<GuildAccountSideNav />
				</ScrollArea>
			</Suspense>
			<div className="flex h-full flex-1 w-full flex-col gap-2">
				<Suspense fallback={
					<Skeleton className="w-full h-40" />
				}>
					<CreateTransactionForm context="guild" />
				</Suspense>
				{/* Pasar guildSlug al DataTable */}
				<Suspense fallback={
					<Skeleton className="w-full h-full flex flex-1" />
				}>
					<TransactionsDataTable guildSlug={params.guildSlug} />
				</Suspense>
			</div>
		</div>
	);
}