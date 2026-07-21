"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CircleX, ClipboardList, Landmark } from "lucide-react";
import { toast } from "sonner";

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
import { useTRPC } from "~/trpc/react";
import { dayjs } from "~/utils/dayjs";
import { formatPrice } from "~/utils/format";

type CheckStatus = "PURCHASED" | "SOLD" | "DEPOSITED" | "REJECTED";
type StatusFilter = "ALL" | CheckStatus;
type Action = { kind: "deposit" | "reject"; checkId: string } | null;

function dateInputValue(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function dateAtNoon(value: string): Date {
	return new Date(`${value}T12:00:00`);
}

export function ManageChecksDialog({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [businessId, setBusinessId] = useState("");
	const [filter, setFilter] = useState<StatusFilter>("ALL");
	const [action, setAction] = useState<Action>(null);
	const [actionDate, setActionDate] = useState("");
	const [destinationAccountId, setDestinationAccountId] = useState("");
	const [reason, setReason] = useState("");
	const [about, setAbout] = useState("");

	const businessesQuery = useQuery(
		trpc.business.byGuildSlug.queryOptions({ guildSlug }),
	);
	const checksQuery = useQuery(
		trpc.check.byBusiness.queryOptions(
			{ guildSlug, businessId },
			{ enabled: open && !!businessId },
		),
	);
	const accountsQuery = useQuery(
		trpc.accountOnBusiness.guildSummary.queryOptions(
			{ guildSlug },
			{ enabled: open },
		),
	);

	const availableAccounts = useMemo(
		() =>
			accountsQuery.data
				?.find((business) => business.id === businessId)
				?.accounts.filter(
					(account) => account.availability && account.currency === "ARS",
				) ?? [],
		[accountsQuery.data, businessId],
	);
	const checks = useMemo(() => checksQuery.data ?? [], [checksQuery.data]);
	const filteredChecks = useMemo(
		() =>
			filter === "ALL"
				? checks
				: checks.filter((check) => check.status === filter),
		[checks, filter],
	);
	const selectedCheck = action
		? checks.find((check) => check.id === action.checkId)
		: undefined;
	const statusCounts = useMemo(
		() =>
			checks.reduce(
				(counts, check) => {
					counts[check.status] += 1;
					return counts;
				},
				{ PURCHASED: 0, SOLD: 0, DEPOSITED: 0, REJECTED: 0 } as Record<CheckStatus, number>,
			),
		[checks],
	);

	function resetAction() {
		setAction(null);
		setActionDate(dateInputValue(new Date()));
		setDestinationAccountId(availableAccounts[0]?.id ?? "");
		setReason("");
		setAbout("");
	}

	function startAction(kind: "deposit" | "reject", checkId: string) {
		setAction({ kind, checkId });
		setActionDate(dateInputValue(new Date()));
		setDestinationAccountId(availableAccounts[0]?.id ?? "");
		setReason("");
		setAbout("");
	}

	const depositMutation = useMutation(
		trpc.check.deposit.mutationOptions({
			onSuccess: (result) => {
				toast.success("Cheque depositado", {
					description: `${formatPrice(result.grossValue)} ingresaron a ${result.destination}`,
				});
				void queryClient.invalidateQueries();
				resetAction();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const rejectMutation = useMutation(
		trpc.check.reject.mutationOptions({
			onSuccess: (result) => {
				toast.error("Cheque marcado como rechazado", {
					description: `Reclamar ${formatPrice(result.grossValue)} a ${result.sellerName}${result.buyerName ? ` · Responder a ${result.buyerName}` : ""}`,
				});
				void queryClient.invalidateQueries();
				resetAction();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	function onOpenChange(next: boolean) {
		if (next) {
			setBusinessId((current) => current || businessesQuery.data?.[0]?.id || "");
			setActionDate(dateInputValue(new Date()));
		}
		if (!next) resetAction();
		setOpen(next);
	}

	function submitDeposit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!action || action.kind !== "deposit" || !actionDate) return;
		if (!destinationAccountId) {
			return toast.error("Elegí la cuenta donde se acredita el cheque");
		}
		depositMutation.mutate({
			guildSlug,
			businessId,
			checkId: action.checkId,
			depositDate: dateAtNoon(actionDate),
			destinationAccountId,
			about: about.trim() || undefined,
		});
	}

	function submitRejection(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!action || action.kind !== "reject" || !actionDate) return;
		if (reason.trim().length < 2) {
			return toast.error("Indicá el motivo o la información del rechazo");
		}
		rejectMutation.mutate({
			guildSlug,
			businessId,
			checkId: action.checkId,
			rejectionDate: dateAtNoon(actionDate),
			reason: reason.trim(),
		});
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline" className="gap-2">
					<ClipboardList className="size-4" />
					Estado de cheques
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[96vw]">
				<DialogHeader className="border-b px-6 py-5">
					<DialogTitle>Estado y seguimiento de cheques</DialogTitle>
					<DialogDescription>
						Consultá quién entregó cada cheque, a quién se vendió y registrá depósitos o rechazos.
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 space-y-5 overflow-y-auto px-6 pb-6">
					<div className="grid gap-4 md:grid-cols-[minmax(240px,1fr)_2fr]">
						<div className="space-y-2">
							<Label>Empresa</Label>
							<Select
								value={businessId}
								onValueChange={(value) => {
									setBusinessId(value);
									setAction(null);
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
						<div className="flex flex-wrap items-end gap-2">
							<FilterButton active={filter === "ALL"} onClick={() => setFilter("ALL")} label="Todos" count={checks.length} />
							<FilterButton active={filter === "PURCHASED"} onClick={() => setFilter("PURCHASED")} label="En cartera" count={statusCounts.PURCHASED} />
							<FilterButton active={filter === "SOLD"} onClick={() => setFilter("SOLD")} label="Vendidos" count={statusCounts.SOLD} />
							<FilterButton active={filter === "REJECTED"} onClick={() => setFilter("REJECTED")} label="Rechazados" count={statusCounts.REJECTED} />
							<FilterButton active={filter === "DEPOSITED"} onClick={() => setFilter("DEPOSITED")} label="Depositados" count={statusCounts.DEPOSITED} />
						</div>
					</div>

					{action?.kind === "deposit" && selectedCheck && (
						<form onSubmit={submitDeposit} className="border-primary/30 bg-primary/5 grid gap-4 rounded-lg border p-4 md:grid-cols-4">
							<div className="md:col-span-4">
								<h3 className="flex items-center gap-2 font-medium"><Landmark className="size-4" /> Depositar cheque {selectedCheck.checkNumber || "sin número"}</h3>
								<p className="text-muted-foreground mt-1 text-xs">Sale de cartera por {formatPrice(selectedCheck.netValue)} e ingresa su nominal de {formatPrice(selectedCheck.grossValue)}.</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="check-deposit-date">Fecha</Label>
								<Input id="check-deposit-date" type="date" value={actionDate} onChange={(event) => setActionDate(event.target.value)} required />
							</div>
							<div className="space-y-2">
								<Label>Cuenta de acreditación</Label>
								<Select value={destinationAccountId} onValueChange={setDestinationAccountId}>
									<SelectTrigger className="w-full"><SelectValue placeholder="Banco o Efectivo" /></SelectTrigger>
									<SelectContent>{availableAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name}</SelectItem>)}</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="check-deposit-about">Nota</Label>
								<Input id="check-deposit-about" value={about} onChange={(event) => setAbout(event.target.value)} placeholder="Opcional" />
							</div>
							<div className="flex items-end justify-end gap-2">
								<Button type="button" variant="ghost" onClick={resetAction}>Cancelar</Button>
								<Button type="submit" disabled={depositMutation.isPending}>{depositMutation.isPending ? "Depositando…" : "Confirmar depósito"}</Button>
							</div>
						</form>
					)}

					{action?.kind === "reject" && selectedCheck && (
						<form onSubmit={submitRejection} className="border-destructive/30 bg-destructive/5 grid gap-4 rounded-lg border p-4 md:grid-cols-4">
							<div className="md:col-span-4">
								<h3 className="text-destructive flex items-center gap-2 font-medium"><CircleX className="size-4" /> Rechazar cheque {selectedCheck.checkNumber || "sin número"}</h3>
								<p className="text-muted-foreground mt-1 text-xs">
									Reclamo a <strong>{selectedCheck.person?.name || "vendedor sin identificar"}</strong> por {formatPrice(selectedCheck.grossValue)}
									{selectedCheck.status === "SOLD" && selectedCheck.buyerPerson ? <> · El cheque fue vendido a <strong>{selectedCheck.buyerPerson.name}</strong> y se registrará la obligación correspondiente.</> : <> · El cheque saldrá de cartera.</>}
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="check-rejection-date">Fecha</Label>
								<Input id="check-rejection-date" type="date" value={actionDate} onChange={(event) => setActionDate(event.target.value)} required />
							</div>
							<div className="space-y-2 md:col-span-2">
								<Label htmlFor="check-rejection-reason">Motivo / seguimiento</Label>
								<Textarea id="check-rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej.: sin fondos, avisó el comprador…" required />
							</div>
							<div className="flex items-end justify-end gap-2">
								<Button type="button" variant="ghost" onClick={resetAction}>Cancelar</Button>
								<Button type="submit" variant="destructive" disabled={rejectMutation.isPending}>{rejectMutation.isPending ? "Registrando…" : "Confirmar rechazo"}</Button>
							</div>
						</form>
					)}

					<div className="overflow-x-auto rounded-lg border">
						<Table className="min-w-[1450px]">
							<TableHeader>
								<TableRow>
									<TableHead>Estado</TableHead>
									<TableHead>Cheque</TableHead>
									<TableHead>Vencimiento</TableHead>
									<TableHead>Comprado a</TableHead>
									<TableHead>Vendido a</TableHead>
									<TableHead className="text-right">Nominal</TableHead>
									<TableHead className="text-right">Costo compra</TableHead>
									<TableHead className="text-right">Valor venta</TableHead>
									<TableHead>Seguimiento</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{checksQuery.isLoading && <TableRow><TableCell colSpan={10} className="text-muted-foreground h-24 text-center">Cargando cheques…</TableCell></TableRow>}
								{!checksQuery.isLoading && filteredChecks.length === 0 && <TableRow><TableCell colSpan={10} className="text-muted-foreground h-24 text-center">No hay cheques para este filtro.</TableCell></TableRow>}
								{filteredChecks.map((check) => {
									const reachedCollectionDate = !dayjs().startOf("day").isBefore(dayjs(check.collectionDate).startOf("day"));
									return (
										<TableRow key={check.id} className={check.status === "REJECTED" ? "bg-destructive/5" : undefined}>
											<TableCell><StatusBadge status={check.status} /></TableCell>
											<TableCell><div className="font-medium">{check.checkNumber || "Sin número"}</div><div className="text-muted-foreground text-xs">{check.bankName || "Sin banco"} · {check.checkWriter}</div></TableCell>
											<TableCell className="whitespace-nowrap">{dayjs(check.collectionDate).format("DD/MM/YY")}</TableCell>
											<TableCell><div className="font-medium">{check.person?.name || "—"}</div><div className="text-muted-foreground text-xs">Vendedor original</div></TableCell>
											<TableCell>{check.buyerPerson ? <><div className="font-medium">{check.buyerPerson.name}</div><div className="text-muted-foreground text-xs">{check.saleDate ? dayjs(check.saleDate).format("DD/MM/YY") : "—"}</div></> : "—"}</TableCell>
											<TableCell className="text-right tabular-nums">{formatPrice(check.grossValue)}</TableCell>
											<TableCell className="text-right tabular-nums">{formatPrice(check.netValue)}</TableCell>
											<TableCell className="text-right tabular-nums">{check.saleNetValue ? formatPrice(check.saleNetValue) : "—"}</TableCell>
											<TableCell className="max-w-xs">
												{check.status === "REJECTED" ? <><div className="text-destructive font-medium">Reclamar a {check.person?.name || "vendedor"}</div><div className="text-muted-foreground truncate text-xs">{check.rejectionReason || "Sin detalle"}</div><div className="text-muted-foreground text-xs">{check.rejectionDate ? dayjs(check.rejectionDate).format("DD/MM/YY") : "—"}{check.rejectedFromStatus === "SOLD" && check.buyerPerson ? ` · Responder a ${check.buyerPerson.name}` : ""}</div></> : check.status === "DEPOSITED" ? <><div>{check.depositAccount?.name ?? check.depositAccount?.dictionaryAccount?.name ?? "Cuenta de depósito"}</div><div className="text-muted-foreground text-xs">{check.depositDate ? dayjs(check.depositDate).format("DD/MM/YY") : "—"}</div></> : !reachedCollectionDate ? <span className="text-muted-foreground text-xs">Faltan {dayjs(check.collectionDate).startOf("day").diff(dayjs().startOf("day"), "day")} días</span> : <span className="text-muted-foreground text-xs">Listo para gestionar</span>}
											</TableCell>
											<TableCell>
												<div className="flex justify-end gap-2">
													{check.status === "PURCHASED" && <Button type="button" size="sm" variant="outline" disabled={!reachedCollectionDate} onClick={() => startAction("deposit", check.id)}><Landmark className="size-4" /> Depositar</Button>}
													{(check.status === "PURCHASED" || check.status === "SOLD") && <Button type="button" size="sm" variant="destructive" disabled={!reachedCollectionDate} onClick={() => startAction("reject", check.id)}><CircleX className="size-4" /> Rechazar</Button>}
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function FilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
	return <Button type="button" size="sm" variant={active ? "default" : "outline"} onClick={onClick}>{label}<Badge variant={active ? "secondary" : "outline"}>{count}</Badge></Button>;
}

function StatusBadge({ status }: { status: CheckStatus }) {
	if (status === "REJECTED") return <Badge variant="destructive"><CircleX /> Rechazado</Badge>;
	if (status === "DEPOSITED") return <Badge className="bg-emerald-600 text-white"><BadgeCheck /> Depositado</Badge>;
	if (status === "SOLD") return <Badge variant="secondary">Vendido</Badge>;
	return <Badge variant="outline">En cartera</Badge>;
}
