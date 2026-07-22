"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import { dayjs } from "~/utils/dayjs";
import { formatPrice, getTypeLabel } from "~/utils/format";
import { CreateCheckPurchaseDialog } from "./create-check-purchase-dialog";
import { CreateCheckSaleDialog } from "./create-check-sale-dialog";
import { ManageChecksDialog } from "./manage-checks-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";

export function TransactionsTable({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();

	const countQuery = useQuery(
		trpc.transaction.countByGuildSlug.queryOptions({ guildSlug }),
	);

	const {
		data,
		isLoading,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery(
		trpc.transaction.byGuildSlugWithCursor.infiniteQueryOptions(
			{ guildSlug, limit: 25 },
			{ getNextPageParam: (last) => last.nextCursor ?? undefined },
		),
	);

	const items = data?.pages.flatMap((p) => p.items) ?? [];

	return (
		<div className="bg-card flex h-full flex-col overflow-hidden rounded-xl border">
			<div className="flex items-center justify-between border-b p-4">
				<div className="flex items-center gap-2">
					<h2 className="font-semibold">Transacciones</h2>
					<Badge variant="secondary" className="tabular-nums">{countQuery.data ?? 0}</Badge>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<CreateCheckPurchaseDialog guildSlug={guildSlug} />
					<CreateCheckSaleDialog guildSlug={guildSlug} />
					<ManageChecksDialog guildSlug={guildSlug} />
				</div>
			</div>

			<div className="flex-1 overflow-auto">
				<Table>
					<TableHeader className="bg-card sticky top-0">
						<TableRow>
							<TableHead>Fecha</TableHead>
							<TableHead>Tipo</TableHead>
							<TableHead>Descripción</TableHead>
							<TableHead className="text-right">Monto</TableHead>
							<TableHead>Empresa</TableHead>
							<TableHead>Persona</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading &&
							Array.from({ length: 5 }).map((_, i) => (
								<TableRow key={i}>
									{Array.from({ length: 6 }).map((__, j) => (
										<TableCell key={j}>
											<Skeleton className="h-5 w-full" />
										</TableCell>
									))}
								</TableRow>
							))}

						{!isLoading && items.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={6}
									className="text-muted-foreground h-32 text-center"
								>
									No hay transacciones todavía.
								</TableCell>
							</TableRow>
						)}

						{items.map((t) => (
							<TableRow key={t.id}>
								<TableCell className="whitespace-nowrap tabular-nums">
									{dayjs(t.date).format("DD/MM/YY HH:mm")}
								</TableCell>
								<TableCell>
									<Badge variant="outline">
										{t.transactionGroup
											? getTypeLabel(t.transactionGroup.operationType)
											: t.transactionType === "CREDIT"
												? "Ingreso"
												: "Egreso"}
									</Badge>
								</TableCell>
								<TableCell className="max-w-xs truncate">
									{t.about ?? t.transactionGroup?.name ?? "—"}
								</TableCell>
								<TableCell className="text-right font-mono tabular-nums">
									{formatPrice(t.amount)}
								</TableCell>
								<TableCell className="whitespace-nowrap">
									{t.toAccount?.business?.name ?? "—"}
								</TableCell>
								<TableCell className="whitespace-nowrap">
									{t.person?.name ?? "—"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			{hasNextPage && (
				<div className="border-t p-3 text-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => fetchNextPage()}
						disabled={isFetchingNextPage}
					>
						{isFetchingNextPage ? "Cargando…" : "Cargar más"}
					</Button>
				</div>
			)}
		</div>
	);
}
