"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "~/trpc/react";
import { formatCurrency } from "~/utils/format";
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
import { Textarea } from "~/components/ui/textarea";

function dateInputValue(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, "0");
	const day = `${date.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function numberInput(value: string): number {
	const normalized = value.includes(",")
		? value.replace(/\./g, "").replace(",", ".")
		: value;
	return Number.parseFloat(normalized) || 0;
}

export function CurrencyExchangeDialog({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [businessId, setBusinessId] = useState("");
	const [fromAccountId, setFromAccountId] = useState("");
	const [toAccountId, setToAccountId] = useState("");
	const [quantity, setQuantity] = useState("");
	const [rate, setRate] = useState("");
	const [date, setDate] = useState(() => dateInputValue(new Date()));
	const [about, setAbout] = useState("");

	const summary = useQuery(
		trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug }),
	);
	const selectedBusiness = summary.data?.find((item) => item.id === businessId);
	const assetAccounts = useMemo(
		() =>
			(selectedBusiness?.accounts ?? []).filter(
				(account) => account.accountType === "ASSET",
			),
		[selectedBusiness],
	);
	const fromAccount = assetAccounts.find((account) => account.id === fromAccountId);
	const toAccount = assetAccounts.find((account) => account.id === toAccountId);
	const destinationAccounts = assetAccounts.filter(
		(account) =>
			account.id !== fromAccount?.id &&
			(!fromAccount || account.currency !== fromAccount.currency),
	);

	const quantityValue = numberInput(quantity);
	const rateValue = numberInput(rate);
	const isPurchase = fromAccount?.currency === "ARS" && toAccount?.currency !== "ARS";
	const isSale = fromAccount?.currency !== "ARS" && toAccount?.currency === "ARS";
	const sourceAmount =
		isPurchase && rateValue > 0 ? quantityValue * rateValue : quantityValue;
	const destinationAmount =
		isPurchase
			? quantityValue
			: quantityValue > 0 && rateValue > 0
				? quantityValue * rateValue
				: 0;
	const rateDirection = isPurchase ? "TO_FROM" : "FROM_TO";
	const operationTitle = isPurchase
		? `Comprar ${toAccount?.currency ?? "divisas"}`
		: isSale
			? `Vender ${fromAccount?.currency ?? "divisas"}`
			: fromAccount && toAccount
				? `Cambiar ${fromAccount.currency} a ${toAccount.currency}`
				: "Cambiar divisas";
	const quantityCurrency = isPurchase ? toAccount?.currency : fromAccount?.currency;
	const quoteBaseCurrency = isPurchase ? toAccount?.currency : fromAccount?.currency;
	const quoteCurrency = isPurchase ? fromAccount?.currency : toAccount?.currency;

	const exchange = useMutation(
		trpc.transaction.exchangeCurrency.mutationOptions({
			onSuccess: (result) => {
				toast.success(`${result.operationName} registrada · ${result.quote}`);
				void queryClient.invalidateQueries();
				setOpen(false);
				reset();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function reset() {
		setFromAccountId("");
		setToAccountId("");
		setQuantity("");
		setRate("");
		setDate(dateInputValue(new Date()));
		setAbout("");
	}

	function onOpenChange(next: boolean) {
		if (next && !businessId && summary.data?.[0]) {
			setBusinessId(summary.data[0].id);
		}
		if (!next) reset();
		setOpen(next);
	}

	function changeBusiness(nextBusinessId: string) {
		setBusinessId(nextBusinessId);
		setFromAccountId("");
		setToAccountId("");
		setQuantity("");
		setRate("");
	}

	function changeSource(accountId: string) {
		setFromAccountId(accountId);
		setToAccountId("");
		setQuantity("");
		setRate("");
	}

	function swapAccounts() {
		if (!fromAccount || !toAccount) return;
		setFromAccountId(toAccount.id);
		setToAccountId(fromAccount.id);
		setQuantity("");
		setRate("");
	}

	function submit() {
		if (!businessId || !fromAccount || !toAccount) {
			return toast.error("Elegí las cuentas de origen y destino");
		}
		if (quantityValue <= 0) return toast.error("Ingresá una cantidad mayor a cero");
		if (rateValue <= 0) return toast.error("Ingresá una cotización mayor a cero");
		if (sourceAmount <= 0 || destinationAmount <= 0) {
			return toast.error("Los montos calculados no son válidos");
		}

		exchange.mutate({
			guildSlug,
			businessId,
			fromAccountId: fromAccount.id,
			toAccountId: toAccount.id,
			date: new Date(`${date}T12:00:00`),
			sourceAmount,
			exchangeRate: rateValue,
			rateDirection,
			about: about.trim() || undefined,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<ArrowLeftRight className="size-4" />
					Cambiar divisas
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{operationTitle}</DialogTitle>
					<DialogDescription>
						La cuenta de origen entrega fondos y la cuenta destino recibe la otra moneda.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label>Empresa</Label>
						<Select value={businessId} onValueChange={changeBusiness}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Seleccionar empresa" />
							</SelectTrigger>
							<SelectContent>
								{summary.data?.map((business) => (
									<SelectItem key={business.id} value={business.id}>
										{business.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
						<div className="grid gap-2">
							<Label>Cuenta que entrega</Label>
							<Select value={fromAccountId} onValueChange={changeSource}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Cuenta origen" />
								</SelectTrigger>
								<SelectContent>
									{assetAccounts.map((account) => (
										<SelectItem key={account.id} value={account.id}>
											{account.name} · {formatCurrency(account.currentBalance, account.currency)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={swapAccounts}
							disabled={!fromAccount || !toAccount}
							aria-label="Invertir cuentas"
						>
							<ArrowLeftRight className="size-4" />
						</Button>
						<div className="grid gap-2">
							<Label>Cuenta que recibe</Label>
							<Select value={toAccountId} onValueChange={setToAccountId}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Cuenta destino" />
								</SelectTrigger>
								<SelectContent>
									{destinationAccounts.map((account) => (
										<SelectItem key={account.id} value={account.id}>
											{account.name} · {formatCurrency(account.currentBalance, account.currency)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{fromAccount && destinationAccounts.length === 0 && (
						<p className="text-amber-500 text-sm">
							No hay otra cuenta de Activo con una moneda distinta. Creala primero desde Cuentas.
						</p>
					)}

					<div className="grid gap-4 sm:grid-cols-3">
						<div className="grid gap-2">
							<Label htmlFor="exchange-quantity">
								{isPurchase ? "Cantidad a comprar" : isSale ? "Cantidad a vender" : "Cantidad de origen"}
							</Label>
							<div className="relative">
								<Input
									id="exchange-quantity"
									inputMode="decimal"
									value={quantity}
									onChange={(event) => setQuantity(event.target.value)}
									placeholder="0,00"
									className="pr-16"
								/>
								<span className="text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2 text-xs">
									{quantityCurrency ?? "—"}
								</span>
							</div>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="exchange-rate">Cotización</Label>
							<Input
								id="exchange-rate"
								inputMode="decimal"
								value={rate}
								onChange={(event) => setRate(event.target.value)}
								placeholder="0,00"
							/>
							<p className="text-muted-foreground text-xs">
								1 {quoteBaseCurrency ?? "—"} = X {quoteCurrency ?? "—"}
							</p>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="exchange-date">Fecha</Label>
							<Input
								id="exchange-date"
								type="date"
								value={date}
								onChange={(event) => setDate(event.target.value)}
							/>
						</div>
					</div>

					{fromAccount && toAccount && quantityValue > 0 && rateValue > 0 && (
						<div className="bg-muted/50 grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
							<div>
								<p className="text-muted-foreground text-xs uppercase">Sale de {fromAccount.name}</p>
								<p className="text-lg font-semibold tabular-nums">
									{formatCurrency(sourceAmount, fromAccount.currency)}
								</p>
							</div>
							<ArrowLeftRight className="text-muted-foreground size-5" />
							<div className="sm:text-right">
								<p className="text-muted-foreground text-xs uppercase">Entra en {toAccount.name}</p>
								<p className="text-lg font-semibold tabular-nums">
									{formatCurrency(destinationAmount, toAccount.currency)}
								</p>
							</div>
						</div>
					)}

					<div className="grid gap-2">
						<Label htmlFor="exchange-about">Descripción (opcional)</Label>
						<Textarea
							id="exchange-about"
							value={about}
							onChange={(event) => setAbout(event.target.value)}
							rows={2}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button onClick={submit} disabled={exchange.isPending}>
						{exchange.isPending ? "Registrando…" : operationTitle}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
