"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Landmark, Plus, ReceiptText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { calculatePurchaseValues } from "~/server/api/lib/financial-utils";
import { useTRPC } from "~/trpc/react";
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

interface CheckDraft {
	id: string;
	collectionDate: string;
	bankClearing: string;
	grossValue: string;
	checkWriter: string;
	checkNumber: string;
	bankName: string;
}

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

function newCheckDraft(purchaseDate: string): CheckDraft {
	const collectionDate = purchaseDate
		? dateAtNoon(purchaseDate)
		: new Date();
	collectionDate.setDate(collectionDate.getDate() + 30);
	return {
		id: crypto.randomUUID(),
		collectionDate: dateInputValue(collectionDate),
		bankClearing: "0",
		grossValue: "",
		checkWriter: "",
		checkNumber: "",
		bankName: "",
	};
}

export function CreateCheckPurchaseDialog({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [open, setOpen] = useState(false);
	const [businessId, setBusinessId] = useState("");
	const [purchaseDate, setPurchaseDate] = useState("");
	const [customerName, setCustomerName] = useState("");
	const [serviceFeeRate, setServiceFeeRate] = useState("3");
	const [monthlyInterestRate, setMonthlyInterestRate] = useState("");
	const [about, setAbout] = useState("");
	const [checks, setChecks] = useState<CheckDraft[]>([]);

	const businessesQuery = useQuery(
		trpc.business.byGuildSlug.queryOptions({ guildSlug }),
	);

	const calculatedChecks = useMemo(() => {
		if (!purchaseDate) return checks.map(() => null);
		const purchase = dateAtNoon(purchaseDate);
		const feeRate = parseNumber(serviceFeeRate);
		const interestRate = parseNumber(monthlyInterestRate);

		return checks.map((check) => {
			const grossValue = parseNumber(check.grossValue);
			const bankClearing = parseNumber(check.bankClearing);
			if (
				!check.collectionDate ||
				!Number.isFinite(grossValue) ||
				grossValue <= 0 ||
				!Number.isFinite(feeRate) ||
				feeRate < 0 ||
				!Number.isFinite(interestRate) ||
				interestRate < 0 ||
				!Number.isInteger(bankClearing) ||
				bankClearing < 0
			) {
				return null;
			}
			try {
				return calculatePurchaseValues({
					grossValue,
					serviceFeeRate: feeRate,
					monthlyInterestRate: interestRate,
					purchaseDate: purchase,
					collectionDate: dateAtNoon(check.collectionDate),
					bankClearing,
				});
			} catch {
				return null;
			}
		});
	}, [checks, monthlyInterestRate, purchaseDate, serviceFeeRate]);

	const totals = useMemo(
		() =>
			calculatedChecks.reduce(
				(acc, values) => {
					if (!values) return acc;
					acc.gross += values.grossValue;
					acc.serviceFee += values.serviceFeeAmount;
					acc.interest += values.interestAmount;
					acc.net += values.netValue;
					return acc;
				},
				{ gross: 0, serviceFee: 0, interest: 0, net: 0 },
			),
		[calculatedChecks],
	);

	const purchaseMutation = useMutation(
		trpc.check.purchase.mutationOptions({
			onSuccess: (result) => {
				toast.success(
					`${result.checksCreated} cheque${result.checksCreated === 1 ? " comprado" : "s comprados"}`,
					{
						description: `${result.transactionsCreated} movimientos contables creados.`,
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
		setPurchaseDate("");
		setCustomerName("");
		setServiceFeeRate("3");
		setMonthlyInterestRate("");
		setAbout("");
		setChecks([]);
	}

	function onOpenChange(next: boolean) {
		if (next) {
			const today = dateInputValue(new Date());
			setBusinessId((current) => current || businessesQuery.data?.[0]?.id || "");
			setPurchaseDate(today);
			setChecks([newCheckDraft(today)]);
		}
		if (!next && !purchaseMutation.isPending) resetForm();
		setOpen(next);
	}

	function updateCheck(id: string, patch: Partial<CheckDraft>) {
		setChecks((current) =>
			current.map((check) => (check.id === id ? { ...check, ...patch } : check)),
		);
	}

	function removeCheck(id: string) {
		setChecks((current) => current.filter((check) => check.id !== id));
	}

	function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!businessId) return toast.error("Elegí una empresa");
		if (!purchaseDate) return toast.error("Ingresá la fecha de operación");
		if (customerName.trim().length < 2) {
			return toast.error("Ingresá el cliente que entrega los cheques");
		}
		const feeRate = parseNumber(serviceFeeRate);
		const interestRate = parseNumber(monthlyInterestRate);
		if (!Number.isFinite(feeRate) || feeRate < 0) {
			return toast.error("Ingresá una pesificación válida");
		}
		if (!Number.isFinite(interestRate) || interestRate < 0) {
			return toast.error("Ingresá un interés mensual válido");
		}
		if (checks.length === 0) return toast.error("Agregá al menos un cheque");

		const invalidIndex = checks.findIndex(
			(check, index) =>
				!calculatedChecks[index] ||
				calculatedChecks[index]!.netValue <= 0 ||
				check.checkWriter.trim().length < 2 ||
				!check.checkNumber.trim() ||
				!check.bankName.trim(),
		);
		if (invalidIndex >= 0) {
			return toast.error(
				`Revisá fecha, clearing, monto, librador, número y banco del cheque ${invalidIndex + 1}`,
			);
		}

		purchaseMutation.mutate({
			guildSlug,
			businessId,
			purchaseDate: dateAtNoon(purchaseDate),
			serviceFeeRate: feeRate,
			monthlyInterestRate: interestRate,
			customerName: customerName.trim(),
			about: about.trim() || undefined,
			checks: checks.map((check) => ({
				collectionDate: dateAtNoon(check.collectionDate),
				bankClearing: parseNumber(check.bankClearing),
				grossValue: parseNumber(check.grossValue),
				checkWriter: check.checkWriter.trim(),
				checkNumber: check.checkNumber.trim(),
				bankName: check.bankName.trim(),
			})),
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline" className="gap-2">
					<ReceiptText className="size-4" />
					Comprar cheques
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-6xl">
				<form onSubmit={submit} className="flex min-h-0 flex-col">
					<DialogHeader className="border-b px-6 py-5">
						<div className="flex items-center gap-3">
							<div className="bg-primary/10 text-primary rounded-lg p-2">
								<Landmark className="size-5" />
							</div>
							<div>
								<DialogTitle>Compra de cheques</DialogTitle>
								<DialogDescription className="mt-1">
									Cada cheque crea cuatro movimientos dentro de una misma operación.
								</DialogDescription>
							</div>
						</div>
					</DialogHeader>

					<div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
						<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
							<div className="space-y-2 lg:col-span-2">
								<Label>Empresa</Label>
								<Select value={businessId} onValueChange={setBusinessId}>
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
								<Label htmlFor="purchase-customer">Cliente</Label>
								<Input
									id="purchase-customer"
									placeholder="Quien entrega los cheques"
									value={customerName}
									onChange={(event) => setCustomerName(event.target.value)}
									required
								/>
								<p className="text-muted-foreground text-xs">
									Si es nuevo, se crea automáticamente.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="purchase-date">Fecha de operación</Label>
								<Input
									id="purchase-date"
									type="date"
									value={purchaseDate}
									onChange={(event) => setPurchaseDate(event.target.value)}
									required
								/>
							</div>
						</div>

						<div className="grid gap-4 md:grid-cols-3">
							<div className="space-y-2">
								<Label htmlFor="purchase-fee">Pesificación (%)</Label>
								<Input
									id="purchase-fee"
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
								<Label htmlFor="purchase-interest">Interés mensual (%)</Label>
								<Input
									id="purchase-interest"
									type="number"
									min="0"
									step="0.01"
									placeholder="0,00"
									value={monthlyInterestRate}
									onChange={(event) => setMonthlyInterestRate(event.target.value)}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="purchase-about">Descripción (opcional)</Label>
								<Textarea
									id="purchase-about"
									rows={1}
									value={about}
									onChange={(event) => setAbout(event.target.value)}
								/>
							</div>
						</div>

						<div className="space-y-3">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="font-medium">Cheques</h3>
									<p className="text-muted-foreground text-xs">
										Moneda de esta etapa: ARS.
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() =>
										setChecks((current) => [
											...current,
											newCheckDraft(purchaseDate || dateInputValue(new Date())),
										])
									}
								>
									<Plus className="size-4" />
									Agregar cheque
								</Button>
							</div>

							<div className="overflow-x-auto rounded-lg border">
								<Table className="min-w-[1100px]">
									<TableHeader>
										<TableRow>
											<TableHead className="w-10">#</TableHead>
											<TableHead>Fecha cobro</TableHead>
											<TableHead className="w-24">Clearing</TableHead>
											<TableHead>Valor nominal</TableHead>
											<TableHead>Librador</TableHead>
											<TableHead>Número</TableHead>
											<TableHead>Banco</TableHead>
											<TableHead className="text-right">Días</TableHead>
											<TableHead className="text-right">Neto</TableHead>
											<TableHead className="w-10" />
										</TableRow>
									</TableHeader>
									<TableBody>
										{checks.length === 0 && (
											<TableRow>
												<TableCell colSpan={10} className="text-muted-foreground h-24 text-center">
													Agregá al menos un cheque.
												</TableCell>
											</TableRow>
										)}
										{checks.map((check, index) => {
											const values = calculatedChecks[index];
											return (
												<TableRow key={check.id}>
													<TableCell>
														<Badge variant="secondary">{index + 1}</Badge>
													</TableCell>
													<TableCell>
														<Input
															type="date"
															value={check.collectionDate}
															onChange={(event) =>
																updateCheck(check.id, { collectionDate: event.target.value })
															}
															required
														/>
													</TableCell>
													<TableCell>
														<Input
															type="number"
															min="0"
															step="1"
															value={check.bankClearing}
															onChange={(event) =>
																updateCheck(check.id, { bankClearing: event.target.value })
															}
															required
														/>
													</TableCell>
													<TableCell>
														<Input
															type="number"
															min="0.01"
															step="0.01"
															placeholder="0,00"
															value={check.grossValue}
															onChange={(event) =>
																updateCheck(check.id, { grossValue: event.target.value })
															}
															required
														/>
													</TableCell>
													<TableCell>
														<Input
															placeholder="Nombre / razón social"
															value={check.checkWriter}
															onChange={(event) =>
																updateCheck(check.id, { checkWriter: event.target.value })
															}
															required
														/>
													</TableCell>
													<TableCell>
														<Input
															placeholder="00000000"
															value={check.checkNumber}
															onChange={(event) =>
																updateCheck(check.id, { checkNumber: event.target.value })
															}
															required
														/>
													</TableCell>
													<TableCell>
														<Input
															placeholder="Banco"
															value={check.bankName}
															onChange={(event) =>
																updateCheck(check.id, { bankName: event.target.value })
															}
															required
														/>
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{values?.totalDays ?? "—"}
													</TableCell>
													<TableCell className="text-right font-medium tabular-nums">
														{values ? formatPrice(values.netValue) : "—"}
													</TableCell>
													<TableCell>
														<Button
															type="button"
															variant="ghost"
															size="icon-sm"
															onClick={() => removeCheck(check.id)}
															aria-label={`Eliminar cheque ${index + 1}`}
														>
															<Trash2 className="text-destructive size-4" />
														</Button>
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
						</div>

						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<TotalCard label="Bruto nominal" value={totals.gross} />
							<TotalCard label="Pesificación" value={totals.serviceFee} tone="positive" />
							<TotalCard label="Interés corrido" value={totals.interest} tone="positive" />
							<TotalCard label="Neto a pagar" value={totals.net} emphasis />
						</div>
					</div>

					<DialogFooter className="mx-0 mb-0 px-6">
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
							disabled={purchaseMutation.isPending}
						>
							Cancelar
						</Button>
						<Button type="submit" disabled={purchaseMutation.isPending}>
							{purchaseMutation.isPending
								? "Registrando…"
								: `Registrar ${checks.length} cheque${checks.length === 1 ? "" : "s"}`}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function TotalCard({
	label,
	value,
	tone,
	emphasis,
}: {
	label: string;
	value: number;
	tone?: "positive";
	emphasis?: boolean;
}) {
	return (
		<div
			className={
				emphasis
					? "bg-primary text-primary-foreground rounded-lg border p-4"
					: "bg-muted/40 rounded-lg border p-4"
			}
		>
			<p
				className={
					emphasis ? "text-primary-foreground/70 text-xs" : "text-muted-foreground text-xs"
				}
			>
				{label}
			</p>
			<p
				className={`mt-1 text-lg font-semibold tabular-nums ${tone === "positive" && !emphasis ? "text-emerald-600" : ""}`}
			>
				{formatPrice(value)}
			</p>
		</div>
	);
}
