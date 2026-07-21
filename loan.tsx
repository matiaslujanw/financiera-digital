// Reemplaza el contenido completo de tu archivo de formulario de préstamo

"use client";

import { Currency, PaymentPeriodicityEnum } from "@acme/db/schema";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@acme/ui/command';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, useForm } from '@acme/ui/form';
import { Icons } from "@acme/ui/icons";
import { Input } from "@acme/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { toast } from "@acme/ui/toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { BellIcon, Check, ChevronsUpDown, Download, PlusCircle, XIcon } from "lucide-react";
import { useParams } from "next/navigation";
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { z } from "zod";
import { DateInput } from "~/app/(app)/_components/date-input";
import { CurrencyBadge } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/badge";
import { CurrencyInput } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/input";
import { useTRPC } from "~/trpc/react";
import { dayjs } from "~/utils/dayjs";
import { formatPrice, formatDate } from "~/utils/format";
import { type OpenDialog } from "~/utils/types";
import { CreatePersonDialog } from "../../../(entities)/people/_components/create-person-dialog";
import { downloadBlob, generateLoanPreviewPDF, type LoanPreviewData } from "~/app/(public)/receipts/[id]/_components/pdf";
import { Textarea } from "@acme/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@acme/ui/select";
import { createLoanSchema } from "@acme/validators";
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@acme/ui/table";
import { ScrollArea } from "@acme/ui/scroll-area";
import { Label } from "@acme/ui/label";
import { ManipulateType } from "dayjs";
import { Separator } from "@acme/ui/separator";

interface CreateLoanFormProps {
	context?: 'business' | 'guild';
	defaultBusinessId?: string;
	setOpenDialog: React.Dispatch<React.SetStateAction<OpenDialog>>;
}

const periodicityOptions = Object.values(PaymentPeriodicityEnum.enumValues).map(value => {
	switch (value) {
		case "ANNUALLY": return { value, label: "Anual" };
		case "SEMIANNUALLY": return { value, label: "Semestral" };
		case "QUARTERLY": return { value, label: "Trimestral" };
		case "BIMONTHLY": return { value, label: "Bimensual" };
		case "MONTHLY": return { value, label: "Mensual" };
		case "BIWEEKLY": return { value, label: "Quincenal" };
		case "WEEKLY": return { value, label: "Semanal" };
		case "DAILY": return { value, label: "Diario" };
		default: return { value, label: value };
	}
});

const alertOptions = [
	{ value: 'NONE', label: 'Ninguna' },
	{ value: 'ON_DUE', label: 'Al comienzo del evento' },
	{ value: '5_MIN_BEFORE', label: '5 minutos antes' },
	{ value: '15_MIN_BEFORE', label: '15 minutos antes' },
	{ value: '30_MIN_BEFORE', label: '30 minutos antes' },
	{ value: '1_HOUR_BEFORE', label: '1 hora antes' },
	{ value: '2_HOURS_BEFORE', label: '2 horas antes' },
	{ value: '4_HOURS_BEFORE', label: '4 horas antes' },
	{ value: '1_DAY_BEFORE', label: '1 día antes' },
	{ value: '1_WEEK_BEFORE', label: '1 semana antes' },
];

function AlertConfigurator({ value = [], onChange }: { value: { days: number; type: string; }[], onChange: (value: { days: number; type: string; }[]) => void }) {
	const addAlert = (days: number) => {
		if (value.length >= 3) {
			toast.warning("Se pueden configurar hasta 3 recordatorios.");
			return;
		}
		const type = days < 0 ? 'BEFORE_DUE' : (days > 0 ? 'AFTER_DUE' : 'ON_DUE');
		if (!value.some(alert => alert.days === days)) {
			onChange([...value, { days, type }]);
		}
	};

	const removeAlert = (index: number) => {
		onChange(value.filter((_, i) => i !== index));
	};

	const getAlertLabel = (days: number) => {
		if (days === 0) return "El día del vencimiento";
		if (days < 0) return `${Math.abs(days)} día(s) antes`;
		return `${days} día(s) después`;
	};

	return (
		<div className="space-y-3 rounded-lg border p-3">
			<Label className="text-sm font-medium">Recordatorios de Cobro (Opcional)</Label>
			<div className="flex flex-wrap gap-2">
				<Button type="button" variant="outline" size="sm" onClick={() => addAlert(-7)}>1 sem. antes</Button>
				<Button type="button" variant="outline" size="sm" onClick={() => addAlert(-1)}>1 día antes</Button>
				<Button type="button" variant="outline" size="sm" onClick={() => addAlert(0)}>Mismo día</Button>
			</div>
			{value.length > 0 && (
				<div className="space-y-1">
					{value.map((alert, index) => (
						<div key={index} className="flex items-center justify-between text-xs p-1.5 bg-muted/50 rounded">
							<span>{getAlertLabel(alert.days)}</span>
							<Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeAlert(index)}>
								<XIcon className="h-3 w-3" />
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function PaymentPlanPreview({ formValues }: { formValues: z.infer<typeof createLoanSchema> }) {
	const { grossValue, totalInterestToCharge, numberOfInstallments, paymentPeriodicity, purchaseDate } = formValues;

	const installmentPlan = useMemo(() => {
		const gv = parseFloat(grossValue.replace(",", ".")) || 0;
		const ti = parseFloat(totalInterestToCharge.replace(",", ".")) || 0;
		if (!gv || !numberOfInstallments || numberOfInstallments <= 0 || !purchaseDate) return [];

		const principalPerInstallment = gv / numberOfInstallments;
		const interestPerInstallment = ti / numberOfInstallments;
		const totalPerInstallment = principalPerInstallment + interestPerInstallment;

		let unit: ManipulateType = 'month';
		let multiplier = 1;
		switch (paymentPeriodicity) {
			case 'DAILY': unit = 'day'; break;
			case 'WEEKLY': unit = 'week'; break;
			case 'BIWEEKLY': unit = 'week'; multiplier = 2; break;
			case 'BIMONTHLY': unit = 'month'; multiplier = 2; break;
			case 'QUARTERLY': unit = 'month'; multiplier = 3; break;
			case 'SEMIANNUALLY': unit = 'month'; multiplier = 6; break;
			case 'ANNUALLY': unit = 'year'; break;
			default: unit = 'month';
		}

		const firstPaymentDueDate = dayjs(purchaseDate).add(multiplier, unit);

		return Array.from({ length: numberOfInstallments }, (_, i) => {
			const dueDate = dayjs(firstPaymentDueDate).add(i * multiplier, unit);
			return {
				number: i + 1,
				dueDate: dueDate.toDate(),
				principal: principalPerInstallment,
				interest: interestPerInstallment,
				total: totalPerInstallment,
			};
		});
	}, [grossValue, totalInterestToCharge, numberOfInstallments, paymentPeriodicity, purchaseDate]);

	if (installmentPlan.length === 0) return null;

	return (
		<Card className="md:col-span-4 mt-4">
			<CardHeader><CardTitle className="text-base">Plan de pagos preliminar</CardTitle></CardHeader>
			<CardContent>
				<ScrollArea className="h-48">
					<Table>
						<TableHeader><TableRow><TableHead>Cuota</TableHead><TableHead>Vencimiento</TableHead><TableHead className="text-right">Capital</TableHead><TableHead className="text-right">Interés</TableHead><TableHead className="text-right">Total Cuota</TableHead></TableRow></TableHeader>
						<TableBody>
							{installmentPlan.map(inst => (
								<TableRow key={inst.number}>
									<TableCell>{inst.number}</TableCell>
									<TableCell>{formatDate(inst.dueDate)}</TableCell>
									<TableCell className="text-right">{formatPrice(inst.principal)}</TableCell>
									<TableCell className="text-right">{formatPrice(inst.interest)}</TableCell>
									<TableCell className="text-right font-semibold">{formatPrice(inst.total)}</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</ScrollArea>
			</CardContent>
		</Card>
	);
}

export function Loan({ defaultBusinessId, setOpenDialog }: CreateLoanFormProps) {
	const params = useParams();
	const guildSlug = params.guildSlug as string;
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const [personDialogOpen, setPersonDialogOpen] = useState(false);
	const [fromAccountDialogOpen, setFromAccountDialogOpen] = useState(false);
	const [fromBusinessDialogOpen, setFromBusinessDialogOpen] = useState(false);
	const [showCreatePersonDialog, setShowCreatePersonDialog] = useState(false);
	const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

	const { data: people, refetch: refetchPeople } = useSuspenseQuery(trpc.person.byGuildSlug.queryOptions({ guildSlug }));
	const { data: businesses } = useSuspenseQuery(trpc.business.byGuildSlug.queryOptions({ guildSlug }));
	const { data: dictionaryAccounts } = useSuspenseQuery(trpc.dictionaryAccount.byGuildSlug.queryOptions({ guildSlug }));

	const form = useForm({
		schema: createLoanSchema,
		defaultValues: {
			guildSlug,
			fromBusinessId: params.businessSlug ? businesses?.find((business) => business.businessSlug === params.businessSlug)?.id: "",
			accountId: "",
			personId: "",
			interestPercentage: "",
			purchaseDate: dayjs().toDate(),
			grossValue: "",
			totalInterestToCharge: "",
			numberOfInstallments: 1,
			paymentPeriodicity: "MONTHLY",
			guaranteeDetails: "",
			about: "",
			alert1: 'ON_DUE', // Por defecto: El día del vencimiento
			alert2: 'NONE',   // Por defecto: Ninguna
			requiresSignature: false,
		},
	});

	const createLoanMutation = useMutation(
		trpc.loan.create.mutationOptions({
			onSuccess: async () => {
				toast.success("Préstamo creado con éxito!");
				form.reset({
					guildSlug, fromBusinessId: defaultBusinessId ?? businesses?.[0]?.id ?? "",
					accountId: "", personId: "",
					purchaseDate: dayjs().startOf('day').toDate(),
					grossValue: "", totalInterestToCharge: "",
					numberOfInstallments: 1, paymentPeriodicity: "MONTHLY",
					guaranteeDetails: "", about: "",
				});
				await queryClient.invalidateQueries(trpc.loan.byGuildSlugWithCursor.pathFilter());
				await queryClient.invalidateQueries(trpc.loan.countByGuildSlug.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.byGuildSlugWithCursor.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.byBusinessSlugWithCursor.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.countByBusinessSlug.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.countByGuildSlug.pathFilter());
				await queryClient.invalidateQueries(trpc.accountOnBusiness.guildSummary.pathFilter());
				// const businessToInvalidate = businesses?.find(b => b.id === form.getValues("fromBusinessId"))?.businessSlug;
				// if (businessToInvalidate) await queryClient.invalidateQueries(trpc.accountOnBusiness.businessSummary.pathFilter({ businessSlug: businessToInvalidate }));
				setOpenDialog("none");
			},
			onError: (error) => {
				toast.error("Error al crear el préstamo", { description: error.message });
			},
		})
	);

	function onSubmit(data: z.infer<typeof createLoanSchema>) {
		createLoanMutation.mutate(data);
	}

	const availableOriginAccounts = useMemo(() => {
		if (!dictionaryAccounts || !form.watch("fromBusinessId")) return [];
		const currentBusinessId = form.watch("fromBusinessId");
		return dictionaryAccounts.filter(da =>
			da.accountType === 'ASSET' &&
			(da.availability || (da.accountsOnBusinesses || []).some(aob => aob.businessId === currentBusinessId))
		);
	}, [dictionaryAccounts, form.watch("fromBusinessId")]);

	const handleGenerateLoanPreview = async () => { /* ... (código sin cambios) ... */ };

	const formValues = form.watch();

	const calculatedInterestAmount = useMemo(() => {
		const grossValueNum = parseFloat(form.watch("grossValue")?.replace(",", ".")) || 0;
		const percentageNum = parseFloat(form.watch("interestPercentage")?.replace(",", ".") ?? "0") || 0;
		if (grossValueNum > 0 && percentageNum > 0) {
			return (grossValueNum * percentageNum) / 100;
		}
		return 0;
	}, [form.watch("grossValue"), form.watch("interestPercentage")]);

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 p-1 overflow-y-auto">
				<div className="flex justify-end gap-2">
					<Button type="button" variant="outline" onClick={handleGenerateLoanPreview} disabled={isGeneratingPreview || createLoanMutation.isPending}>
						{isGeneratingPreview && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
						Presupuesto
					</Button>
					<Button type="submit" disabled={createLoanMutation.isPending}>
						{createLoanMutation.isPending && <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />}
						Crear Préstamo
					</Button>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-4 gap-x-4 gap-y-3">
					<FormField
						control={form.control}
						name="fromBusinessId"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Empresa que Otorga</FormLabel>
								<Popover open={fromBusinessDialogOpen} onOpenChange={setFromBusinessDialogOpen}>
									<PopoverTrigger asChild>
										<FormControl>
											<Button variant="outline" role="combobox" className={cn("w-full justify-between", !field.value && "text-muted-foreground")} disabled={!!defaultBusinessId}>
												{field.value ? businesses?.find(b => b.id === field.value)?.name : "Seleccionar empresa"}
												<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
											</Button>
										</FormControl>
									</PopoverTrigger>
									<PopoverContent className="w-[--radix-popover-trigger-width] p-0">
										<Command>
											<CommandInput placeholder="Buscar empresa..." />
											<CommandList><CommandEmpty>No encontrada.</CommandEmpty>
												<CommandGroup>
													{(params.businessSlug ? businesses?.filter((business) => business.businessSlug === params.businessSlug) : businesses).map((business) => (
														<CommandItem value={business.id} key={business.id} onSelect={() => { form.setValue("fromBusinessId", business.id); form.setValue("accountId", ""); setFromBusinessDialogOpen(false); }}>
															<Check className={cn("mr-2 h-4 w-4", business.id === field.value ? "opacity-100" : "opacity-0")} />
															{business.name}
														</CommandItem>
													))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="accountId"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Cuenta Origen de Fondos</FormLabel>
								<Popover open={fromAccountDialogOpen} onOpenChange={setFromAccountDialogOpen}>
									<PopoverTrigger asChild>
										<FormControl>
											<Button variant="outline" role="combobox" className={cn("w-full justify-between", !field.value && "text-muted-foreground")} disabled={!form.watch("fromBusinessId")}>
												<div className="flex gap-2 items-center">
													{field.value ? availableOriginAccounts?.find(acc => acc.id === field.value)?.name : "Seleccionar cuenta"}
													{field.value && <CurrencyBadge currency={availableOriginAccounts?.find(acc => acc.id === field.value)?.currency as Currency} size="sm" className="ml-2" />}
												</div>
												<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
											</Button>
										</FormControl>
									</PopoverTrigger>
									<PopoverContent className="w-[--radix-popover-trigger-width] p-0">
										<Command>
											<CommandInput placeholder="Buscar cuenta..." />
											<CommandList><CommandEmpty>No hay cuentas de activo en esta empresa.</CommandEmpty>
												<CommandGroup>
													{availableOriginAccounts?.map((dictAccount) => (
														<CommandItem value={dictAccount.id} key={dictAccount.id} onSelect={() => { form.setValue("accountId", dictAccount.id); setFromAccountDialogOpen(false); }}>
															<Check className={cn("mr-2 h-4 w-4", dictAccount.id === field.value ? "opacity-100" : "opacity-0")} />
															{dictAccount.name}
															<CurrencyBadge currency={dictAccount.currency as Currency} size="sm" className="ml-auto" />
														</CommandItem>
													))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="personId"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Cliente (Prestatario)</FormLabel>
								<Popover open={personDialogOpen} onOpenChange={setPersonDialogOpen}>
									<PopoverTrigger asChild>
										<FormControl>
											<Button variant="outline" role="combobox" className={cn("w-full justify-between", !field.value && "text-muted-foreground")}>
												{field.value ? people?.find(p => p.id === field.value)?.name : "Seleccionar persona"}
												<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
											</Button>
										</FormControl>
									</PopoverTrigger>
									<PopoverContent className="w-[--radix-popover-trigger-width] p-0">
										<Command>
											<CommandInput placeholder="Buscar persona..." />
											<CommandList><CommandEmpty>
												<Button variant="ghost" className="w-full justify-start text-sm font-normal" onClick={() => { setPersonDialogOpen(false); setShowCreatePersonDialog(true); }}>
													<PlusCircle className="mr-2 h-4 w-4" /> Crear nueva persona
												</Button>
											</CommandEmpty>
												<CommandGroup>
													{people?.map((person) => (
														<CommandItem value={person.id} key={person.id} onSelect={() => { form.setValue("personId", person.id); setPersonDialogOpen(false); }}>
															<Check className={cn("mr-2 h-4 w-4", person.id === field.value ? "opacity-100" : "opacity-0")} />
															{person.name}
														</CommandItem>
													))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField control={form.control} name="grossValue" render={({ field }) => (
						<FormItem><FormLabel>Monto Capital a Prestar</FormLabel><FormControl><CurrencyInput placeholder="100.00" {...field} /></FormControl><FormMessage />
						</FormItem>)} />
					<FormField
						control={form.control}
						name="interestPercentage"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Interés Total a Cobrar (%)</FormLabel>
								<FormControl>
									<div className="flex items-center gap-2 border rounded-md">
										<CurrencyInput
											className="border-0"
											placeholder="20.00"
											{...field}
											onChange={(e) => {
												field.onChange(e); // Comportamiento original del FormField
												const percentageNum = parseFloat(e.target.value.replace(",", ".")) || 0;
												const grossValueNum = parseFloat(form.getValues("grossValue")?.replace(",", ".") || "0");
												if (grossValueNum > 0 && percentageNum > 0) {
													const calculatedInterest = (grossValueNum * percentageNum) / 100;
													form.setValue("totalInterestToCharge", calculatedInterest.toFixed(2).replace(".", ","));
												} else {
													form.setValue("totalInterestToCharge", "0");
												}
											}}
										/>
										<Separator orientation="vertical" />
										{form.getValues("grossValue") && (
											<span className="w-full text-sm ">
												= {formatPrice(calculatedInterestAmount)}
											</span>
										)}
									</div>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					{/* Este campo AHORA ES OCULTO. Su valor se establece por el onChange del porcentaje o del grossValue. */}
					<FormField
						control={form.control}
						name="totalInterestToCharge"
						render={({ field }) => (
							<FormItem className="hidden">
								<FormControl><Input {...field} readOnly /></FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField control={form.control} name="numberOfInstallments" render={({ field }) => (
						<FormItem><FormLabel>Número de Cuotas</FormLabel><FormControl><Input type="number" placeholder="4" {...field} onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)} /></FormControl><FormMessage />
						</FormItem>)} />
					<FormField control={form.control} name="paymentPeriodicity" render={({ field }) => (<FormItem><FormLabel>Periodicidad de Pago</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Seleccionar periodicidad" /></SelectTrigger></FormControl><SelectContent>{periodicityOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>)} />
					<FormField control={form.control} name="purchaseDate" render={({ field }) => (<FormItem><FormLabel>Fecha de Otorgamiento</FormLabel><FormControl><DateInput value={field.value} onChange={field.onChange} /></FormControl><FormMessage /></FormItem>)} />


					<Label className="md:col-span-4">Recordatorios de Cobro</Label>
					<FormField
						control={form.control}
						name="alert1"
						render={({ field }) => (
							<FormItem className="md:col-span-2">
								<Select onValueChange={field.onChange} defaultValue={field.value}>
									<FormControl>
										<SelectTrigger>
											<BellIcon className="mr-2 h-4 w-4" />
											<SelectValue placeholder="Seleccionar recordatorio..." />
										</SelectTrigger>
									</FormControl>
									<SelectContent className="max-h-48 overflow-y-auto">
										{alertOptions.filter(o => o.value !== 'NONE').map(opt => (
											<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
										))}
									</SelectContent>
								</Select>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={form.control}
						name="alert2"
						render={({ field }) => (
							<FormItem className="md:col-span-2">
								<Select onValueChange={field.onChange} defaultValue={field.value}>
									<FormControl>
										<SelectTrigger>
											<BellIcon className="mr-2 h-4 w-4" />
											<SelectValue placeholder="Seleccionar recordatorio..." />
										</SelectTrigger>
									</FormControl>
									<SelectContent className="max-h-48 overflow-y-auto">
										{alertOptions.map(opt => (
											<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
										))}
									</SelectContent>
								</Select>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField control={form.control} name="guaranteeDetails" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Detalles de Garantía (Opcional)</FormLabel><FormControl><Textarea placeholder="Descripción de la garantía..." {...field} /></FormControl><FormMessage /></FormItem>)} />
					<FormField control={form.control} name="about" render={({ field }) => (<FormItem className="md:col-span-2"><FormLabel>Descripción/Notas Adicionales (Opcional)</FormLabel><FormControl><Textarea placeholder="Notas sobre el préstamo..." {...field} /></FormControl><FormMessage /></FormItem>)} />
					<PaymentPlanPreview formValues={formValues} />
				</div>
			</form>
			<CreatePersonDialog
				open={showCreatePersonDialog}
				onOpenChange={setShowCreatePersonDialog}
				onPersonCreated={(newPerson) => {
					refetchPeople().then(() => {
						form.setValue("personId", newPerson.id);
						setShowCreatePersonDialog(false);
						setPersonDialogOpen(true);
					});
				}}
			/>
		</Form>
	);
}