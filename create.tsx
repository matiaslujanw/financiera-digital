// apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/_components/create-transaction-form.tsx

"use client";

import { AccountOnBusinessSchema, Currency, DictionaryAccountSchema, EntityType } from "@acme/db/schema";
import { toast } from "@acme/ui/toast";
import { PurchaseCheckInput, TransactionCreateSchema } from "@acme/validators";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { es } from "date-fns/locale";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useTRPC } from "~/trpc/react";

import { cn } from "@acme/ui";
import { Badge } from "@acme/ui/badge";
import { Button } from "@acme/ui/button";
import { Calendar } from "@acme/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@acme/ui/command";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@acme/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormMessage, useForm } from "@acme/ui/form";
import { Icons } from "@acme/ui/icons";
import { Input } from "@acme/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@acme/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@acme/ui/table";
import { Textarea } from "@acme/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@acme/ui/tooltip";

import { RouterOutputs } from "@acme/api";
import { Card, CardContent } from "@acme/ui/card";
import { ArrowRightLeft, CalendarIcon, Check, ChevronsUpDown, FileStack, Paperclip, PlusCircle } from "lucide-react";
import { CurrencyBadge } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/badge";
import { CurrencyInput } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/input";
import { dayjs } from "~/utils/dayjs";
import { formatPrice, getTypeLabel } from "~/utils/format";
import { FormContext, OpenDialog } from "~/utils/types";
import { shouldDisableInput } from "~/utils/validations";
import { TimePickerDemo } from "../time-picker/time-picker-demo";
import { DocumentsDialog } from "./documents";
import { SpecialDialog } from "./special";
import { MultipleTransactionForm } from "./ multiple-transaction-form";
import { DateInput } from "~/app/(app)/_components/date-input";
import { ScrollArea } from "@acme/ui/scroll-area";

interface CreateTransactionFormProps {
	context: FormContext;
}

type AccountOnBusinessWithDict = AccountOnBusinessSchema & { dictionaryAccount: DictionaryAccountSchema };
type MemberAccountAccess = RouterOutputs["member"]["getMemberAccountAccess"];

export function CreateTransactionForm({
	context,
}: CreateTransactionFormProps) {
	const [transactionType, setTransactionType] = useState<string>("inbound");
	const [showMultipleTransactionForm, setShowMultipleTransactionForm] = useState(false);
	const [openDialog, setOpenDialog] = useState<OpenDialog>('none');
	const [accountDialogOpen, setAccountDialogOpen] = useState<'from' | 'to' | null>(null);
	const [businessDialogOpen, setBusinessDialogOpen] = useState<'from' | 'to' | null>(null);
	const [createdChecks, setCreatedChecks] = useState<PurchaseCheckInput[]>([]);
	const [entityDialogOpen, setEntityDialogOpen] = useState(false);
	const [descriptionDialogOpen, setDescriptionDialogOpen] = useState(false);
	const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
	const [searchTerm, setSearchTerm] = useState("");
	const params = useParams();
	const trpc = useTRPC();
	const queryClient = useQueryClient();

	const guildSlug = params.guildSlug as string;
	const businessSlugFromParams = params.businessSlug as string | undefined;
	const accountIdFromParams = params.accountId as string | undefined;

	const { data: initialAccountOnBusinessData } = useQuery(
		trpc.accountOnBusiness.byId.queryOptions(
			{ id: accountIdFromParams ?? "" },
			{ enabled: context === "account" && !!accountIdFromParams }
		)
	);

	const { data: businesses } = useQuery(
		trpc.business.byGuildSlug.queryOptions({
			guildSlug: params.guildSlug as string
		}));

	const { data: dictionaryAccounts } = useQuery(
		trpc.dictionaryAccount.byGuildSlug.queryOptions({
			guildSlug: params.guildSlug as string
		}));

	const { data: currentMemberInGuild, isLoading: isLoadingMemberInGuild } = useQuery(
		trpc.member.getMemberByUserIdAndGuildSlug.queryOptions({
			userId: 'current',
			guildSlug: params.guildSlug as string,
		})
	);

	const formLogic = useMemo(() => { /* ... tu lógica de formLogic ... */
		switch (context) {
			case 'guild': return {
				defaultBusinessId_TO: undefined,
				isBusinessSelectionDisabled_TO: false,
				isAccountSelectionDisabled_TO: false,
				defaultAccountId_TO: undefined,
			};
			case 'business':
				const businessId = businesses?.find(b => b.businessSlug === businessSlugFromParams)?.id;
				return {
					defaultBusinessId_TO: businessId,
					isBusinessSelectionDisabled_TO: true,
					isAccountSelectionDisabled_TO: false,
					defaultAccountId_TO: undefined,
				};
			case 'account':
				return {
					defaultBusinessId_TO: initialAccountOnBusinessData?.businessId,
					isBusinessSelectionDisabled_TO: true,
					isAccountSelectionDisabled_TO: true,
					defaultAccountId_TO: accountIdFromParams,
				};
			default:
				return {
					defaultBusinessId_TO: undefined,
					isBusinessSelectionDisabled_TO: false,
					isAccountSelectionDisabled_TO: false,
					defaultAccountId_TO: undefined,
				};
		}
	}, [context, businesses, businessSlugFromParams, initialAccountOnBusinessData, accountIdFromParams]);

	const form = useForm({
		schema: TransactionCreateSchema,
		defaultValues: {
			date: dayjs().local().toDate(),
			guildSlug: params.guildSlug as string,
			movement: { increment: "", decrement: "" },
			about: "",
			isMidnight: false,
			fromAccountId: "",
			fromCurrency: "",
			toAccountId: formLogic.defaultAccountId_TO ?? "",
			fromBusinessId: (context === 'business' || context === 'account') ? formLogic.defaultBusinessId_TO : "",
			toBusinessId: formLogic.defaultBusinessId_TO ?? "",
			exchangeRate: "",
			categoryId: "",
			entityId: "",
			requiresSignature: false,
			documents: undefined
		}
	});

	// Permisos para el FROM business
	const { data: fromBusinessPermissions, isLoading: isLoadingFromPerms, refetch: refetchFromPerms } = useQuery(
		trpc.member.getMemberAccountAccess.queryOptions({
			memberId: currentMemberInGuild?.id ?? "",
			businessId: form.watch("fromBusinessId") ?? "",
		}, {
			enabled: !!currentMemberInGuild?.id && !!form.watch("fromBusinessId") && currentMemberInGuild.role === 'MEMBER',
		}));

	// Permisos para el TO business
	const { data: toBusinessPermissions, isLoading: isLoadingToPerms, refetch: refetchToPerms } = useQuery(
		trpc.member.getMemberAccountAccess.queryOptions({
			memberId: currentMemberInGuild?.id ?? "",
			businessId: form.watch("toBusinessId") ?? "",
		}, {
			enabled: !!currentMemberInGuild?.id && !!form.watch("toBusinessId") && currentMemberInGuild.role === 'MEMBER',
		}));

	useEffect(() => {
		if (currentMemberInGuild?.role === "MEMBER" && form.watch("fromBusinessId")) {
			refetchFromPerms();
		}
	}, [form.watch("fromBusinessId"), currentMemberInGuild?.role, refetchFromPerms]);

	useEffect(() => {
		if (currentMemberInGuild?.role === "MEMBER" && form.watch("toBusinessId")) {
			refetchToPerms();
		}
	}, [form.watch("toBusinessId"), currentMemberInGuild?.role, refetchToPerms]);

	// Cargar entidades solo cuando sean necesarias
	const { data: people } = useQuery(trpc.person.byGuildSlug.queryOptions(
		{ guildSlug: params.guildSlug as string },
		{ enabled: isEntityRequired() }
	));

	const { data: machinery } = useQuery(trpc.machinery.byGuildSlug.queryOptions(
		{ guildSlug: params.guildSlug as string },
		{ enabled: isEntityRequired() }
	));

	const { data: vehicles } = useQuery(trpc.vehicle.byGuildSlug.queryOptions(
		{ guildSlug: params.guildSlug as string },
		{ enabled: isEntityRequired() }
	));

	const { data: properties } = useQuery(trpc.property.byGuildSlug.queryOptions(
		{ guildSlug: params.guildSlug as string },
		{ enabled: isEntityRequired() }
	));

	// Si estamos en el contexto de cuenta, establecemos la cuenta preseleccionada
	useEffect(() => {
		if (context === 'account' && params.accountId) {
			form.setValue('toAccountId', params.accountId as string);
		}
	}, [context, params.accountId, form]);

	// Observar cambios en cuentas para validación de entidad
	useEffect(() => {
		const subscription = form.watch((value, { name }) => {
			if (name === 'fromAccountId' || name === 'toAccountId') {
				const isRequired = isEntityRequired();
				const currentEntityId = form.watch('entityId');

				if (isRequired && !currentEntityId) {
					form.setError('entityId', {
						message: 'Debe seleccionar una subcuenta'
					});
				} else {
					form.clearErrors('entityId');
				}
			}
		});

		return () => subscription.unsubscribe();
	}, [form, dictionaryAccounts]);



	// Obtener el nombre de la entidad seleccionada
	function getSelectedEntityName(entityId: string | undefined) {
		if (!entityId) return null;

		const selectedFromAccount = dictionaryAccounts?.find(d => d.id === form.watch("fromAccountId"));
		const selectedToAccount = dictionaryAccounts?.find(d => d.id === form.watch("toAccountId"));
		const accountWithEntity = selectedFromAccount?.hasSubAccounts ? selectedFromAccount : selectedToAccount;

		if (!accountWithEntity?.entityType) return null;
		//
		switch (accountWithEntity.entityType) {
			case 'PERSON':
				return people?.find(p => p.id === entityId)?.name;
			case 'MACHINERY':
				return machinery?.find(m => m.id === entityId)?.name;
			case 'VEHICLE':
				return vehicles?.find(v => v.id === entityId)?.name;
			case 'PROPERTY':
				return properties?.find(p => p.id === entityId)?.name;
			default:
				return null;
		}
	}

	// Obtener entidades disponibles según el tipo de cuenta
	function getAvailableEntities() {
		const selectedFromAccount = dictionaryAccounts?.find(d => d.id === form.watch("fromAccountId"));
		const selectedToAccount = dictionaryAccounts?.find(d => d.id === form.watch("toAccountId"));
		const accountWithEntity = selectedFromAccount?.hasSubAccounts ? selectedFromAccount : selectedToAccount;

		if (!accountWithEntity?.entityType) return [];

		switch (accountWithEntity.entityType) {
			case 'PERSON':
				return [{
					type: 'PERSON',
					items: people ?? []
				}];
			case 'MACHINERY':
				return [{
					type: 'MACHINERY',
					items: machinery ?? []
				}];
			case 'VEHICLE':
				return [{
					type: 'VEHICLE',
					items: vehicles ?? []
				}];
			case 'PROPERTY':
				return [{
					type: 'PROPERTY',
					items: properties ?? []
				}];
			default:
				return [];
		}
	}

	// Verificar si es necesario seleccionar una entidad
	function isEntityRequired() {
		const selectedFromAccount = dictionaryAccounts?.find(d => d.id === form.watch("fromAccountId"));
		const selectedToAccount = dictionaryAccounts?.find(d => d.id === form.watch("toAccountId"));

		return !!(selectedFromAccount?.hasSubAccounts || selectedToAccount?.hasSubAccounts);
	}

	function onSubmit(data: z.infer<typeof TransactionCreateSchema>) {
		// Verificar si se necesita seleccionar una entidad
		if (isEntityRequired() && !data.entityId) {
			form.setError("entityId", {
				message: "Debe seleccionar una subcuenta"
			});
			return;
		}

		// Verificar cotización para distintas monedas
		if (showExchangeRate()) {
			if (!data.fromCurrency) {
				form.setError("fromCurrency", { message: "Obligatorio" });
				return;
			}
			if (!data.exchangeRate) {
				form.setError("exchangeRate", { message: "Obligatorio para monedas diferentes" });
				return;
			}
		}

		// Verificar que se ingresó algún valor
		if (!data.movement.increment && !data.movement.decrement) {
			form.setError("movement.increment", { message: "Debe ingresar un valor" });
			return;
		}

		create.mutate({
			date: dayjs(data.date).toDate(),
			isMidnight: dayjs(data.date).format('HH:mm') === '00:00',
			guildSlug: data.guildSlug,
			movement: data.movement,
			fromAccountId: data.fromAccountId || undefined,
			fromBusinessId: data.fromBusinessId || undefined,
			fromCurrency: data.fromCurrency || undefined,
			toAccountId: data.toAccountId,
			toBusinessId: data.toBusinessId,
			about: data.about || undefined,
			categoryId: data.categoryId || undefined,
			documents: data.documents?.map(doc => ({
				...doc,
				amount: doc.amount
			})),
			exchangeRate: data.exchangeRate === "" ? undefined : data.exchangeRate,
			entityId: data.entityId || undefined,
			requiresSignature: data.requiresSignature
		});
	}

	const create = useMutation(
		trpc.transaction.create.mutationOptions({
			onSuccess: async () => {
				form.reset();
				form.setValue("date", dayjs().toDate());
				form.setValue("movement", {
					increment: "",
					decrement: ""
				});
				// Si estamos en contexto de cuenta, mantenemos seleccionada la misma cuenta
				if (context === 'account' && params.accountId) {
					form.setValue('toAccountId', params.accountId as string);
				}

				toast.success(`Enhorabuena`, { description: `La transacción fue creada con éxito.` });
				await queryClient.invalidateQueries(trpc.accountOnBusiness.totalSummary.pathFilter());
				await queryClient.invalidateQueries(trpc.accountOnBusiness.guildSummary.pathFilter());
				await queryClient.invalidateQueries(trpc.accountOnBusiness.businessSummary.pathFilter());
				await queryClient.invalidateQueries(trpc.accountOnBusiness.getSubAccountsSummary.pathFilter());

				await queryClient.invalidateQueries(trpc.transaction.byGuildSlugWithCursor.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.byBusinessSlugWithCursor.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.byAccountIdWithCursor.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.bySubAccountIdWithCursor.pathFilter());

				await queryClient.invalidateQueries(trpc.transaction.countByGuildSlug.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.countByBusinessSlug.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.countByAccountId.pathFilter());
				await queryClient.invalidateQueries(trpc.transaction.countBySubAccountId.pathFilter());
			},
			onError: (err) => {
				if (err.data?.code === "CONFLICT") {
					form.setError("about", { message: err.message });
				} else {
					toast.error(`Ocurrió un error`, {
						description: err.message
					});
				}
			},
		})
	);

	function showExchangeRate() {
		if (form.watch("toAccountId") && form.watch("fromAccountId")) {
			if (dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId"))?.currency !==
				dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.currency) {
				return true;
			} else {
				return false;
			}
		} else {
			return false;
		}
	}

	const filterAccounts = ({ accounts, direction }: {
		accounts: RouterOutputs["dictionaryAccount"]["byGuildSlug"],
		direction: 'from' | 'to'
	}) => {
		if (!accounts.length) return [];

		// Obtener IDs importantes del contexto
		const guildSlug = params.guildSlug as string;
		const businessSlug = params.businessSlug as string;
		const accountId = params.accountId as string;
		const subAccountId = params.subAccountId as string;

		// Determinar si estamos en un contexto específico
		const isInBusinessContext = !!businessSlug;
		const isInAccountContext = !!accountId;
		const isInSubAccountContext = !!subAccountId;

		// Determinar el ID de empresa del contexto actual si aplica
		const contextBusinessId = isInBusinessContext
			? businesses?.find(b => b.businessSlug === businessSlug)?.id
			: undefined;

		// Obtener la cuenta y su diccionario si estamos en contexto de cuenta
		let contextAccountOnBusiness = null;
		let contextDictionaryAccountId = null;

		if (isInAccountContext) {
			// Buscar la información del accountOnBusiness
			contextAccountOnBusiness = dictionaryAccounts
				?.flatMap(dict => dict.accountsOnBusinesses || [])
				.find(acc => acc.id === accountId);

			// Si encontramos la cuenta, guardamos el ID de su diccionario
			if (contextAccountOnBusiness) {
				contextDictionaryAccountId = contextAccountOnBusiness.dictionaryAccountId;
			}
		}

		// Verificar si la cuenta destino ya seleccionada es agregada
		const toAccountIsAggregated = form.watch("toAccountId") &&
			dictionaryAccounts?.find(acc => acc.id === form.watch("toAccountId"))?.hasSubAccounts;

		// Verificar si la cuenta origen ya seleccionada es agregada
		const fromAccountIsAggregated = form.watch("fromAccountId") &&
			dictionaryAccounts?.find(acc => acc.id === form.watch("fromAccountId"))?.hasSubAccounts;

		// Cuenta seleccionada en el otro extremo de la transacción
		const otherAccountId = direction === 'from' ? form.watch("toAccountId") : form.watch("fromAccountId");

		return accounts.filter((dictionary) => {
			// Aplicar filtro de búsqueda
			if (searchTerm && !dictionary.name.toLowerCase().includes(searchTerm.toLowerCase())) {
				return false;
			}

			// Evitar seleccionar la misma cuenta
			if (otherAccountId === dictionary.id) {
				return false;
			}

			// Si una cuenta agregada ya está seleccionada, no permitir seleccionar otra cuenta agregada
			if ((direction === 'from' && toAccountIsAggregated && dictionary.hasSubAccounts) ||
				(direction === 'to' && fromAccountIsAggregated && dictionary.hasSubAccounts)) {
				return false;
			}

			// Restricciones específicas según el contexto
			if (isInAccountContext) {
				// En el contexto de cuenta
				if (direction === 'from') {
					// Cuando estamos seleccionando cuenta origen, solo permitir la cuenta del contexto
					return dictionary.id === contextDictionaryAccountId;
				}
			} else if (isInBusinessContext) {
				// En el contexto de empresa
				return true
				// if (direction === 'from') {
				// 	// Cuando estamos seleccionando cuenta origen, solo mostrar cuentas de la empresa del contexto
				// 	return dictionary.accountsOnBusinesses?.some(acc => acc.businessId === contextBusinessId);
				// }
			}

			// Para transacciones entre empresas, filtrar cuentas por disponibilidad
			if (transactionType === "outbound" && !dictionary.availability) {
				return false;
			}

			// Filtrar cuentas que no debería poder seleccionar para prevenir transacciones inválidas
			const accountType = dictionary.accountType;

			// ASSET y LIABILITY solo pueden recibir transacciones si hay una cuenta de origen
			if ((accountType === 'ASSET' || accountType === 'LIABILITY') &&
				direction === 'to' && !form.watch("fromAccountId")) {
				return false;
			}

			return true;
		});
	};

	const getPermittedDictionaryAccounts = useCallback((direction: 'from' | 'to'): DictionaryAccountSchema[] => {
		const memberRole = currentMemberInGuild?.role;
		let selectedBusinessId: string | undefined;

		if (transactionType === 'inbound') {
			selectedBusinessId = form.watch("toBusinessId") || form.watch("fromBusinessId");
			if (!form.watch("toBusinessId") && direction === 'from' && form.watch("fromBusinessId")) {
				selectedBusinessId = form.watch("fromBusinessId");
			} else if (!form.watch("fromBusinessId") && direction === 'to' && form.watch("toBusinessId")) {
				selectedBusinessId = form.watch("toBusinessId");
			} else {
				selectedBusinessId = form.watch("toBusinessId") || form.watch("fromBusinessId");
			}
		} else { // outbound
			selectedBusinessId = direction === 'from' ? form.watch("fromBusinessId") : form.watch("toBusinessId");
		}

		if (!selectedBusinessId || !dictionaryAccounts || isLoadingMemberInGuild) {
			// console.log(`[Perms DA] No valid selectedBusinessId (${selectedBusinessId}) determined, or no dictionaryAccounts, or isLoadingMemberInGuild. Direction: ${direction}, TxType: ${transactionType}`);
			return [];
		}

		// console.log(`[Perms DA] Filtering for ${direction}, Role: ${memberRole}, BusinessID: ${selectedBusinessId}, TxType: ${transactionType}`);

		let basePermittedDictionaryAccounts: typeof dictionaryAccounts = []; // Renombrado para claridad
		const relevantPermissions = direction === 'from' ? fromBusinessPermissions : toBusinessPermissions;
		const isLoadingRelevantPerms = direction === 'from' ? isLoadingFromPerms : isLoadingToPerms;

		if (memberRole === 'OWNER' || memberRole === 'MANAGER') {
			// console.log(`[Perms DA] Role is ${memberRole}. Granting full access to DictionaryAccounts for business ${selectedBusinessId}.`);
			// OWNER/MANAGER pueden ver todos los DictionaryAccount. La existencia de AoB se maneja en backend.
			basePermittedDictionaryAccounts = [...dictionaryAccounts];
		} else if (memberRole === 'MEMBER') {
			// console.log(`[Perms DA] Role is MEMBER. Applying specific permissions for business ${selectedBusinessId}.`);
			if (isLoadingRelevantPerms) {
				// console.log("[Perms DA] isLoading specific perms for MEMBER. Returning empty for now.");
				return [];
			}
			if (relevantPermissions) {
				const explicitlyPermittedAobIds = new Set(
					relevantPermissions.accounts
						.filter(p => p.canWrite)
						.map(p => p.accountOnBusinessId)
				);

				dictionaryAccounts.forEach(dictAcc => {
					const aobsForThisDictInSelectedBusiness = (dictAcc.accountsOnBusinesses || [])
						.filter(aob => aob.businessId === selectedBusinessId);

					if (relevantPermissions.hasFullAccess) {
						let canProceed = false;
						if (direction === 'from') {
							if (relevantPermissions.canWrite) canProceed = true;
						} else {
							canProceed = true;
						}
						// Si tiene full access y puede proceder, el DictionaryAccount es candidato.
						// No necesitamos que ya exista un AoB, se crearía.
						if (canProceed) {
							basePermittedDictionaryAccounts.push(dictAcc);
						}
					} else {
						const hasPermittedAobForThisDict = aobsForThisDictInSelectedBusiness.some(aob => explicitlyPermittedAobIds.has(aob.id));
						if (hasPermittedAobForThisDict) {
							basePermittedDictionaryAccounts.push(dictAcc);
						}
					}
				});
			} else {
				// console.log(`[Perms DA] MEMBER role but no specific permissions data loaded yet for business ${selectedBusinessId}.`);
				return [];
			}
		} else {
			// console.log(`[Perms DA] Role is undefined or not handled: ${memberRole}. Returning empty.`);
			return [];
		}

		// Aplicar filtros adicionales (searchTerm, misma cuenta, agregadas, etc.)
		const otherSelectedDictAccountId = form.watch(direction === 'from' ? "toAccountId" : "fromAccountId");

		return basePermittedDictionaryAccounts.filter(dictAcc => { // Ahora filtramos sobre la lista base ya permitida
			if (searchTerm && !dictAcc.name.toLowerCase().includes(searchTerm.toLowerCase())) {
				return false;
			}
			if (otherSelectedDictAccountId && otherSelectedDictAccountId === dictAcc.id) return false;

			// Definición de otherAobIsAggregated DENTRO del scope del filter
			const otherReferencedDictionaryAccount = dictionaryAccounts.find(da => da.id === otherSelectedDictAccountId);
			const otherAobIsAggregated = otherReferencedDictionaryAccount?.hasSubAccounts ?? false;
			const thisDictAccountIsAggregated = dictAcc.hasSubAccounts;

			if (otherAobIsAggregated && thisDictAccountIsAggregated) return false;

			if (memberRole === 'MEMBER' || memberRole === undefined) {
				if (direction === 'to' && (dictAcc.accountType === 'ASSET' || dictAcc.accountType === 'LIABILITY') && !form.watch("fromAccountId")) {
					return false;
				}
			}

			if (transactionType === "outbound" && !dictAcc.availability) {
				const hasExistingAobInSelectedBusiness = (dictAcc.accountsOnBusinesses || []).some(aob => aob.businessId === selectedBusinessId);
				if (!hasExistingAobInSelectedBusiness) {
					return false;
				}
			}
			return true;
		});
	}, [
		currentMemberInGuild,
		form,
		dictionaryAccounts,
		searchTerm,
		fromBusinessPermissions,
		toBusinessPermissions,
		transactionType,
		isLoadingMemberInGuild,
		isLoadingFromPerms,
		isLoadingToPerms
	]);

	const currentFromDictionaryAccount = useMemo(() => {
		const fromDictId = form.watch("fromAccountId");
		if (!fromDictId || !dictionaryAccounts) return null;
		return dictionaryAccounts.find(d => d.id === fromDictId);
	}, [form.watch("fromAccountId"), dictionaryAccounts]);

	const currentToDictionaryAccount = useMemo(() => {
		const toDictId = form.watch("toAccountId");
		if (!toDictId || !dictionaryAccounts) return null;
		return dictionaryAccounts.find(d => d.id === toDictId);
	}, [form.watch("toAccountId"), dictionaryAccounts]);

	const shouldDisableMovementInput = useCallback((movementType: "INCREMENT" | "DECREMENT"): boolean => {
		const memberRole = currentMemberInGuild?.role;

		if (memberRole === "OWNER" || memberRole === "MANAGER") {
			return false; // OWNER/MANAGER pueden hacer cualquier movimiento
		}

		// ... (resto de tu lógica para MEMBER en shouldDisableMovementInput, que ya estaba bien)
		const direction = movementType === "DECREMENT" ? 'from' : 'to';

		if (isLoadingMemberInGuild || (direction === 'from' && isLoadingFromPerms) || (direction === 'to' && isLoadingToPerms)) {
			return true;
		}

		const fromAobId = form.watch("fromAccountId"); // Este es un DictionaryAccount.id
		const toAobId = form.watch("toAccountId");   // Este es un DictionaryAccount.id

		// Para MEMBER, necesitamos encontrar el AccountOnBusiness.id correspondiente al DictionaryAccount.id
		// y luego verificar el permiso. Esto es un poco indirecto ahora.
		// La lógica en getPermittedDictionaryAccounts ya filtra basado en canWrite/canRead.
		// Si un DictionaryAccount está en la lista, es porque el MEMBER tiene el permiso necesario
		// en al menos un AccountOnBusiness de ese tipo en la empresa seleccionada.

		// Lo más simple es: si la cuenta no está seleccionada, deshabilitar.
		if (movementType === "DECREMENT" && !fromAobId) return true;
		if (movementType === "INCREMENT" && !toAobId) return true;

		// La lógica más fina de permisos ya se aplicó al generar la lista de diccionarios seleccionables.
		// Si el usuario pudo seleccionar un DictionaryAccount para 'fromAccountId', es porque tiene
		// permiso de escritura en el AccountOnBusiness subyacente.

		return false; // Por defecto, si la cuenta está seleccionada, permitir.
	}, [
		currentMemberInGuild,
		form.watch("fromAccountId"),
		form.watch("toAccountId"),
		isLoadingMemberInGuild,
		isLoadingFromPerms,
		isLoadingToPerms,
		// No necesitamos fromBusinessPermissions/toBusinessPermissions aquí directamente
		// ya que getPermittedDictionaryAccounts ya los usó.
	]);

	function isAnySelectedAccountAggregated() {
		// currentFromDictionaryAccount y currentToDictionaryAccount son ahora directamente el DictionaryAccount o null
		const fromIsAggregated = currentFromDictionaryAccount?.hasSubAccounts ?? false;
		const toIsAggregated = currentToDictionaryAccount?.hasSubAccounts ?? false;

		return fromIsAggregated || toIsAggregated;
	}

	// console.log(form.formState.errors, "errores")

	// console.log(isLoadingMemberInGuild || (currentMemberInGuild?.role === 'MEMBER' && isLoadingFromPerms), "aaaaaaaa", getPermittedDictionaryAccounts('from').length, getPermittedDictionaryAccounts('from'))

	return (
		<TooltipProvider>
			<div className="w-full">
				<Card className="relative overflow-visible">
					<CardContent className="p-0">
						<Form {...form}>
							<form
								id="createTransaction"
								onSubmit={form.handleSubmit(onSubmit)}
								className="flex flex-col justify-start w-full rounded-lg px-4 py-3 gap-2 border border-primary"
							>
								<div className="flex flex-col w-full gap-2">
									<div className="flex flex-wrap justify-between items-center">
										<div className="flex gap-2 items-center flex-wrap lg:flex-nowrap">
											<h2 className="text-md text-nowrap font-bold tracking-tight w-fit">
												Crear transacción
											</h2>
											<p className='text-md'>/</p>
											<Select
												onValueChange={(value) => {
													setTransactionType(value);

													// Preservar la cuenta actual en el contexto de cuenta
													if (context === 'account') {
														form.reset({
															...form.getValues(),
															toAccountId: params.accountId as string,
															fromAccountId: "",
															fromBusinessId: "",
															categoryId: ""
														});
													} else {
														form.reset({
															...form.getValues(),
															fromAccountId: "",
															toAccountId: "",
															fromBusinessId: "",
															categoryId: ""
														});
													}
												}}
												value={transactionType}
												defaultValue="inbound"
											>
												<SelectTrigger className="border-0 focus:ring-0 hover:border-0 gap-2 w-fit p-0">
													<SelectValue placeholder="Seleccionar" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="inbound">
														Dentro de una empresa
													</SelectItem>
													<SelectItem value="outbound">
														Entre empresas
													</SelectItem>
												</SelectContent>
											</Select>
										</div>

										{/* Información de tipo de cambio */}
										{(showExchangeRate() && form.watch("fromCurrency")) && (
											<div className="flex flex-col gap-1 items-start">
												<div className="flex gap-1 items-center">
													<p className='text-xs'>1</p>
													<CurrencyBadge
														currency={[
															dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId")),
															dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))
														].find((item) => item?.currency === form.watch("fromCurrency"))?.currency ?? "ARS"}
														size="sm"
													/>
													<p className='text-xs'>=</p>
													<p className='text-xs'>{form.watch("exchangeRate")}</p>
													<CurrencyBadge
														currency={[
															dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId")),
															dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))
														].find((item) => item?.currency !== form.watch("fromCurrency"))?.currency ?? "ARS"}
														size="sm"
													/>
												</div>

												{(form.watch("movement.increment") || form.watch("movement.decrement")) && form.watch("exchangeRate") && (
													<div className="flex gap-1 items-center">
														<p className='text-xs'>
															{formatPrice(form.watch("movement.increment") || form.watch("movement.decrement") || "0")}
														</p>
														<CurrencyBadge
															currency={dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId"))?.currency ?? "ARS"}
															size="sm"
														/>
														<p className='text-xs'>=</p>
														<p className='text-xs'>
															{formatPrice(
																dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId"))?.currency === form.watch("fromCurrency") ?
																	Number(form.watch("movement.increment") || form.watch("movement.decrement") || "0") *
																	Number(form.watch("exchangeRate") || "1")
																	:
																	Number(form.watch("movement.increment") || form.watch("movement.decrement") || "0") /
																	Number(form.watch("exchangeRate") || "1")
															)}
														</p>
														<CurrencyBadge
															currency={dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.currency ?? "ARS"}
															size="sm"
														/>
													</div>
												)}
											</div>
										)}

										{/* Botones de acción */}
										<div className="flex justify-between gap-2">
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="outline"
														size="sm"
														type="button"
														className="h-8"
														onClick={() => { setOpenDialog('special') }}
														disabled={create.isPending}
													>
														<FileStack className="h-3.5 w-3.5" />
														<TooltipContent className="bg-background border">
															<p className="text-foreground">
																Operaciones especiales
															</p>
														</TooltipContent>
													</Button>
												</TooltipTrigger>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant="secondary"
														size="sm"
														type="button"
														className="h-8 gap-2"
														onClick={() => { setShowMultipleTransactionForm(true) }}
														disabled={create.isPending}
													>
														<ArrowRightLeft className="h-3.5 w-3.5" />
														<TooltipContent className="bg-background border">
															<p className="text-foreground">Operación múltiple</p>
														</TooltipContent>
													</Button>
												</TooltipTrigger>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button form="createTransaction" size="sm" type="submit" disabled={create.isPending}>
														{create.isPending ? (
															<Icons.spinner className="h-3.5 w-3.5 animate-spin" />
														) : (
															<>
																<PlusCircle className="size-4" />
																<TooltipContent className="bg-background border">
																	<p className="text-foreground">Crear transacción</p>
																</TooltipContent>
															</>
														)}
													</Button>
												</TooltipTrigger>
											</Tooltip>
										</div>
									</div>
									{/* Campos del formulario */}
									<div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 w-full">
										{/* Fecha */}
										<FormField
											control={form.control}
											name="date" // El nombre del campo en tu schema Zod
											render={({ field }) => ( // `field` contiene `value`, `onChange`, `onBlur`, `name`, `ref`
												<FormItem className="flex flex-col">
													<FormControl>
														<DateInput
															value={field.value}
															onChange={field.onChange}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										{/* Empresa origen (solo para transacciones entre empresas) */}
										<FormField
											control={form.control}
											name="fromBusinessId"
											render={({ field }) => (
												<FormItem className={`${transactionType === "outbound" ? "flex flex-col" : "hidden"}`}>
													<Button
														variant="outline"
														onClick={() => setBusinessDialogOpen('from')}
														className="w-full justify-between text-left font-normal overflow-hidden text-xs"
														type="button"
													>
														{field.value && businesses?.find(b => b.id === field.value)
															? businesses.find(b => b.id === field.value)?.name
															: "Empresa desde"}
														<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
													</Button>
													<FormMessage />

													{/* Dialog para seleccionar empresa origen */}
													<Dialog open={businessDialogOpen === 'from'} onOpenChange={() => setBusinessDialogOpen(null)}>
														<DialogContent className="max-w-[80vw] max-h-[80vh] h-fit w-fit overflow-y-auto">
															<DialogHeader>
																<DialogTitle>Seleccionar empresa origen</DialogTitle>
																<DialogDescription>
																	Elige la empresa desde la cual se realizará la transacción
																</DialogDescription>
															</DialogHeader>

															<Command className="rounded-lg border shadow-md">
																<CommandInput placeholder="Buscar empresa..." />
																<CommandList>
																	<CommandEmpty>No se encontraron empresas.</CommandEmpty>
																	<CommandGroup>
																		{businesses?.filter(b => {
																			// En contexto de business o account, solo mostrar la empresa del businessSlug
																			if (context === 'business' || context === 'account') {
																				return b.businessSlug === params.businessSlug as string;
																			}

																			// En contexto de guild, mostrar todas menos la empresa de destino ya seleccionada
																			return b.id !== form.watch("toBusinessId");
																		}).map((business) => (
																			<CommandItem
																				key={business.id}
																				value={business.name}
																				onSelect={() => {
																					form.setValue('fromBusinessId', business.id);
																					// Limpiar campo de cuenta origen al cambiar empresa
																					form.setValue('fromAccountId', '');
																					setBusinessDialogOpen(null);
																				}}
																			>
																				<Check
																					className={cn(
																						"mr-2 h-4 w-4",
																						business.id === field.value ? "opacity-100" : "opacity-0"
																					)}
																				/>
																				{business.name}
																			</CommandItem>
																		))}
																	</CommandGroup>
																</CommandList>
															</Command>

															<DialogFooter>
																<Button
																	variant="outline"
																	onClick={() => setBusinessDialogOpen(null)}
																>
																	Cancelar
																</Button>
															</DialogFooter>
														</DialogContent>
													</Dialog>
												</FormItem>
											)}
										/>

										{/* Empresa destino */}
										<FormField
											control={form.control}
											name="toBusinessId"
											render={({ field }) => (
												<FormItem>
													<Button
														variant="outline"
														onClick={() => setBusinessDialogOpen('to')}
														className="w-full justify-between text-left font-normal overflow-hidden text-xs"
														type="button"
													>
														{field.value && businesses?.find(b => b.id === field.value)
															? businesses.find(b => b.id === field.value)?.name
															: "Empresa hacia"}
														<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
													</Button>
													<FormMessage />

													{/* Dialog para seleccionar empresa destino */}
													<Dialog open={businessDialogOpen === 'to'} onOpenChange={() => setBusinessDialogOpen(null)}>
														<DialogContent className="max-w-[80vw] max-h-[80vh] h-fit w-fit overflow-y-auto">
															<DialogHeader>
																<DialogTitle>Seleccionar empresa destino</DialogTitle>
																<DialogDescription>
																	Elige la empresa hacia la cual se realizará la transacción
																</DialogDescription>
															</DialogHeader>

															<Command className="rounded-lg border shadow-md">
																<CommandInput placeholder="Buscar empresa..." />
																<CommandList>
																	<CommandEmpty>No se encontraron empresas.</CommandEmpty>
																	<CommandGroup>
																		{businesses?.filter(b => {
																			if (transactionType === "outbound") {
																				// En transacciones entre empresas
																				if (context === "guild") {
																					// En contexto de guild, mostrar todas menos la empresa de origen ya seleccionada
																					return b.id !== form.watch("fromBusinessId");
																				} else if (context === "business" || context === "account") {
																					// En contexto de business o account, mostrar todas excepto la del businessSlug
																					return b.businessSlug !== params.businessSlug as string;
																				}
																			} else {
																				// En transacciones dentro de la misma empresa
																				if (context === "business" || context === "account") {
																					// En contexto de business o account, solo mostrar la empresa del businessSlug
																					return b.businessSlug === params.businessSlug as string;
																				}
																				// En contexto de guild, mostrar todas
																				return true;
																			}
																		}).map((business) => (
																			<CommandItem
																				key={business.id}
																				value={business.name}
																				onSelect={() => {
																					form.setValue('toBusinessId', business.id);
																					setBusinessDialogOpen(null);
																				}}
																			>
																				<Check
																					className={cn(
																						"mr-2 h-4 w-4",
																						business.id === field.value ? "opacity-100" : "opacity-0"
																					)}
																				/>
																				{business.name}
																			</CommandItem>
																		))}
																	</CommandGroup>
																</CommandList>
															</Command>

															<DialogFooter>
																<Button
																	variant="outline"
																	onClick={() => setBusinessDialogOpen(null)}
																>
																	Cancelar
																</Button>
															</DialogFooter>
														</DialogContent>
													</Dialog>
												</FormItem>
											)}
										/>

										{/* Cuenta origen */}
										<FormField
											control={form.control}
											name="fromAccountId"
											render={({ field }) => (
												<FormItem>
													<Button
														variant="outline"
														onClick={() => {
															const businessIdForFromDialog = transactionType === 'inbound' ? form.watch("toBusinessId") : form.watch("fromBusinessId");
															if (!businessIdForFromDialog) {
																toast.error(transactionType === 'inbound' ? "Primero seleccione la empresa de destino." : "Primero seleccione la empresa de origen.");
																return;
															}
															setAccountDialogOpen('from');
															setSearchTerm("");
														}}
														className="w-full justify-between text-left font-normal overflow-hidden text-xs h-9"
														type="button"
														disabled={(transactionType === 'inbound' && !form.watch("toBusinessId")) || (transactionType === 'outbound' && !form.watch("fromBusinessId")) || isLoadingFromPerms || isLoadingMemberInGuild}
													>
														{currentFromDictionaryAccount ? (
															<div className="flex items-center justify-between w-full">
																<span className="truncate">
																	{/* Un DictionaryAccount no tiene un 'name' de AccountOnBusiness, solo su propio nombre */}
																	{currentFromDictionaryAccount.name}
																</span>
																<CurrencyBadge
																	currency={currentFromDictionaryAccount.currency as Currency}
																	size="sm"
																	className="ml-1 shrink-0"
																/>
															</div>
														) : ("Cuenta desde")}
														<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
													</Button>
													<FormMessage />
													<Dialog open={accountDialogOpen === 'from'} onOpenChange={() => setAccountDialogOpen(null)}>
														<DialogContent className="max-w-[90vw] sm:max-w-[50vw] max-h-[80vh] h-full w-full flex-1 flex flex-col">
															<DialogHeader>
																<DialogTitle>Seleccionar cuenta origen</DialogTitle>
																<DialogDescription>Elige la cuenta desde la cual se realizará la transacción</DialogDescription>
															</DialogHeader>
															<div className="flex flex-col gap-4 flex-grow min-h-0">
																<Input placeholder="Buscar cuenta..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="mb-2" />
															<ScrollArea className="">
																	<Table>
																		<TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Moneda</TableHead><TableHead></TableHead></TableRow></TableHeader>
																		<TableBody>
																			{isLoadingMemberInGuild || (currentMemberInGuild?.role === 'MEMBER' && isLoadingFromPerms) ? (
																				<TableRow><TableCell colSpan={4} className="text-center h-24"><Icons.spinner className="animate-spin mx-auto h-6 w-6" /></TableCell></TableRow>
																			) : getPermittedDictionaryAccounts('from').length === 0 ? (
																				<TableRow><TableCell colSpan={4} className="text-center h-24">No hay cuentas de origen disponibles.</TableCell></TableRow>
																			) : (
																				getPermittedDictionaryAccounts('from').map((dictAcc) => ( // Iterar sobre DictionaryAccount
																					<TableRow
																						key={dictAcc.id} // Usar dictAcc.id
																						className={cn("hover:bg-muted/50 cursor-pointer", dictAcc.id === field.value && "bg-muted")}
																						onClick={() => {
																							form.setValue('fromAccountId', dictAcc.id); // Guardar DictionaryAccount.id
																							// fromBusinessId ya debería estar seteado
																							// fromCurrency se seteará por el useEffect que observa fromAccountId
																							if (dictAcc.hasSubAccounts) { } else if (form.watch("entityId") && !isAnySelectedAccountAggregated()) { form.setValue("entityId", ""); }
																							setAccountDialogOpen(null);
																						}}
																					>
																						<TableCell><div className="flex items-center"><span className="font-medium truncate">{dictAcc.name}</span>{dictAcc.hasSubAccounts && (<Badge variant="secondary" className="ml-2 text-xs shrink-0">Agregada</Badge>)}</div></TableCell>
																						<TableCell>{getTypeLabel(dictAcc.accountType)}</TableCell>
																						<TableCell><CurrencyBadge currency={dictAcc.currency as Currency} size="sm" /></TableCell>
																						<TableCell className="text-right">{dictAcc.id === field.value && (<Check className="h-4 w-4 text-primary ml-auto" />)}</TableCell>
																					</TableRow>
																				))
																			)}
																		</TableBody>
																	</Table>
																</ScrollArea>
															</div>
															<DialogFooter><Button variant="outline" onClick={() => setAccountDialogOpen(null)}>Cancelar</Button></DialogFooter>
														</DialogContent>
													</Dialog>
												</FormItem>
											)}
										/>

										{/* To AccountId Field */}
										<FormField
											control={form.control}
											name="toAccountId"
											render={({ field }) => (
												<FormItem>
													<Button
														variant="outline"
														onClick={() => {
															if (!form.watch("toBusinessId")) { toast.error("Primero seleccione la empresa de destino."); return; }
															setAccountDialogOpen('to');
															setSearchTerm("");
														}}
														className="w-full justify-between text-left font-normal overflow-hidden text-xs h-9"
														type="button"
														disabled={!form.watch("toBusinessId") || formLogic.isAccountSelectionDisabled_TO || isLoadingToPerms || isLoadingMemberInGuild}
													>
														{currentToDictionaryAccount ? (
															<div className="flex items-center justify-between gap-1 w-full overflow-hidden">
																<span className="truncate">
																	{currentToDictionaryAccount.name}
																</span>
																<CurrencyBadge
																	currency={currentToDictionaryAccount.currency as Currency}
																	size="sm"
																	className="shrink-0"
																/>
															</div>
														) : ("Cuenta hacia")}
														<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
													</Button>
													<FormMessage />
													<Dialog open={accountDialogOpen === 'to'} onOpenChange={() => setAccountDialogOpen(null)}>
														<DialogContent className="max-w-[90vw] sm:max-w-[50vw] max-h-[80vh] h-full w-full flex-1 flex flex-col">
															<DialogHeader>
																<DialogTitle>Seleccionar cuenta destino</DialogTitle>
																<DialogDescription>Elige la cuenta a la cual se realizará la transacción</DialogDescription>
															</DialogHeader>
															<div className="flex flex-col h-full gap-4 flex-grow min-h-0">
																<Input placeholder="Buscar cuenta..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="mb-2" />
																<ScrollArea className="">
																	<Table className="">
																		<TableHeader><TableRow><TableHead>Nombre</TableHead><TableHead>Tipo</TableHead><TableHead>Moneda</TableHead><TableHead></TableHead></TableRow></TableHeader>
																		<TableBody>
																			{isLoadingMemberInGuild || (currentMemberInGuild?.role === 'MEMBER' && isLoadingFromPerms) ? (
																				<TableRow><TableCell colSpan={4} className="text-center h-24"><Icons.spinner className="animate-spin mx-auto h-6 w-6" /></TableCell></TableRow>
																			) : getPermittedDictionaryAccounts('to').length === 0 ? (
																				<TableRow><TableCell colSpan={4} className="text-center h-24">No hay cuentas de origen disponibles.</TableCell></TableRow>
																			) : (
																				getPermittedDictionaryAccounts('to').map((dictAcc) => ( // Iterar sobre DictionaryAccount
																					<TableRow
																						key={dictAcc.id} // Usar dictAcc.id
																						className={cn("hover:bg-muted/50 cursor-pointer", dictAcc.id === field.value && "bg-muted")}
																						onClick={() => {
																							form.setValue('toAccountId', dictAcc.id); // Guardar DictionaryAccount.id
																							// fromBusinessId ya debería estar seteado
																							// fromCurrency se seteará por el useEffect que observa fromAccountId
																							if (dictAcc.hasSubAccounts) { } else if (form.watch("entityId") && !isAnySelectedAccountAggregated()) { form.setValue("entityId", ""); }
																							setAccountDialogOpen(null);
																						}}
																					>
																						<TableCell><div className="flex items-center"><span className="font-medium truncate">{dictAcc.name}</span>{dictAcc.hasSubAccounts && (<Badge variant="secondary" className="ml-2 text-xs shrink-0">Agregada</Badge>)}</div></TableCell>
																						<TableCell>{getTypeLabel(dictAcc.accountType)}</TableCell>
																						<TableCell><CurrencyBadge currency={dictAcc.currency as Currency} size="sm" /></TableCell>
																						<TableCell className="text-right">{dictAcc.id === field.value && (<Check className="h-4 w-4 text-primary ml-auto" />)}</TableCell>
																					</TableRow>
																				))
																			)}
																		</TableBody>
																	</Table>
																</ScrollArea>
															</div>
															<DialogFooter><Button variant="outline" onClick={() => setAccountDialogOpen(null)}>Cancelar</Button></DialogFooter>
														</DialogContent>
													</Dialog>
												</FormItem>
											)}
										/>

										{/* Subcuenta (Entidad) */}
										<FormField
											control={form.control}
											name="entityId"
											render={({ field }) => (
												<FormItem>
													<Button
														variant="outline"
														className={cn(
															"w-full justify-between text-left font-normal text-xs",
															isEntityRequired() && !field.value && "border-red-500"
														)}
														onClick={() => setEntityDialogOpen(true)}
														type="button"
														disabled={!dictionaryAccounts?.find(d =>
															(d.id === form.watch("fromAccountId") || d.id === form.watch("toAccountId"))
															&& d.hasSubAccounts
														)}
													>
														{getSelectedEntityName(field.value) ||
															(isEntityRequired() ? "Subcuenta" : "Subcuenta")}
														<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
													</Button>
													<FormMessage />

													{/* Dialog para seleccionar entidad */}
													<Dialog open={entityDialogOpen} onOpenChange={setEntityDialogOpen}>
														<DialogContent className="max-w-[80vw] max-h-[80vh] h-fit w-fit overflow-y-auto">
															<DialogHeader>
																<DialogTitle>Seleccionar subcuenta</DialogTitle>
																<DialogDescription>
																	Elige la entidad específica para esta transacción
																</DialogDescription>
															</DialogHeader>

															<Command className="rounded-lg border shadow-md">
																<CommandInput placeholder="Buscar subcuenta..." />
																<CommandList>
																	<CommandEmpty>No se encontraron entidades.</CommandEmpty>
																	{getAvailableEntities().map((entityGroup) => (
																		<CommandGroup key={entityGroup.type} heading={entityGroup.type as EntityType}>
																			{entityGroup.items.map((item) => (
																				<CommandItem
																					key={item.id}
																					value={item.name}
																					onSelect={() => {
																						form.setValue('entityId', item.id);
																						form.clearErrors('entityId');
																						setEntityDialogOpen(false);
																					}}
																				>
																					<Check
																						className={cn(
																							"mr-2 h-4 w-4",
																							item.id === field.value ? "opacity-100" : "opacity-0"
																						)}
																					/>
																					{item.name}
																				</CommandItem>
																			))}
																		</CommandGroup>
																	))}
																</CommandList>
															</Command>

															<DialogFooter>
																<Button
																	variant="outline"
																	onClick={() => setEntityDialogOpen(false)}
																>
																	Cancelar
																</Button>
															</DialogFooter>
														</DialogContent>
													</Dialog>
												</FormItem>
											)}
										/>
										<FormField
											control={form.control}
											name="about"
											render={({ field }) => {
												return (
													<FormItem className="col-span-1">
														<Button
															variant="outline"
															onClick={() => setDescriptionDialogOpen(true)}
															className="w-full justify-between text-left font-normal h-9"
															type="button"
														>
															<span className="truncate text-xs">
																{field.value ? field.value : "Descripción"}
															</span>
														</Button>
														<FormMessage />

														<Dialog open={descriptionDialogOpen} onOpenChange={setDescriptionDialogOpen}>
															<DialogContent className="max-w-[80vw] max-h-[80vh] h-fit w-fit overflow-y-auto">
																<DialogHeader>
																	<DialogTitle>Detalles de la transacción</DialogTitle>
																	<DialogDescription>
																		Ingresa una descripción para esta transacción
																	</DialogDescription>
																</DialogHeader>

																<FormControl>
																	<Textarea
																		placeholder="Descripción"
																		className="resize-none min-h-[150px]"
																		{...field}
																	/>
																</FormControl>

																<DialogFooter>
																	<Button
																		variant="outline"
																		onClick={() => setDescriptionDialogOpen(false)}
																	>
																		Guardar
																	</Button>
																</DialogFooter>
															</DialogContent>
														</Dialog>
													</FormItem>
												);
											}}
										/>
										{/* Categoría */}
										<FormField
											control={form.control}
											name="categoryId"
											render={({ field }) => (
												<FormItem>
													<Button
														variant="outline"
														onClick={() => setCategoryDialogOpen(true)}
														className="w-full justify-between text-left font-normal overflow-hidden text-xs"
														type="button"
														disabled={!form.watch("toAccountId")}
													>
														{field.value && dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.categoriesOnDictionaryAccounts?.find((item) => item.categoryId === field.value)?.category?.name
															? dictionaryAccounts.find((item) => item.id === form.watch("toAccountId"))?.categoriesOnDictionaryAccounts?.find((item) => item.categoryId === field.value)?.category?.name
															: "Categoría"}
														<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
													</Button>
													<FormMessage />

													{/* Dialog para seleccionar categoría */}
													<Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
														<DialogContent className="max-w-[80vw] max-h-[80vh] h-fit w-fit overflow-y-auto">
															<DialogHeader>
																<DialogTitle>Seleccionar categoría</DialogTitle>
																<DialogDescription>
																	Elige la categoría para esta transacción
																</DialogDescription>
															</DialogHeader>

															<Command className="rounded-lg border shadow-md">
																<CommandInput placeholder="Buscar categoría..." />
																<CommandList>
																	<CommandEmpty>No se encontraron categorías.</CommandEmpty>
																	<CommandGroup>
																		{dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.categoriesOnDictionaryAccounts?.map((categoryOnDictionaryAccount) => (
																			<CommandItem
																				key={categoryOnDictionaryAccount.categoryId}
																				value={categoryOnDictionaryAccount.category?.name}
																				onSelect={() => {
																					if (categoryOnDictionaryAccount.categoryId === field.value) {
																						form.setValue("categoryId", "");
																					} else {
																						form.setValue("categoryId", categoryOnDictionaryAccount.categoryId);
																					}
																					setCategoryDialogOpen(false);
																				}}
																			>
																				<Check
																					className={cn(
																						"mr-2 h-4 w-4",
																						categoryOnDictionaryAccount.categoryId === field.value ? "opacity-100" : "opacity-0"
																					)}
																				/>
																				{categoryOnDictionaryAccount.category?.name}
																			</CommandItem>
																		))}
																	</CommandGroup>
																</CommandList>
															</Command>

															<DialogFooter>
																<Button
																	variant="outline"
																	onClick={() => setCategoryDialogOpen(false)}
																>
																	Cancelar
																</Button>
															</DialogFooter>
														</DialogContent>
													</Dialog>
												</FormItem>
											)}
										/>

										{/* Tipo de cambio - Mostrar solo cuando sea necesario */}
										{showExchangeRate() && (
											<>
												<FormField
													control={form.control}
													name="exchangeRate"
													render={({ field }) => (
														<FormItem>
															<FormControl>
																<CurrencyInput
																	required={showExchangeRate()}
																	className="resize-none bg-background py-2 px-1 h-min text-xs min-w-20"
																	placeholder="Cotización"
																	{...field}
																/>
															</FormControl>
															<FormMessage />
														</FormItem>
													)}
												/>

												<FormField
													control={form.control}
													name="fromCurrency"
													render={({ field }) => (
														<FormItem>
															<Select
																onValueChange={field.onChange}
																value={field.value}
																required={showExchangeRate()}
															>
																<SelectTrigger className="bg-background py-2 h-8 px-2 text-xs w-full">
																	<SelectValue placeholder="Tipo de cambio">
																		{field.value ? (
																			<div className="flex items-center gap-1">
																				<CurrencyBadge
																					currency={[
																						dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId")),
																						dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))
																					].find((item) => item?.currency === field.value)?.currency ?? "ARS"}
																					size="sm"
																				/>
																				<span className="font-thin">/</span>
																				<CurrencyBadge
																					currency={[
																						dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId")),
																						dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))
																					].find((item) => item?.currency !== field.value)?.currency ?? "ARS"}
																					size="sm"
																				/>
																			</div>
																		) : "Tipo de cambio"}
																	</SelectValue>
																</SelectTrigger>
																<SelectContent>
																	{(dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.currency &&
																		dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId"))?.currency) && (
																			<>
																				<SelectItem
																					value={dictionaryAccounts.find((item) => item.id === form.watch("toAccountId"))?.currency ?? "ARS"}
																				>
																					<div className="flex items-center gap-1">
																						<CurrencyBadge
																							currency={dictionaryAccounts.find((item) => item.id === form.watch("toAccountId"))?.currency ?? "ARS"}
																							size="sm"
																						/>
																						<span className="font-thin">/</span>
																						<CurrencyBadge
																							currency={dictionaryAccounts.find((item) => item.id === form.watch("fromAccountId"))?.currency ?? "ARS"}
																							size="sm"
																						/>
																					</div>
																				</SelectItem>
																				<SelectItem
																					value={dictionaryAccounts.find((item) => item.id === form.watch("fromAccountId"))?.currency ?? "ARS"}
																				>
																					<div className="flex items-center gap-1">
																						<CurrencyBadge
																							currency={dictionaryAccounts.find((item) => item.id === form.watch("fromAccountId"))?.currency ?? "ARS"}
																							size="sm"
																						/>
																						<span className="font-thin">/</span>
																						<CurrencyBadge
																							currency={dictionaryAccounts.find((item) => item.id === form.watch("toAccountId"))?.currency ?? "ARS"}
																							size="sm"
																						/>
																					</div>
																				</SelectItem>
																			</>
																		)}
																</SelectContent>
															</Select>
															<FormMessage />
														</FormItem>
													)}
												/>
											</>
										)}
										<FormField
											control={form.control}
											name="movement.decrement"
											disabled={shouldDisableInput({
												fromAccountType: dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId"))?.accountType,
												toAccountType: dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.accountType,
												movementType: "DECREMENT",
											})}
											render={({ field }) => (
												<FormItem>
													<FormControl>
														<CurrencyInput
															className="resize-none bg-background py-2 px-1 h-min text-xs"
															placeholder="$ Decremento"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="movement.increment"
											disabled={shouldDisableInput({
												fromAccountType: dictionaryAccounts?.find((item) => item.id === form.watch("fromAccountId"))?.accountType,
												toAccountType: dictionaryAccounts?.find((item) => item.id === form.watch("toAccountId"))?.accountType,
												movementType: "INCREMENT",
											})}
											render={({ field }) => (
												<FormItem>
													<FormControl>
														<CurrencyInput
															className="resize-none bg-background py-2 px-1 h-min text-xs"
															placeholder="$ Incremento"
															{...field}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
								</div>
							</form>
						</Form>
					</CardContent>
				</Card>

				<SpecialDialog
					context={context !== "account" ? context : "guild"}
					openDialog={openDialog}
					setOpenDialog={setOpenDialog}
					createdChecks={createdChecks}
					setCreatedChecks={setCreatedChecks}
				/>
				<MultipleTransactionForm
					open={showMultipleTransactionForm}
					onOpenChange={setShowMultipleTransactionForm}
				/>
				{/* <DocumentsDialog
                    openDialog={openDialog}
                    setOpenDialog={setOpenDialog}
                    form={form}
                    transactionType={transactionType}
                    dictionaryAccounts={dictionaryAccounts}
                /> */}
			</div>
		</TooltipProvider >
	);
}