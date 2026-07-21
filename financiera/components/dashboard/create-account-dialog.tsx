"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import type { AccountType, Currency } from "~/server/db/schema";
import { useTRPC } from "~/trpc/react";
import {
	ACCOUNT_TYPE_LABELS,
	CURRENCIES,
	CURRENCY_LABELS,
} from "~/utils/format";
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

const accountTypes: AccountType[] = ["ASSET", "LIABILITY", "REVENUE", "EXPENSE"];

export function CreateAccountDialog(props: {
	guildSlug: string;
	onCreated?: (accountId: string) => void;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [businessId, setBusinessId] = useState("");
	const [name, setName] = useState("");
	const [accountType, setAccountType] = useState<AccountType>("ASSET");
	const [currency, setCurrency] = useState<Currency>("USD");

	const businesses = useQuery(
		trpc.business.byGuildSlug.queryOptions({ guildSlug: props.guildSlug }),
	);
	const createAccount = useMutation(
		trpc.accountOnBusiness.create.mutationOptions({
			onSuccess: (account) => {
				toast.success(`${account.name} creada en ${account.currency}`);
				void queryClient.invalidateQueries();
				props.onCreated?.(account.id);
				setOpen(false);
				reset();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function reset() {
		setName("");
		setAccountType("ASSET");
		setCurrency("USD");
	}

	function onOpenChange(next: boolean) {
		if (next && !businessId && businesses.data?.[0]) {
			setBusinessId(businesses.data[0].id);
		}
		if (!next) reset();
		setOpen(next);
	}

	function submit() {
		if (!businessId) return toast.error("Elegí una empresa");
		if (name.trim().length < 2) return toast.error("Ingresá un nombre de cuenta");
		createAccount.mutate({
			guildSlug: props.guildSlug,
			businessId,
			name: name.trim(),
			accountType,
			currency,
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline">
					<Plus className="size-4" />
					Nueva
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Nueva cuenta</DialogTitle>
					<DialogDescription>
						Creá una cuenta operativa con su tipo contable y moneda. El saldo inicial será cero.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label>Empresa</Label>
						<Select value={businessId} onValueChange={setBusinessId}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Seleccionar empresa" />
							</SelectTrigger>
							<SelectContent>
								{businesses.data?.map((business) => (
									<SelectItem key={business.id} value={business.id}>
										{business.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-2">
						<Label htmlFor="account-name">Nombre</Label>
						<Input
							id="account-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Ej. Caja USD, Banco EUR"
						/>
					</div>

					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-2">
							<Label>Tipo contable</Label>
							<Select
								value={accountType}
								onValueChange={(value) => setAccountType(value as AccountType)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{accountTypes.map((type) => (
										<SelectItem key={type} value={type}>
											{ACCOUNT_TYPE_LABELS[type]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label>Moneda</Label>
							<Select
								value={currency}
								onValueChange={(value) => setCurrency(value as Currency)}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{CURRENCIES.map((item) => (
										<SelectItem key={item} value={item}>
											{item} · {CURRENCY_LABELS[item]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button onClick={submit} disabled={createAccount.isPending}>
						{createAccount.isPending ? "Creando…" : "Crear cuenta"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
