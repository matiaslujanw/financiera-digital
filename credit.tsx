"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { ManipulateType } from "dayjs";
import { BellIcon, Check, ChevronsUpDown, PlusCircle } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Currency, PaymentPeriodicityEnum } from "@acme/db/schema";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@acme/ui/command";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useForm,
} from "@acme/ui/form";
import { Icons } from "@acme/ui/icons";
import { Input } from "@acme/ui/input";
import { Label } from "@acme/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@acme/ui/popover";
import { ScrollArea } from "@acme/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@acme/ui/select";
import { Separator } from "@acme/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@acme/ui/table";
import { Textarea } from "@acme/ui/textarea";
import { createCreditSchema } from "@acme/validators";

import { DateInput } from "~/app/(app)/_components/date-input";
import { CurrencyBadge } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/badge";
import { CurrencyInput } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/input";
import { useTRPC } from "~/trpc/react";
import { dayjs } from "~/utils/dayjs";
import { formatDate, formatPrice } from "~/utils/format";
import { type OpenDialog } from "~/utils/types";
import { CreatePersonDialog } from "../../../(entities)/people/_components/create-person-dialog";

interface CreateCreditFormProps {
  defaultBusinessId?: string;
  setOpenDialog: React.Dispatch<React.SetStateAction<OpenDialog>>;
}

const periodicityOptions = Object.values(PaymentPeriodicityEnum.enumValues).map(
  (value) => {
    switch (value) {
      case "ANNUALLY":
        return { value, label: "Anual" };
      case "SEMIANNUALLY":
        return { value, label: "Semestral" };
      case "QUARTERLY":
        return { value, label: "Trimestral" };
      case "BIMONTHLY":
        return { value, label: "Bimensual" };
      case "MONTHLY":
        return { value, label: "Mensual" };
      case "BIWEEKLY":
        return { value, label: "Quincenal" };
      case "WEEKLY":
        return { value, label: "Semanal" };
      case "DAILY":
        return { value, label: "Diario" };
      default:
        return { value, label: value };
    }
  },
);

const alertOptions = [
  { value: "NONE", label: "Ninguna" },
  { value: "ON_DUE", label: "Al vencimiento" },
  { value: "1_DAY_BEFORE", label: "1 día antes" },
  { value: "2_DAYS_BEFORE", label: "2 días antes" },
  { value: "1_WEEK_BEFORE", label: "1 semana antes" },
];

function PaymentPlanPreview({
  formValues,
}: {
  formValues: z.infer<typeof createCreditSchema>;
}) {
  const {
    grossValue,
    totalInterestToPay,
    numberOfInstallments,
    paymentPeriodicity,
    purchaseDate,
  } = formValues;

  const installmentPlan = useMemo(() => {
    const gv = parseFloat(grossValue.replace(",", ".")) || 0;
    const ti = parseFloat(totalInterestToPay.replace(",", ".")) || 0;
    if (
      !gv ||
      !numberOfInstallments ||
      numberOfInstallments <= 0 ||
      !purchaseDate
    )
      return [];

    const interestPerInstallment = ti / numberOfInstallments;

    let unit: ManipulateType = "month";
    let multiplier = 1;
    switch (paymentPeriodicity) {
      case "DAILY":
        unit = "day";
        break;
      case "WEEKLY":
        unit = "week";
        break;
      case "BIWEEKLY":
        unit = "week";
        multiplier = 2;
        break;
      case "BIMONTHLY":
        unit = "month";
        multiplier = 2;
        break;
      case "QUARTERLY":
        unit = "month";
        multiplier = 3;
        break;
      case "SEMIANNUALLY":
        unit = "month";
        multiplier = 6;
        break;
      case "ANNUALLY":
        unit = "year";
        break;
      default:
        unit = "month";
    }

    const firstPaymentDueDate = dayjs(purchaseDate).add(multiplier, unit);

    return Array.from({ length: numberOfInstallments }, (_, i) => {
      const dueDate = dayjs(firstPaymentDueDate).add(i * multiplier, unit);
      return {
        number: i + 1,
        dueDate: dueDate.toDate(),
        interest: interestPerInstallment,
      };
    });
  }, [
    grossValue,
    totalInterestToPay,
    numberOfInstallments,
    paymentPeriodicity,
    purchaseDate,
  ]);

  if (installmentPlan.length === 0) return null;

  return (
    <Card className="mt-4 md:col-span-4">
      <CardHeader>
        <CardTitle className="text-base">
          Plan de pagos de interés (preliminar)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-48">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuota</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Monto Interés</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {installmentPlan.map((inst) => (
                <TableRow key={inst.number}>
                  <TableCell>{inst.number}</TableCell>
                  <TableCell>{formatDate(inst.dueDate)}</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatPrice(inst.interest)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export function Credit({
  defaultBusinessId,
  setOpenDialog,
}: CreateCreditFormProps) {
  const params = useParams();
  const guildSlug = params.guildSlug as string;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [toAccountDialogOpen, setToAccountDialogOpen] = useState(false);
  const [toBusinessDialogOpen, setToBusinessDialogOpen] = useState(false);
  const [showCreatePersonDialog, setShowCreatePersonDialog] = useState(false);

  const { data: people, refetch: refetchPeople } = useSuspenseQuery(
    trpc.person.byGuildSlug.queryOptions({ guildSlug }),
  );
  const { data: businesses } = useSuspenseQuery(
    trpc.business.byGuildSlug.queryOptions({ guildSlug }),
  );
  const { data: dictionaryAccounts } = useSuspenseQuery(
    trpc.dictionaryAccount.byGuildSlug.queryOptions({ guildSlug }),
  );

  const form = useForm({
    schema: createCreditSchema,
    defaultValues: {
      guildSlug,
      toBusinessId: defaultBusinessId ?? businesses?.[0]?.id ?? "",
      accountId: "",
      personId: "",
      interestPercentage: "",
      purchaseDate: dayjs().toDate(),
      grossValue: "",
      totalInterestToPay: "",
      numberOfInstallments: 1,
      paymentPeriodicity: "MONTHLY",
      about: "",
      alert1: "1_DAY_BEFORE",
      alert2: "NONE",
    },
  });

  const createCreditMutation = useMutation(
    trpc.credit.create.mutationOptions({
      onSuccess: async () => {
        toast.success("Crédito creado con éxito!");
        await queryClient.invalidateQueries(
          trpc.credit.byGuildSlugWithCursor.pathFilter(),
        );
        await queryClient.invalidateQueries(
          trpc.credit.countByGuildSlug.pathFilter(),
        );
        await queryClient.invalidateQueries(trpc.transaction.pathFilter());
        await queryClient.invalidateQueries(
          trpc.accountOnBusiness.pathFilter(),
        );
        setOpenDialog("none");
      },
      onError: (error) =>
        toast.error("Error al crear el crédito", {
          description: error.message,
        }),
    }),
  );

  function onSubmit(data: z.infer<typeof createCreditSchema>) {
    createCreditMutation.mutate(data);
  }

  const availableDestinationAccounts = useMemo(() => {
    if (!dictionaryAccounts) return [];
    return dictionaryAccounts.filter((da) => da.accountType === "ASSET");
  }, [dictionaryAccounts]);

  const calculatedInterestAmount = useMemo(() => {
    const grossValueNum =
      parseFloat(form.watch("grossValue")?.replace(",", ".")) || 0;
    const percentageNum =
      parseFloat(form.watch("interestPercentage")?.replace(",", ".") ?? "0") ||
      0;
    if (grossValueNum > 0 && percentageNum > 0) {
      return (grossValueNum * percentageNum) / 100;
    }
    return 0;
  }, [form.watch("grossValue"), form.watch("interestPercentage")]);

  useEffect(() => {
    form.setValue(
      "totalInterestToPay",
      calculatedInterestAmount > 0
        ? calculatedInterestAmount.toFixed(2).replace(".", ",")
        : "",
    );
  }, [calculatedInterestAmount, form]);

  const formValues = form.watch();

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 overflow-y-auto p-1"
      >
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={createCreditMutation.isPending}>
            {createCreditMutation.isPending && (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            )}
            Crear Crédito
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-4">
          <FormField
            control={form.control}
            name="toBusinessId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Empresa que Recibe</FormLabel>
                <Popover
                  open={toBusinessDialogOpen}
                  onOpenChange={setToBusinessDialogOpen}
                >
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between",
                          !field.value && "text-muted-foreground",
                        )}
                        disabled={!!defaultBusinessId}
                      >
                        {field.value
                          ? businesses?.find((b) => b.id === field.value)?.name
                          : "Seleccionar empresa"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar empresa..." />
                      <CommandList>
                        <CommandEmpty>No encontrada.</CommandEmpty>
                        <CommandGroup>
                          {businesses.map((business) => (
                            <CommandItem
                              value={business.id}
                              key={business.id}
                              onSelect={() => {
                                form.setValue("toBusinessId", business.id);
                                form.setValue("accountId", "");
                                setToBusinessDialogOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  business.id === field.value
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
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
                <FormLabel>Cuenta Destino (Ingreso)</FormLabel>
                <Popover
                  open={toAccountDialogOpen}
                  onOpenChange={setToAccountDialogOpen}
                >
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between",
                          !field.value && "text-muted-foreground",
                        )}
                        disabled={!form.watch("toBusinessId")}
                      >
                        <div className="flex items-center gap-2">
                          {field.value
                            ? availableDestinationAccounts?.find(
                                (acc) => acc.id === field.value,
                              )?.name
                            : "Seleccionar cuenta"}
                          {field.value && (
                            <CurrencyBadge
                              currency={
                                availableDestinationAccounts?.find(
                                  (acc) => acc.id === field.value,
                                )?.currency as Currency
                              }
                              size="sm"
                              className="ml-2"
                            />
                          )}
                        </div>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar cuenta..." />
                      <CommandList>
                        <CommandEmpty>No hay cuentas de activo.</CommandEmpty>
                        <CommandGroup>
                          {availableDestinationAccounts?.map((dictAccount) => (
                            <CommandItem
                              value={dictAccount.id}
                              key={dictAccount.id}
                              onSelect={() => {
                                form.setValue("accountId", dictAccount.id);
                                setToAccountDialogOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  dictAccount.id === field.value
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
                              {dictAccount.name}
                              <CurrencyBadge
                                currency={dictAccount.currency as Currency}
                                size="sm"
                                className="ml-auto"
                              />
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
                <FormLabel>Acreedor (Quién presta)</FormLabel>
                <Popover
                  open={personDialogOpen}
                  onOpenChange={setPersonDialogOpen}
                >
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between",
                          !field.value && "text-muted-foreground",
                        )}
                      >
                        {field.value
                          ? people?.find((p) => p.id === field.value)?.name
                          : "Seleccionar persona"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput placeholder="Buscar persona..." />
                      <CommandList>
                        <CommandEmpty>
                          <Button
                            variant="ghost"
                            className="w-full justify-start text-sm font-normal"
                            onClick={() => {
                              setPersonDialogOpen(false);
                              setShowCreatePersonDialog(true);
                            }}
                          >
                            <PlusCircle className="mr-2 h-4 w-4" /> Crear nueva
                            persona
                          </Button>
                        </CommandEmpty>
                        <CommandGroup>
                          {people?.map((person) => (
                            <CommandItem
                              value={person.id}
                              key={person.id}
                              onSelect={() => {
                                form.setValue("personId", person.id);
                                setPersonDialogOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  person.id === field.value
                                    ? "opacity-100"
                                    : "opacity-0",
                                )}
                              />
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
          <FormField
            control={form.control}
            name="grossValue"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Capital Recibido</FormLabel>
                <FormControl>
                  <CurrencyInput placeholder="100.00" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="interestPercentage"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Interés Total a Pagar (%)</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-2 rounded-md border">
                    <CurrencyInput
                      className="border-0"
                      placeholder="20.00"
                      {...field}
                    />
                    <Separator orientation="vertical" />
                    {form.getValues("grossValue") && (
                      <span className="w-full text-sm">
                        = {formatPrice(calculatedInterestAmount)}
                      </span>
                    )}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="totalInterestToPay"
            render={({ field }) => (
              <FormItem className="hidden">
                <FormControl>
                  <Input {...field} readOnly />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="numberOfInstallments"
            render={({ field }) => (
              <FormItem>
                <FormLabel>N° Cuotas (Interés)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="4"
                    {...field}
                    onChange={(e) =>
                      field.onChange(parseInt(e.target.value, 10) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="paymentPeriodicity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Periodicidad de Pago</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {periodicityOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="purchaseDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha de Recepción</FormLabel>
                <FormControl>
                  <DateInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Label className="md:col-span-4">Recordatorios de Pago</Label>
          <FormField
            control={form.control}
            name="alert1"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <BellIcon className="mr-2 h-4 w-4" />
                      <SelectValue placeholder="Recordatorio 1..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {alertOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
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
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <BellIcon className="mr-2 h-4 w-4" />
                      <SelectValue placeholder="Recordatorio 2..." />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {alertOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="about"
            render={({ field }) => (
              <FormItem className="md:col-span-4">
                <FormLabel>Descripción/Notas (Opcional)</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Notas sobre el crédito..."
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
