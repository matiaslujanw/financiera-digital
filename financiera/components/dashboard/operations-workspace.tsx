"use client";

import { useDeferredValue, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CalendarDays, Eye, FilterX, ListChecks, Search } from "lucide-react";

import type { RouterOutputs } from "~/server/api";
import type { OperationType } from "~/server/db/schema";
import { useTRPC } from "~/trpc/react";
import { dayjs } from "~/utils/dayjs";
import { formatPrice, getTypeLabel } from "~/utils/format";
import { cn } from "~/lib/utils";
import { CreateCheckPurchaseDialog } from "./create-check-purchase-dialog";
import { CreateCheckSaleDialog } from "./create-check-sale-dialog";
import { CreateTransactionDialog } from "./create-transaction-dialog";
import { ManageChecksDialog } from "./manage-checks-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";

type Operation = RouterOutputs["operation"]["byGuildSlug"]["items"][number];

const operationTypes: OperationType[] = [
	"CHECK_PURCHASE",
	"CHECK_SALE",
	"CHECK_DEPOSIT",
	"CHECK_REJECTION",
	"REGULAR",
	"MULTIPLE",
	"CURRENCY_EXCHANGE",
	"LOAN",
	"CREDIT",
	"CABLE",
];

function inputDate(value: string, endOfDay = false): Date | undefined {
	if (!value) return undefined;
	return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
}

export function OperationsWorkspace({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search);
	const [operationType, setOperationType] = useState<OperationType | "ALL">("ALL");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");

	const input = {
		guildSlug,
		limit: 25,
		search: deferredSearch.trim() || undefined,
		operationType: operationType === "ALL" ? undefined : operationType,
		dateFrom: inputDate(dateFrom),
		dateTo: inputDate(dateTo, true),
	};

	const operations = useInfiniteQuery(
		trpc.operation.byGuildSlug.infiniteQueryOptions(input, {
			getNextPageParam: (last) => last.nextCursor ?? undefined,
		}),
	);
	const items = operations.data?.pages.flatMap((page) => page.items) ?? [];
	const total = operations.data?.pages[0]?.total ?? 0;
	const hasFilters = Boolean(search || dateFrom || dateTo || operationType !== "ALL");

	function clearFilters() {
		setSearch("");
		setOperationType("ALL");
		setDateFrom("");
		setDateTo("");
	}

	return (
		<div className="p-4 lg:p-6">
			<section className="bg-card overflow-hidden rounded-xl border">
				<div className="flex flex-col gap-4 border-b p-4 xl:flex-row xl:items-center xl:justify-between xl:p-5">
					<div>
						<div className="flex items-center gap-2">
							<ListChecks className="size-5" />
							<h1 className="text-lg font-semibold">Operaciones</h1>
							<Badge variant="secondary">{total}</Badge>
						</div>
						<p className="text-muted-foreground mt-1 text-sm">
							Una fila por operación; los movimientos contables quedan dentro del detalle.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<CreateCheckPurchaseDialog guildSlug={guildSlug} />
						<CreateCheckSaleDialog guildSlug={guildSlug} />
						<ManageChecksDialog guildSlug={guildSlug} />
						<CreateTransactionDialog guildSlug={guildSlug} />
					</div>
				</div>

				<div className="grid gap-2 border-b p-4 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_13rem_11rem_11rem_auto]">
					<div className="relative">
						<Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
						<Input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Buscar nombre o descripción..."
							className="pl-9"
						/>
					</div>
					<Select
						value={operationType}
						onValueChange={(value) => setOperationType(value as OperationType | "ALL")}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Tipo de operación" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">Todos los tipos</SelectItem>
							{operationTypes.map((type) => (
								<SelectItem key={type} value={type}>
									{getTypeLabel(type)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="relative">
						<CalendarDays className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2" />
						<Input
							type="date"
							value={dateFrom}
							onChange={(event) => setDateFrom(event.target.value)}
							aria-label="Fecha desde"
							className="pl-9"
						/>
					</div>
					<div className="relative">
						<CalendarDays className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2" />
						<Input
							type="date"
							value={dateTo}
							onChange={(event) => setDateTo(event.target.value)}
							aria-label="Fecha hasta"
							className="pl-9"
						/>
					</div>
					<Button
						variant="outline"
						onClick={clearFilters}
						disabled={!hasFilters}
						className="w-full xl:w-auto"
					>
						<FilterX className="size-4" />
						Limpiar
					</Button>
				</div>

				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Fecha</TableHead>
								<TableHead>Tipo</TableHead>
								<TableHead>Descripción</TableHead>
								<TableHead className="text-right">Monto</TableHead>
								<TableHead className="text-right">Descuento / resultado</TableHead>
								<TableHead>Empresa</TableHead>
								<TableHead>Persona</TableHead>
								<TableHead className="text-right">Detalle</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{operations.isLoading &&
								Array.from({ length: 8 }).map((_, index) => (
									<TableRow key={index}>
										{Array.from({ length: 8 }).map((__, cell) => (
											<TableCell key={cell}>
												<Skeleton className="h-5 w-full" />
											</TableCell>
										))}
									</TableRow>
								))}
							{!operations.isLoading && items.length === 0 && (
								<TableRow>
									<TableCell colSpan={8} className="text-muted-foreground h-40 text-center">
										{hasFilters
											? "No hay operaciones que coincidan con los filtros."
											: "Todavía no hay operaciones."}
									</TableCell>
								</TableRow>
							)}
							{items.map((operation) => (
								<TableRow key={operation.id}>
									<TableCell className="whitespace-nowrap tabular-nums">
										{dayjs(operation.date).format("DD/MM/YY HH:mm")}
									</TableCell>
									<TableCell>
										<OperationBadge type={operation.operationType} />
									</TableCell>
									<TableCell className="max-w-xs">
										<p className="truncate font-medium">{operation.name}</p>
										<p className="text-muted-foreground truncate text-xs">
											{operation.description ?? "—"}
										</p>
									</TableCell>
									<TableCell className="text-right tabular-nums">
										<p className="font-medium">{formatPrice(operation.amount)}</p>
										{operation.secondaryAmount !== null && (
											<p className="text-muted-foreground text-xs">
												{operation.secondaryLabel}: {formatPrice(operation.secondaryAmount)}
											</p>
										)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{operation.metricAmount !== null ? (
											<>
												<p
													className={cn(
														"font-medium",
														operation.metricLabel === "Resultado" &&
															(operation.metricAmount >= 0 ? "text-emerald-500" : "text-rose-500"),
													)}
												>
													{formatPrice(operation.metricAmount)}
												</p>
												<p className="text-muted-foreground text-xs">{operation.metricLabel}</p>
											</>
										) : (
											"—"
										)}
									</TableCell>
									<TableCell className="whitespace-nowrap">{operation.businessName ?? "—"}</TableCell>
									<TableCell className="whitespace-nowrap">{operation.counterpart ?? "—"}</TableCell>
									<TableCell className="text-right">
										<OperationDetail operation={operation} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>

				{operations.hasNextPage && (
					<div className="border-t p-3 text-center">
						<Button
							variant="outline"
							size="sm"
							onClick={() => operations.fetchNextPage()}
							disabled={operations.isFetchingNextPage}
						>
							{operations.isFetchingNextPage ? "Cargando…" : "Cargar más operaciones"}
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}

function OperationBadge({ type }: { type: OperationType }) {
	const className =
		type === "CHECK_SALE"
			? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
			: type === "CHECK_REJECTION"
				? "border-rose-500/30 bg-rose-500/10 text-rose-500"
				: type === "CHECK_PURCHASE"
					? "border-sky-500/30 bg-sky-500/10 text-sky-500"
					: "";
	return (
		<Badge variant="outline" className={className}>
			{getTypeLabel(type)}
		</Badge>
	);
}

function OperationDetail({ operation }: { operation: Operation }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm">
					<Eye className="size-4" />
					Ver
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
				<DialogHeader>
					<div className="flex flex-wrap items-center gap-2 pr-8">
						<DialogTitle>{operation.name}</DialogTitle>
						<OperationBadge type={operation.operationType} />
					</div>
					<DialogDescription>
						{dayjs(operation.date).format("DD/MM/YYYY HH:mm")} · {operation.businessName ?? "Sin empresa"}
						{operation.counterpart ? ` · ${operation.counterpart}` : ""}
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-3 sm:grid-cols-3">
					<Metric label="Monto de la operación" value={operation.amount} />
					<Metric
						label={operation.secondaryLabel ?? "Moneda"}
						value={operation.secondaryAmount}
						fallback={operation.currency}
					/>
					<Metric
						label={operation.metricLabel ?? "Resultado"}
						value={operation.metricAmount}
						result={operation.metricLabel === "Resultado"}
					/>
				</div>

				{operation.description && (
					<div className="bg-muted/50 rounded-lg p-3 text-sm">
						<span className="text-muted-foreground">Descripción: </span>
						{operation.description}
					</div>
				)}

				{operation.checks.length > 0 && (
					<div>
						<h3 className="mb-2 font-medium">Cheques vinculados</h3>
						<div className="overflow-x-auto rounded-lg border">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Cheque</TableHead>
										<TableHead>Vencimiento</TableHead>
										<TableHead>Vendedor / comprador</TableHead>
										<TableHead className="text-right">Nominal</TableHead>
										<TableHead className="text-right">Compra</TableHead>
										<TableHead className="text-right">Venta</TableHead>
										<TableHead className="text-right">Ganancia</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{operation.checks.map((check) => {
										const profit = Number(check.saleNetValue ?? 0) - Number(check.netValue);
										return (
											<TableRow key={check.id}>
												<TableCell>
													<p className="font-medium">{check.checkNumber || "Sin número"}</p>
													<p className="text-muted-foreground text-xs">{check.bankName || check.checkWriter}</p>
												</TableCell>
												<TableCell className="whitespace-nowrap">{dayjs(check.collectionDate).format("DD/MM/YY")}</TableCell>
												<TableCell>
													<p>{check.person?.name ?? "—"}</p>
													{check.buyerPerson && <p className="text-muted-foreground text-xs">a {check.buyerPerson.name}</p>}
												</TableCell>
												<TableCell className="text-right tabular-nums">{formatPrice(check.grossValue)}</TableCell>
												<TableCell className="text-right tabular-nums">{formatPrice(check.netValue)}</TableCell>
												<TableCell className="text-right tabular-nums">{check.saleNetValue ? formatPrice(check.saleNetValue) : "—"}</TableCell>
												<TableCell className={cn("text-right font-medium tabular-nums", check.saleNetValue && (profit >= 0 ? "text-emerald-500" : "text-rose-500"))}>
													{check.saleNetValue ? formatPrice(profit) : "—"}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
					</div>
				)}

				<div>
					<div className="mb-2 flex items-center justify-between">
						<h3 className="font-medium">Movimientos contables</h3>
						<Badge variant="secondary">{operation.transactions.length}</Badge>
					</div>
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Cuenta</TableHead>
									<TableHead>Debe / haber</TableHead>
									<TableHead>Descripción</TableHead>
									<TableHead className="text-right">Monto</TableHead>
									<TableHead className="text-right">Saldo posterior</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{operation.transactions.map((transaction) => (
									<TableRow key={transaction.id}>
										<TableCell>
											<p>{transaction.toAccount.name ?? transaction.toAccount.dictionaryAccount.name}</p>
											<p className="text-muted-foreground text-xs">{transaction.toAccount.business.name}</p>
										</TableCell>
										<TableCell>
											<Badge variant="outline">{transaction.transactionType === "DEBIT" ? "Debe" : "Haber"}</Badge>
										</TableCell>
										<TableCell className="max-w-xs truncate">{transaction.about ?? "—"}</TableCell>
										<TableCell className="text-right tabular-nums">{formatPrice(transaction.amount)}</TableCell>
										<TableCell className="text-right tabular-nums">{formatPrice(transaction.balance)}</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Metric(props: {
	label: string;
	value: number | null;
	fallback?: string;
	result?: boolean;
}) {
	return (
		<div className="bg-muted/50 rounded-lg p-3">
			<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{props.label}</p>
			<p
				className={cn(
					"mt-1 text-lg font-semibold tabular-nums",
					props.result && props.value !== null &&
						(props.value >= 0 ? "text-emerald-500" : "text-rose-500"),
				)}
			>
				{props.value !== null ? formatPrice(props.value) : (props.fallback ?? "—")}
			</p>
		</div>
	);
}
