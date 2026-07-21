"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
	BookOpen,
	Building2,
	ChevronRight,
	Search,
	WalletCards,
} from "lucide-react";

import { useTRPC } from "~/trpc/react";
import {
	ACCOUNT_TYPE_LABELS,
	ACCOUNT_TYPE_ORDER,
	formatCurrency,
	getTypeLabel,
} from "~/utils/format";
import { dayjs } from "~/utils/dayjs";
import { cn } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { CreateAccountDialog } from "./create-account-dialog";

export function AccountsWorkspace({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const [search, setSearch] = useState("");
	const [selectedByUser, setSelectedByUser] = useState<string | null>(null);
	const summary = useQuery(
		trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug }),
	);

	const businesses = summary.data ?? [];
	const allAccounts = businesses.flatMap((business) => business.accounts);
	const firstAccountId = ACCOUNT_TYPE_ORDER.map((type) =>
		allAccounts.find((account) => account.accountType === type),
	).find(Boolean)?.id;
	const selectedAccountId = selectedByUser ?? firstAccountId ?? "";

	const movements = useInfiniteQuery(
		trpc.accountOnBusiness.accountMovements.infiniteQueryOptions(
			{ guildSlug, accountId: selectedAccountId, limit: 30 },
			{
				enabled: Boolean(selectedAccountId),
				getNextPageParam: (last) => last.nextCursor ?? undefined,
			},
		),
	);

	const account = movements.data?.pages[0]?.account;
	const rows = useMemo(() => {
		if (!account) return [];
		const rawRows = movements.data?.pages.flatMap((page) => page.items) ?? [];
		let runningBalance = Number.parseFloat(account.currentBalance) || 0;
		return rawRows.map((transaction) => {
			const increases =
				account.accountType === "ASSET" || account.accountType === "REVENUE"
					? transaction.transactionType === "DEBIT"
					: transaction.transactionType === "CREDIT";
			const signedAmount =
				(Number.parseFloat(transaction.amount) || 0) * (increases ? 1 : -1);
			const balanceAfter = runningBalance;
			runningBalance -= signedAmount;
			return { ...transaction, signedAmount, balanceAfter };
		});
	}, [account, movements.data]);

	const normalizedSearch = search.trim().toLocaleLowerCase("es");

	return (
		<div className="flex min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:flex-row lg:p-6">
			<aside className="bg-card flex w-full shrink-0 flex-col overflow-hidden rounded-xl border lg:w-80">
				<div className="border-b p-4">
					<div className="mb-3 flex items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<BookOpen className="size-5" />
							<div>
								<h1 className="font-semibold">Cuentas</h1>
								<p className="text-muted-foreground text-xs">
									Saldos y movimientos reales
								</p>
							</div>
						</div>
						<CreateAccountDialog
							guildSlug={guildSlug}
							onCreated={setSelectedByUser}
						/>
					</div>
					<div className="relative">
						<Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Buscar cuenta..."
							className="pl-9"
						/>
					</div>
				</div>

				<div className="max-h-80 flex-1 overflow-y-auto p-2 lg:max-h-none">
					{summary.isLoading && (
						<div className="space-y-2 p-2">
							{Array.from({ length: 7 }).map((_, index) => (
								<Skeleton key={index} className="h-9 w-full" />
							))}
						</div>
					)}

					{!summary.isLoading && allAccounts.length === 0 && (
						<p className="text-muted-foreground p-4 text-center text-sm">
							No hay cuentas activas.
						</p>
					)}

					{businesses.map((business) => {
						const matchingAccounts = business.accounts.filter((item) =>
							item.name.toLocaleLowerCase("es").includes(normalizedSearch),
						);
						if (matchingAccounts.length === 0) return null;

						return (
							<div key={business.id} className="mb-4 last:mb-0">
								<div className="text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs font-medium uppercase tracking-wide">
									<Building2 className="size-3.5" />
									{business.name}
								</div>
								{ACCOUNT_TYPE_ORDER.map((type) => {
									const accounts = matchingAccounts.filter(
										(item) => item.accountType === type,
									);
									if (accounts.length === 0) return null;
									return (
										<div key={type} className="mb-2">
											<p className="text-muted-foreground px-2 pb-1 text-[10px] font-medium uppercase">
												{ACCOUNT_TYPE_LABELS[type]}
											</p>
											{accounts.map((item) => (
												<button
													key={item.id}
													type="button"
													onClick={() => setSelectedByUser(item.id)}
													className={cn(
														"flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
														selectedAccountId === item.id
															? "bg-accent text-accent-foreground"
															: "hover:bg-accent/50",
													)}
												>
													<div className="min-w-0 flex-1">
														<p className="truncate text-sm">{item.name}</p>
														<p className="text-muted-foreground text-xs tabular-nums">
															{formatCurrency(item.currentBalance, item.currency)}
														</p>
													</div>
													<ChevronRight className="text-muted-foreground size-4" />
												</button>
											))}
										</div>
									);
								})}
							</div>
						);
					})}
				</div>
			</aside>

			<section className="bg-card flex min-h-[34rem] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
				{account ? (
					<>
						<div className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
							<div className="flex items-center gap-3">
								<div className="bg-muted flex size-10 items-center justify-center rounded-xl">
									<WalletCards className="size-5" />
								</div>
								<div>
									<h2 className="text-lg font-semibold">{account.name}</h2>
									<p className="text-muted-foreground text-sm">
										{account.businessName} · {ACCOUNT_TYPE_LABELS[account.accountType]}
										{account.hasSubAccounts ? " · Incluye subcuentas" : ""}
									</p>
								</div>
							</div>
							<div className="sm:text-right">
								<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
									Saldo actual
								</p>
								<p className="text-2xl font-semibold tabular-nums">
									{formatCurrency(account.currentBalance, account.currency)}
								</p>
								<Badge variant="outline">{account.currency}</Badge>
							</div>
						</div>

						<div className="flex-1 overflow-auto">
							<Table>
								<TableHeader className="bg-card sticky top-0 z-10">
									<TableRow>
										<TableHead>Fecha</TableHead>
										<TableHead>Operación</TableHead>
										<TableHead>Descripción / subcuenta</TableHead>
										<TableHead>Persona</TableHead>
										<TableHead className="text-right">Movimiento</TableHead>
										<TableHead className="text-right">Saldo</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{movements.isLoading &&
										Array.from({ length: 7 }).map((_, index) => (
											<TableRow key={index}>
												{Array.from({ length: 6 }).map((__, cell) => (
													<TableCell key={cell}>
														<Skeleton className="h-5 w-full" />
													</TableCell>
												))}
											</TableRow>
										))}
									{!movements.isLoading && rows.length === 0 && (
										<TableRow>
											<TableCell colSpan={6} className="text-muted-foreground h-40 text-center">
												Esta cuenta todavía no tiene movimientos.
											</TableCell>
										</TableRow>
									)}
									{rows.map((transaction) => {
										const entityName =
											transaction.toAccount.name ??
											transaction.toAccount.person?.name ??
											transaction.toAccount.machinery?.name ??
											transaction.toAccount.vehicle?.name ??
											transaction.toAccount.property?.name;
										return (
											<TableRow key={transaction.id}>
												<TableCell className="whitespace-nowrap tabular-nums">
													{dayjs(transaction.date).format("DD/MM/YY HH:mm")}
												</TableCell>
												<TableCell>
													<Badge variant="outline">
														{transaction.transactionGroup
															? getTypeLabel(transaction.transactionGroup.operationType)
															: "Regular"}
													</Badge>
												</TableCell>
												<TableCell className="max-w-xs">
													<p className="truncate">
														{transaction.about ?? transaction.transactionGroup?.description ?? "—"}
													</p>
													{entityName && entityName !== account.name && (
														<p className="text-muted-foreground truncate text-xs">{entityName}</p>
													)}
												</TableCell>
												<TableCell>{transaction.person?.name ?? transaction.toAccount.person?.name ?? "—"}</TableCell>
												<TableCell
													className={cn(
														"text-right font-medium tabular-nums",
														transaction.signedAmount >= 0 ? "text-emerald-500" : "text-rose-500",
													)}
												>
													{transaction.signedAmount >= 0 ? "+" : "−"}
													{formatCurrency(Math.abs(transaction.signedAmount), account.currency)}
												</TableCell>
												<TableCell className="text-right tabular-nums">
													{formatCurrency(transaction.balanceAfter, account.currency)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>

						{movements.hasNextPage && (
							<div className="border-t p-3 text-center">
								<Button
									variant="outline"
									size="sm"
									onClick={() => movements.fetchNextPage()}
									disabled={movements.isFetchingNextPage}
								>
									{movements.isFetchingNextPage ? "Cargando…" : "Cargar más movimientos"}
								</Button>
							</div>
						)}
					</>
				) : (
					<div className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
						<WalletCards className="size-10" />
						<p>{summary.isLoading ? "Cargando cuentas…" : "Seleccioná una cuenta para ver su mayor."}</p>
					</div>
				)}
			</section>
		</div>
	);
}
