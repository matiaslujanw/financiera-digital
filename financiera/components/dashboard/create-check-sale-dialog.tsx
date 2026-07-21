"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CheckCheck, Tags, X } from "lucide-react";
import { toast } from "sonner";

import { calculateSaleValues } from "~/server/api/lib/financial-utils";
import { useTRPC } from "~/trpc/react";
import { dayjs } from "~/utils/dayjs";
import { formatPrice } from "~/utils/format";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";

function dateInputValue(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dateAtNoon(value: string): Date {
	return new Date(`${value}T12:00:00`);
}

function parseNumber(value: string): number {
	return Number(value.replace(",", "."));
}

export function CreateCheckSaleDialog({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [open, setOpen] = useState(false);
	const [businessId, setBusinessId] = useState("");
	const [saleDate, setSaleDate] = useState("");
	const [buyerName, setBuyerName] = useState("");
	const [serviceFeeRate, setServiceFeeRate] = useState("2");
	const [monthlyInterestRate, setMonthlyInterestRate] = useState("");
	const [about, setAbout] = useState("");
	const [selectedIds, setSelectedIds] = useState<string[]>([]);

	const businessesQuery = useQuery(
		trpc.business.byGuildSlug.queryOptions({ guildSlug }),
	);
	const checksQuery = useQuery(
		trpc.check.availableForSale.queryOptions(
			{ guildSlug, businessId },
			{ enabled: open && !!businessId },
		),
	);

	const rows = useMemo(() => {
		const ratesComplete =
			serviceFeeRate.trim() !== "" && monthlyInterestRate.trim() !== "";
		const feeRate = parseNumber(serviceFeeRate);
		const interestRate = parseNumber(monthlyInterestRate);
		const selectedSaleDate = saleDate ? dateAtNoon(saleDate) : null;

		return (checksQuery.data ?? []).map((check) => {
			const purchaseDate = check.purchaseDate ? new Date(check.purchaseDate) : null;
			const collectionDate = new Date(check.collectionDate);
			const expired = selectedSaleDate
				? dayjs(selectedSaleDate).startOf("day").isAfter(dayjs(collectionDate).startOf("day"))
				: false;
			const beforePurchase =
				!!selectedSaleDate &&
				!!purchaseDate &&
				dayjs(selectedSaleDate).startOf("day").isBefore(dayjs(purchaseDate).startOf("day"));
			const holdingDays =
				selectedSaleDate && purchaseDate
					? dayjs(selectedSaleDate).startOf("day").diff(dayjs(purchaseDate).startOf("day"), "day")
					: null;
			let values = null;
			if (
				selectedSaleDate &&
				ratesComplete &&
				!expired &&
				!beforePurchase &&
				Number.isFinite(feeRate) &&
				feeRate >= 0 &&
				Number.isFinite(interestRate) &&
				interestRate >= 0
			) {
				try {
					values = calculateSaleValues({
						grossValue: Number.parseFloat(check.grossValue),
						serviceFeeRate: feeRate,
						monthlyInterestRate: interestRate,
						saleDate: selectedSaleDate,
						collectionDate,
						bankClearing: check.bankClearing ?? 0,
					});
				} catch {
					values = null;
				}
			}
			const purchaseCost = Number.parseFloat(check.netValue);
			return {
				check,
				expired,
				beforePurchase,
				holdingDays,
				values,
				purchaseCost,
				profit: values ? values.netValue - purchaseCost : null,
			};
		});
	}, [checksQuery.data, monthlyInterestRate, saleDate, serviceFeeRate]);

	const selectedRows = useMemo(
		() => rows.filter((row) => selectedIds.includes(row.check.id)),
		[rows, selectedIds],
	);
	const totals = useMemo(
		() =>
			selectedRows.reduce(
				(acc, row) => {
					if (!row.values || row.profit === null) return acc;
					acc.gross += Number.parseFloat(row.check.grossValue);
					acc.purchaseCost += row.purchaseCost;
					acc.saleValue += row.values.netValue;
					acc.profit += row.profit;
					acc.holdingDays += row.holdingDays ?? 0;
					return acc;
				},
				{ gross: 0, purchaseCost: 0, saleValue: 0, profit: 0, holdingDays: 0 },
			),
		[selectedRows],
	);
	const averageHoldingDays = selectedRows.length
		? totals.holdingDays / selectedRows.length
		: 0;
	const profitability = totals.purchaseCost
		? (totals.profit / totals.purchaseCost) * 100
		: 0;
	const selectableIds = rows
		.filter((row) => !row.expired && !row.beforePurchase && row.values && row.values.netValue > 0)
		.map((row) => row.check.id);

	const saleMutation = useMutation(
		trpc.check.sale.mutationOptions({
			onSuccess: (result) => {
				const profit = Number.parseFloat(result.totals.profit);
				toast.success(
					`${result.checksSold} cheque${result.checksSold === 1 ? " vendido" : "s vendidos"}`,
					{
						description: `Valor de venta ${formatPrice(result.totals.saleValue)} · ${profit >= 0 ? "Ganancia" : "Pérdida"} ${formatPrice(Math.abs(profit))}`,
					},
				);
				void queryClient.invalidateQueries();
				setOpen(false);
				resetForm();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function resetForm() {
		setSaleDate("");
		setBuyerName("");
		setServiceFeeRate("2");
		setMonthlyInterestRate("");
		setAbout("");
		setSelectedIds([]);
	}

	function onOpenChange(next: boolean) {
		if (next) {
			setBusinessId((current) => current || businessesQuery.data?.[0]?.id || "");
			setSaleDate(dateInputValue(new Date()));
		}
		if (!next && !saleMutation.isPending) resetForm();
		setOpen(next);
	}

	function toggleCheck(checkId: string) {
		setSelectedIds((current) =>
			current.includes(checkId)
				? current.filter((id) => id !== checkId)
				: [...current, checkId],
		);
	}

	function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!businessId) return toast.error("Elegí una empresa");
		if (!saleDate) return toast.error("Ingresá la fecha de venta");
		if (buyerName.trim().length < 2) {
			return toast.error("Ingresá el comprador de los cheques");
		}
		const feeRate = parseNumber(serviceFeeRate);
		const interestRate = parseNumber(monthlyInterestRate);
		if (serviceFeeRate.trim() === "") {
			return toast.error("Ingresá la pesificación de venta");
		}
		if (monthlyInterestRate.trim() === "") {
			return toast.error("Ingresá el interés mensual de venta");
		}
		if (!Number.isFinite(feeRate) || feeRate < 0) {
			return toast.error("Ingresá una pesificación válida");
		}
		if (!Number.isFinite(interestRate) || interestRate < 0) {
			return toast.error("Ingresá un interés mensual válido");
		}
		if (selectedRows.length === 0) return toast.error("Seleccioná al menos un cheque");
		if (selectedRows.some((row) => !row.values || row.values.netValue <= 0)) {
			return toast.error("Revisá los valores de los cheques seleccionados");
		}

		saleMutation.mutate({
			guildSlug,
			businessId,
			saleDate: dateAtNoon(saleDate),
			serviceFeeRate: feeRate,
			monthlyInterestRate: interestRate,
			buyerName: buyerName.trim(),
			about: about.trim() || undefined,
			checkIds: selectedRows.map((row) => row.check.id),
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline" className="gap-2">
					<ArrowUpRight className="size-4" />
					Vender cheques
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[95vw]">
				<form onSubmit={submit} className="flex min-h-0 flex-col">
					<DialogHeader className="border-b px-6 py-5">
						<div className="flex items-center gap-3">
							<div className="bg-primary/10 text-primary rounded-lg p-2">
								<Tags className="size-5" />
							</div>
							<div>
								<DialogTitle>Venta de cheques</DialogTitle>
								<DialogDescription className="mt-1">
									Elegí los cheques y compará costo, valor de venta, permanencia y ganancia.
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>

					<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
							<div className="space-y-2 lg:col-span-2">
								<Label>Empresa</Label>
								<Select
									value={businessId}
									onValueChange={(value) => {
										setBusinessId(value);
										setSelectedIds([]);
									}}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Seleccionar empresa" />
									</SelectTrigger>
									<SelectContent>
										{businessesQuery.data?.map((business) => (
											<SelectItem key={business.id} value={business.id}>
												{business.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2 lg:col-span-2">
								<Label htmlFor="sale-buyer">Comprador</Label>
								<Input
									id="sale-buyer"
									placeholder="Quien recibe los cheques"
									value={buyerName}
									onChange={(event) => setBuyerName(event.target.value)}
									required
								/>
								<p className="text-muted-foreground text-xs">
									Si es nuevo, se crea automáticamente.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="sale-date">Fecha de venta</Label>
								<Input
									id="sale-date"
									type="date"
									value={saleDate}
									onChange={(event) => setSaleDate(event.target.value)}
									onInput={(event) => setSaleDate(event.currentTarget.value)}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="sale-about">Descripción</Label>
								<Textarea
									id="sale-about"
									rows={1}
									value={about}
									onChange={(event) => setAbout(event.target.value)}
								/>
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="sale-fee">Pesificación de venta (%)</Label>
								<Input
									id="sale-fee"
									type="number"
									min="0"
									max="100"
									step="0.01"
									value={serviceFeeRate}
									onChange={(event) => setServiceFeeRate(event.target.value)}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="sale-interest">Interés mensual de venta (%)</Label>
								<Input
									id="sale-interest"
									type="number"
									min="0"
									step="0.01"
									placeholder="0,00"
									value={monthlyInterestRate}
									onChange={(event) => setMonthlyInterestRate(event.target.value)}
									required
								/>
							</div>
						</div>

						<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
							<SaleTotalCard label="Costo de compra" value={totals.purchaseCost} />
							<SaleTotalCard label="Valor de venta" value={totals.saleValue} emphasis />
							<SaleTotalCard label={totals.profit >= 0 ? "Ganancia" : "Pérdida"} value={Math.abs(totals.profit)} tone={totals.profit >= 0 ? "positive" : "negative"} />
							<SaleMetricCard label="Rentabilidad" value={`${profitability.toFixed(2)}%`} />
							<SaleMetricCard label="Días promedio en cartera" value={averageHoldingDays.toFixed(1)} />
						</div>

						<div className="space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h3 className="font-medium">Cheques disponibles</h3>
									<p className="text-muted-foreground text-xs">
										{selectedIds.length} seleccionados de {rows.length} disponibles en cartera.
									</p>
								</div>
								<div className="flex gap-2">
									<Button type="button" size="sm" variant="outline" onClick={() => setSelectedIds(selectableIds)} disabled={selectableIds.length === 0}>
										<CheckCheck className="size-4" />
										Seleccionar aptos
									</Button>
									<Button type="button" size="sm" variant="ghost" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>
										<X className="size-4" />
										Limpiar
									</Button>
								</div>
							</div>

							<div className="overflow-x-auto rounded-lg border">
								<Table className="min-w-[1500px]">
									<TableHeader>
										<TableRow>
											<TableHead className="w-12" />
											<TableHead>Número</TableHead>
											<TableHead>Banco / librador</TableHead>
											<TableHead>Vendedor</TableHead>
											<TableHead>Compra</TableHead>
											<TableHead>Cobro</TableHead>
											<TableHead className="text-right">Días cartera</TableHead>
											<TableHead className="text-right">Plazo venta</TableHead>
											<TableHead className="text-right">Nominal</TableHead>
											<TableHead className="text-right">Costo compra</TableHead>
											<TableHead className="text-right">Valor venta</TableHead>
											<TableHead className="text-right">Ganancia</TableHead>
											<TableHead>Estado</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{checksQuery.isLoading && (
											<TableRow>
												<TableCell colSpan={13} className="text-muted-foreground h-24 text-center">Cargando cheques…</TableCell>
											</TableRow>
										)}
										{!checksQuery.isLoading && rows.length === 0 && (
											<TableRow>
												<TableCell colSpan={13} className="text-muted-foreground h-24 text-center">No hay cheques comprados disponibles para vender.</TableCell>
											</TableRow>
										)}
										{rows.map((row) => {
											const selected = selectedIds.includes(row.check.id);
											const disabled = row.expired || row.beforePurchase || !row.values || row.values.netValue <= 0;
											return (
												<TableRow key={row.check.id} className={selected ? "bg-primary/5" : undefined}>
													<TableCell>
														<input
															type="checkbox"
															className="accent-primary size-4"
															checked={selected}
															onChange={() => toggleCheck(row.check.id)}
															disabled={disabled}
															aria-label={`Seleccionar cheque ${row.check.checkNumber || row.check.id}`}
														/>
													</TableCell>
													<TableCell className="font-medium">{row.check.checkNumber || "—"}</TableCell>
													<TableCell>
														<div>{row.check.bankName || "—"}</div>
														<div className="text-muted-foreground text-xs">{row.check.checkWriter}</div>
													</TableCell>
													<TableCell>{row.check.person?.name || "—"}</TableCell>
													<TableCell className="whitespace-nowrap">{row.check.purchaseDate ? dayjs(row.check.purchaseDate).format("DD/MM/YY") : "—"}</TableCell>
													<TableCell className="whitespace-nowrap">{dayjs(row.check.collectionDate).format("DD/MM/YY")}</TableCell>
													<TableCell className="text-right tabular-nums">{row.holdingDays ?? "—"}</TableCell>
													<TableCell className="text-right tabular-nums">{row.values?.totalDays ?? "—"}</TableCell>
													<TableCell className="text-right tabular-nums">{formatPrice(row.check.grossValue)}</TableCell>
													<TableCell className="text-right tabular-nums">{formatPrice(row.purchaseCost)}</TableCell>
													<TableCell className="text-right font-medium tabular-nums">{row.values ? formatPrice(row.values.netValue) : "—"}</TableCell>
													<TableCell className={`text-right font-medium tabular-nums ${row.profit !== null && row.profit >= 0 ? "text-emerald-600" : "text-red-500"}`}>{row.profit !== null ? formatPrice(row.profit) : "—"}</TableCell>
													<TableCell>
														{row.expired ? <Badge variant="destructive">Vencido</Badge> : row.beforePurchase ? <Badge variant="destructive">Fecha inválida</Badge> : row.values ? <Badge variant="outline">Apto</Badge> : <Badge variant="secondary">Completar tasas</Badge>}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						</div>
					</div>

					<DialogFooter className="mx-0 mb-0 px-6">
						<Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saleMutation.isPending}>Cancelar</Button>
						<Button type="submit" disabled={saleMutation.isPending || selectedIds.length === 0}>
							{saleMutation.isPending ? "Registrando…" : `Vender ${selectedIds.length} cheque${selectedIds.length === 1 ? "" : "s"} por ${formatPrice(totals.saleValue)}`}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function SaleTotalCard({ label, value, emphasis, tone }: { label: string; value: number; emphasis?: boolean; tone?: "positive" | "negative" }) {
	return (
		<div className={emphasis ? "bg-primary text-primary-foreground rounded-lg border p-4" : "bg-muted/40 rounded-lg border p-4"}>
			<p className={emphasis ? "text-primary-foreground/70 text-xs" : "text-muted-foreground text-xs"}>{label}</p>
			<p className={`mt-1 text-lg font-semibold tabular-nums ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-red-500" : ""}`}>{formatPrice(value)}</p>
		</div>
	);
}

function SaleMetricCard({ label, value }: { label: string; value: string }) {
	return (
		<div className="bg-muted/40 rounded-lg border p-4">
			<p className="text-muted-foreground text-xs">{label}</p>
			<p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
		</div>
	);
}
