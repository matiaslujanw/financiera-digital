"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "~/trpc/react";
import { ACCOUNT_TYPE_LABELS } from "~/utils/format";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";

const NONE = "__none__";

function dateInputValue(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dateAtNoon(value: string): Date {
	return new Date(`${value}T12:00:00`);
}

export function CreateTransactionInline({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [businessId, setBusinessId] = useState("");
	const [fromAccountId, setFromAccountId] = useState<string>(NONE);
	const [toAccountId, setToAccountId] = useState("");
	const [decrement, setDecrement] = useState("");
	const [increment, setIncrement] = useState("");
	const [about, setAbout] = useState("");
	const [date, setDate] = useState(() => dateInputValue(new Date()));

	const businessesQuery = useQuery(
		trpc.business.byGuildSlug.queryOptions({ guildSlug }),
	);
	const accountsQuery = useQuery(
		trpc.dictionaryAccount.byGuildSlug.queryOptions({ guildSlug }),
	);

	// Núcleo listo: sólo cuentas sin subcuenta (las agregadas exigen entidad).
	const accounts = useMemo(
		() => (accountsQuery.data ?? []).filter((a) => !a.hasSubAccounts),
		[accountsQuery.data],
	);

	const resolvedBusinessId = businessId || businessesQuery.data?.[0]?.id || "";
	const fromAccount =
		fromAccountId === NONE
			? undefined
			: accounts.find((a) => a.id === fromAccountId);
	const toAccount = accounts.find((a) => a.id === toAccountId);
	const currencyMismatch =
		fromAccount && toAccount && fromAccount.currency !== toAccount.currency;

	const createMut = useMutation(
		trpc.transaction.create.mutationOptions({
			onSuccess: () => {
				toast.success("Transacción registrada");
				void queryClient.invalidateQueries();
				reset();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function reset() {
		setFromAccountId(NONE);
		setToAccountId("");
		setDecrement("");
		setIncrement("");
		setAbout("");
		setDate(dateInputValue(new Date()));
	}

	function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!resolvedBusinessId) return toast.error("Elegí una empresa");
		if (!toAccountId) return toast.error("Elegí la cuenta hacia");
		if (fromAccount && fromAccountId === toAccountId) {
			return toast.error("La cuenta desde y hacia no pueden ser la misma");
		}
		if (currencyMismatch) {
			return toast.error("Monedas distintas: usá «Cambiar divisas»");
		}
		const dec = decrement.trim();
		const inc = increment.trim();
		if ((dec && inc) || (!dec && !inc)) {
			return toast.error("Completá decremento o incremento (uno solo)");
		}

		createMut.mutate({
			guildSlug,
			toBusinessId: resolvedBusinessId,
			toAccountId,
			fromBusinessId: fromAccount ? resolvedBusinessId : undefined,
			fromAccountId: fromAccount ? fromAccountId : undefined,
			date: dateAtNoon(date),
			movement: inc ? { increment: inc } : { decrement: dec },
			about: about.trim() || undefined,
		});
	}

	return (
		<form
			onSubmit={submit}
			className="border-primary/40 bg-primary/[0.04] rounded-xl border p-4"
		>
			<div className="mb-3 flex items-center gap-2">
				<div className="bg-primary/10 text-primary rounded-md p-1.5">
					<Plus className="size-4" />
				</div>
				<h2 className="text-sm font-semibold">Crear transacción</h2>
				<span className="text-muted-foreground text-xs">
					Ingreso, egreso o transferencia entre cuentas
				</span>
			</div>

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<div className="space-y-1.5">
					<Label className="text-xs">Empresa</Label>
					<Select value={resolvedBusinessId} onValueChange={setBusinessId}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Empresa" />
						</SelectTrigger>
						<SelectContent>
							{businessesQuery.data?.map((b) => (
								<SelectItem key={b.id} value={b.id}>
									{b.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-1.5">
					<Label className="text-xs">Cuenta desde (opcional)</Label>
					<Select value={fromAccountId} onValueChange={setFromAccountId}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="—" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NONE}>— Sin origen (ingreso/egreso)</SelectItem>
							{accounts.map((a) => (
								<SelectItem key={a.id} value={a.id}>
									{a.name}
									<span className="text-muted-foreground ml-2 text-xs">
										{ACCOUNT_TYPE_LABELS[a.accountType]} · {a.currency}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-1.5">
					<Label className="text-xs">
						{fromAccount ? "Cuenta hacia" : "Cuenta"}
					</Label>
					<Select value={toAccountId} onValueChange={setToAccountId}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Seleccionar cuenta" />
						</SelectTrigger>
						<SelectContent>
							{accounts.map((a) => (
								<SelectItem key={a.id} value={a.id}>
									{a.name}
									<span className="text-muted-foreground ml-2 text-xs">
										{ACCOUNT_TYPE_LABELS[a.accountType]} · {a.currency}
									</span>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="space-y-1.5">
					<Label className="text-xs">Fecha</Label>
					<Input
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
						onInput={(e) => setDate(e.currentTarget.value)}
					/>
				</div>

				<div className="space-y-1.5">
					<Label className="text-destructive text-xs">$ Decremento</Label>
					<Input
						inputMode="decimal"
						placeholder="0,00"
						value={decrement}
						disabled={increment.trim().length > 0}
						onChange={(e) => setDecrement(e.target.value)}
						className="font-mono tabular-nums"
					/>
				</div>

				<div className="space-y-1.5">
					<Label className="text-primary text-xs">$ Incremento</Label>
					<Input
						inputMode="decimal"
						placeholder="0,00"
						value={increment}
						disabled={decrement.trim().length > 0}
						onChange={(e) => setIncrement(e.target.value)}
						className="font-mono tabular-nums"
					/>
				</div>

				<div className="space-y-1.5 md:col-span-2">
					<Label className="text-xs">Descripción</Label>
					<Input
						placeholder="Opcional"
						value={about}
						onChange={(e) => setAbout(e.target.value)}
					/>
				</div>
			</div>

			<div className="mt-3 flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">
					{currencyMismatch ? (
						<span className="text-destructive">
							Monedas distintas — usá «Cambiar divisas».
						</span>
					) : fromAccount && toAccount ? (
						<span className="inline-flex items-center gap-1">
							{fromAccount.name} <ArrowRight className="size-3" /> {toAccount.name}
						</span>
					) : (
						"Dejá «Cuenta desde» vacío para un ingreso o egreso simple."
					)}
				</p>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={reset}
						disabled={createMut.isPending}
						className="gap-1.5"
					>
						<RotateCcw className="size-3.5" />
						Limpiar
					</Button>
					<Button type="submit" size="sm" disabled={createMut.isPending} className="gap-1.5">
						<Plus className="size-4" />
						{createMut.isPending ? "Registrando…" : "Registrar"}
					</Button>
				</div>
			</div>
		</form>
	);
}
