"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { useTRPC } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { ACCOUNT_TYPE_LABELS } from "~/utils/format";
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

type Direction = "increment" | "decrement";

export function CreateTransactionDialog({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [open, setOpen] = useState(false);
	const [businessId, setBusinessId] = useState<string>("");
	const [accountId, setAccountId] = useState<string>(""); // dictionaryAccount id
	const [direction, setDirection] = useState<Direction>("increment");
	const [amount, setAmount] = useState<string>("");
	const [about, setAbout] = useState<string>("");

	const businessesQuery = useQuery(
		trpc.business.byGuildSlug.queryOptions({ guildSlug }),
	);
	const accountsQuery = useQuery(
		trpc.dictionaryAccount.byGuildSlug.queryOptions({ guildSlug }),
	);

	// En Fase 1 sólo cuentas colectivas (sin subcuentas por entidad).
	const accounts = useMemo(
		() => (accountsQuery.data ?? []).filter((a) => !a.hasSubAccounts),
		[accountsQuery.data],
	);

	const createMut = useMutation(
		trpc.transaction.create.mutationOptions({
			onSuccess: () => {
				toast.success("Transacción creada");
				void queryClient.invalidateQueries();
				reset();
				setOpen(false);
			},
			onError: (e) => toast.error(e.message),
		}),
	);

	function reset() {
		setAccountId("");
		setDirection("increment");
		setAmount("");
		setAbout("");
	}

	// Default: primera empresa al abrir.
	function onOpenChange(next: boolean) {
		if (next && !businessId && businessesQuery.data?.[0]) {
			setBusinessId(businessesQuery.data[0].id);
		}
		if (!next) reset();
		setOpen(next);
	}

	function submit() {
		if (!businessId) return toast.error("Elegí una empresa");
		if (!accountId) return toast.error("Elegí una cuenta");
		const value = parseFloat(amount.replace(",", "."));
		if (!value || value <= 0) return toast.error("Ingresá un monto mayor a 0");

		createMut.mutate({
			guildSlug,
			toBusinessId: businessId,
			toAccountId: accountId,
			date: new Date(),
			movement:
				direction === "increment"
					? { increment: amount }
					: { decrement: amount },
			about: about || undefined,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" className="gap-2">
					<Plus className="size-4" />
					Nueva transacción
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Nueva transacción</DialogTitle>
					<DialogDescription>
						Registrá un ingreso o egreso en una cuenta.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label>Empresa</Label>
						<Select value={businessId} onValueChange={setBusinessId}>
							<SelectTrigger>
								<SelectValue placeholder="Seleccionar empresa" />
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

					<div className="flex flex-col gap-2">
						<Label>Cuenta</Label>
						<Select value={accountId} onValueChange={setAccountId}>
							<SelectTrigger>
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

					<div className="grid grid-cols-2 gap-2">
						<button
							type="button"
							onClick={() => setDirection("increment")}
							className={cn(
								"flex items-center justify-center gap-2 rounded-md border p-2 text-sm font-medium transition-colors",
								direction === "increment"
									? "border-emerald-600 bg-emerald-600/10 text-emerald-500"
									: "text-muted-foreground hover:bg-accent",
							)}
						>
							<TrendingUp className="size-4" />
							Ingreso
						</button>
						<button
							type="button"
							onClick={() => setDirection("decrement")}
							className={cn(
								"flex items-center justify-center gap-2 rounded-md border p-2 text-sm font-medium transition-colors",
								direction === "decrement"
									? "border-red-600 bg-red-600/10 text-red-500"
									: "text-muted-foreground hover:bg-accent",
							)}
						>
							<TrendingDown className="size-4" />
							Egreso
						</button>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="amount">Monto</Label>
						<Input
							id="amount"
							inputMode="decimal"
							placeholder="0,00"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="about">Descripción (opcional)</Label>
						<Textarea
							id="about"
							rows={2}
							value={about}
							onChange={(e) => setAbout(e.target.value)}
						/>
					</div>
				</div>

				<DialogFooter>
					<Button onClick={submit} disabled={createMut.isPending}>
						{createMut.isPending ? "Creando…" : "Crear transacción"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
