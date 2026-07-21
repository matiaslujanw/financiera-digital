// apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/_components/movement/movement-dialog.tsx
"use client"

import { Currency, EntityType } from "@acme/db/schema";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useTRPC } from "~/trpc/react";

import { Button } from "@acme/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@acme/ui/dialog";
import { Input } from "@acme/ui/input";
import { Separator } from "@acme/ui/separator";
import { ChevronDown, ChevronsUpDown, Plus, Trash2 } from "lucide-react";
import { CurrencyBadge } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/badge";
import { CurrencyInput } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/input";
import { Account, AccountSelectionDialog } from "./account-selection-dialog";
import { SubAccountSelectionDialog } from "./subaccount-selection-dialog";
import { cn } from "@acme/ui";
import { formatPrice } from "~/utils/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@acme/ui/select";
import { ExchangeRateDialog } from "./exchange-rate-dialog";

// Tipo para representar una entrada de movimiento
export type MovementEntrySubAccount = {
    id: string;
    entityId: string;
    entityName: string;
    entityType: EntityType;
    amount: string;
}

export type MovementEntry = {
    id: string; // ID único para este ítem en la UI
    businessId: string;
    businessName: string;
    accountId: string;
    accountName: string;
    hasSubAccounts: boolean;
    accountType: string;
    currency: Currency;
    amount: string;
    subAccounts?: MovementEntrySubAccount[];
};

// Tipo para representar un movimiento completo
export type Movement = {
    from: MovementEntry[];
    to: MovementEntry[];
    exchangeRates: Record<string, {
        fromCurrency: Currency;
        toCurrency: Currency;
        rate: string;
    }>;
};

// Props para el diálogo de movimiento
interface MovementDialogProps {
    open: boolean;
    onClose: () => void;
    movement: Movement;
    onMovementChange: (movement: Movement) => void;
    transactionType: string; // "inbound" o "outbound"
}

export function MovementDialog({
    open,
    onClose,
    movement,
    onMovementChange,
    transactionType
}: MovementDialogProps) {
    const params = useParams();
    const trpc = useTRPC();
    const [accountDialogOpen, setAccountDialogOpen] = useState<boolean>(false);
    const [subAccountDialogOpen, setSubAccountDialogOpen] = useState<boolean>(false);
    const [exchangeRateDialogOpen, setExchangeRateDialogOpen] = useState<boolean>(false);
    const [currentSide, setCurrentSide] = useState<"from" | "to">("from");
    const [currentEntryIndex, setCurrentEntryIndex] = useState<number | null>(null);
    const [currentSubAccountIndex, setCurrentSubAccountIndex] = useState<number | null>(null);
    const [currentCurrencyPair, setCurrentCurrencyPair] = useState<{ fromCurrency: Currency, toCurrency: Currency } | null>(null);

    // Función para añadir una nueva entrada de movimiento
    const handleAddAccount = (side: "from" | "to") => {
        setCurrentSide(side);
        setCurrentEntryIndex(null);
        setAccountDialogOpen(true);
    };

    // Función para editar una subcuenta
    const handleEditSubAccount = (side: "from" | "to", accountIndex: number) => {
        if (movement[side][accountIndex]?.hasSubAccounts) {
            setCurrentSide(side);
            setCurrentEntryIndex(accountIndex);
            setSubAccountDialogOpen(true);
        }
    };

    // Función para eliminar una entrada
    const handleRemoveEntry = (side: "from" | "to", index: number) => {
        const updatedMovement = { ...movement };
        updatedMovement[side] = [
            ...movement[side].slice(0, index),
            ...movement[side].slice(index + 1)
        ];

        // Si eliminamos una cuenta, también debemos limpiar sus tipos de cambio asociados
        if (side === "from" && updatedMovement.from.length === 0) {
            // Si ya no hay cuentas de origen, eliminar todos los tipos de cambio
            updatedMovement.exchangeRates = {};
        } else {
            // Eliminar solo los tipos de cambio relacionados con esta moneda
            const currencyToRemove = movement[side][index]?.currency;

            Object.keys(updatedMovement.exchangeRates).forEach(key => {
                const rate = updatedMovement.exchangeRates[key];
                if ((side === "from" && rate?.fromCurrency === currencyToRemove) ||
                    (side === "to" && rate?.toCurrency === currencyToRemove)) {
                    delete updatedMovement.exchangeRates[key];
                }
            });
        }

        onMovementChange(updatedMovement);
    };

    // Función para actualizar el monto de una entrada
    const handleAmountChange = (side: "from" | "to", index: number, amount: string) => {
        const updatedMovement = { ...movement };
        updatedMovement[side] = updatedMovement[side].map((entry, i) =>
            i === index ? { ...entry, amount } : entry
        );
        onMovementChange(updatedMovement);
    };

    // Función para añadir una entrada después de seleccionar una cuenta
    const handleAccountSelected = (account: Account) => {
        const side = currentSide;
        const newEntry: MovementEntry = {
            id: `${side}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            businessId: account.businessId,
            businessName: account.businessName,
            accountId: account.id,
            accountName: account.name,
            hasSubAccounts: account.hasSubAccounts,
            accountType: account.accountType,
            currency: account.currency as Currency,
            amount: "",
            subAccounts: account.hasSubAccounts ? [] : undefined
        };

        const updatedMovement = { ...movement };
        updatedMovement[side] = [...updatedMovement[side], newEntry];
        onMovementChange(updatedMovement);
        setAccountDialogOpen(false);
    };

    // Función para manejar la selección de una subcuenta
    const handleSubAccountSelected = (entityId: string, entityName: string, entityType: EntityType) => {
        if (currentSide === null || currentEntryIndex === null) return;

        const side = currentSide;
        const index = currentEntryIndex;
        const updatedMovement = { ...movement };
        const entry = updatedMovement[side][index];

        // Verificar si ya existe una subcuenta con este ID (para no duplicar)
        if (!entry?.subAccounts?.some(sa => sa.entityId === entityId)) {
            const newSubAccount = {
                id: `subaccount-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                entityId,
                entityName,
                entityType,
                amount: ""
            };

            updatedMovement[side][index] = {
                ...entry,
                subAccounts: [...(entry?.subAccounts || []), newSubAccount]
            };

            onMovementChange(updatedMovement);
        }

        setSubAccountDialogOpen(false);
    };

    // Función para actualizar el monto de una subcuenta
    const handleSubAccountAmountChange = (side: "from" | "to", accountIndex: number, subAccountIndex: number, amount: string) => {
        const updatedMovement = { ...movement };
        const entry = updatedMovement[side][accountIndex];

        if (entry?.subAccounts) {
            entry.subAccounts = entry?.subAccounts.map((subAccount, i) =>
                i === subAccountIndex ? { ...subAccount, amount } : subAccount
            );

            // Actualizar el monto total de la entrada principal
            entry.amount = entry?.subAccounts.reduce((sum, sa) =>
                sum + (parseFloat(sa.amount || "0") || 0), 0).toString();

            onMovementChange(updatedMovement);
        }
    };

    // Función para eliminar una subcuenta
    const handleRemoveSubAccount = (side: "from" | "to", accountIndex: number, subAccountIndex: number) => {
        const updatedMovement = { ...movement };
        const entry = updatedMovement[side][accountIndex];

        if (entry?.subAccounts) {
            entry.subAccounts = [
                ...entry?.subAccounts.slice(0, subAccountIndex),
                ...entry?.subAccounts.slice(subAccountIndex + 1)
            ];

            // Actualizar el monto total de la entrada principal
            entry.amount = entry?.subAccounts.reduce((sum, sa) =>
                sum + (parseFloat(sa.amount || "0") || 0), 0).toString();

            onMovementChange(updatedMovement);
        }
    };

    // Función para abrir el diálogo de tipo de cambio
    const handleOpenExchangeRateDialog = (fromCurrency: Currency, toCurrency: Currency) => {
        setCurrentCurrencyPair({ fromCurrency, toCurrency });
        setExchangeRateDialogOpen(true);
    };

    // Función para establecer un tipo de cambio
    const handleExchangeRateSet = (fromCurrency: Currency, toCurrency: Currency, rate: string) => {
        const key = `${fromCurrency}_${toCurrency}`;
        const updatedMovement = { ...movement };

        updatedMovement.exchangeRates[key] = {
            fromCurrency,
            toCurrency,
            rate
        };

        onMovementChange(updatedMovement);
        setExchangeRateDialogOpen(false);
        setCurrentCurrencyPair(null);
    };

    // Calcular totales por moneda para cada lado
    const getTotals = (side: "from" | "to") => {
        const totals: Record<string, number> = {};

        movement[side].forEach(entry => {
            const currency = entry?.currency;
            let amount = 0;

            // Si es una cuenta agregada, sumar los montos de las subcuentas
            if (entry?.hasSubAccounts && entry?.subAccounts) {
                amount = entry?.subAccounts.reduce((sum, sa) =>
                    sum + (parseFloat(sa.amount || "0") || 0), 0);
            } else {
                amount = parseFloat(entry?.amount || "0") || 0;
            }

            totals[currency] = (totals[currency] || 0) + amount;
        });

        return totals;
    };

    const fromTotals = getTotals("from");
    const toTotals = getTotals("to");

    // Verificar si los totales están balanceados
    const isBalanced = () => {
        // Para casos simples donde solo hay una moneda
        if (Object.keys(fromTotals).length === 1 && Object.keys(toTotals).length === 1 &&
            Object.keys(fromTotals)[0] === Object.keys(toTotals)[0]) {
            const currency = Object.keys(fromTotals)[0];
            if (!currency) {
                return 0
            }
            return Math.abs(fromTotals[currency]! - toTotals[currency]!) < 0.01;
        }

        // Para casos con diferentes monedas, necesitamos verificar con los tipos de cambio
        // Este es un cálculo simplificado para este ejemplo
        return true;
    };

    // Obtener el posible error de selección de cuenta
    const getSelectionError = () => {
        if (movement.to.length === 0) return "Debe seleccionar al menos una cuenta destino";

        // Para cuentas de INGRESO o EGRESO, no es necesario tener cuenta origen
        const isDirectTransaction = movement.to.some(entry =>
            entry?.accountType === 'INCOME' || entry?.accountType === 'EXPENSE');

        if (movement.from.length === 0 && !isDirectTransaction) {
            return "Debe seleccionar al menos una cuenta origen";
        }

        // Verificar montos
        if (movement.from.some(e =>
            (!e.amount || e.amount === "0") &&
            (!e.subAccounts || e.subAccounts.length === 0 ||
                e.subAccounts.some(sa => !sa.amount || sa.amount === "0"))
        )) {
            return "Todos los montos origen deben ser mayores a cero";
        }

        if (movement.to.some(e =>
            (!e.amount || e.amount === "0") &&
            (!e.subAccounts || e.subAccounts.length === 0 ||
                e.subAccounts.some(sa => !sa.amount || sa.amount === "0"))
        )) {
            return "Todos los montos destino deben ser mayores a cero";
        }

        // Verificar tipos de cambio cuando hay diferentes monedas
        const currencies = new Set([
            ...Object.keys(fromTotals),
            ...Object.keys(toTotals)
        ]);

        if (currencies.size > 1 && movement.from.length > 0) {
            const fromCurrency = movement.from[0]?.currency;

            for (const toEntry of movement.to) {
                if (toEntry?.currency !== fromCurrency) {
                    const key = `${fromCurrency}_${toEntry?.currency}`;
                    const reverseKey = `${toEntry?.currency}_${fromCurrency}`;

                    if (!movement.exchangeRates[key] && !movement.exchangeRates[reverseKey]) {
                        return `Debe establecer el tipo de cambio entre ${fromCurrency} y ${toEntry?.currency}`;
                    }
                }
            }
        }

        // Si no hay errores, devolver null
        return null;
    };

    return (
        <>
            <Dialog open={open} onOpenChange={onClose}>
                <DialogContent className="max-w-[800px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Movimiento</DialogTitle>
                        <DialogDescription>
                            Debes seleccionar las cuentas que van a transaccionar. Puedes transaccionar:
                            <ul className="list-disc pl-6 mt-1">
                                <li>De 1 cuenta a muchas cuentas</li>
                                <li>De muchas cuentas a 1 cuenta</li>
                            </ul>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-2 gap-6">
                        {/* Columna DESDE */}
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold">Desde</h3>
                                <div className="flex gap-2">
                                    {Object.entries(fromTotals).map(([currency, total]) => (
                                        <div key={currency} className="flex items-center">
                                            <span className="font-bold mr-1">
                                                {formatPrice(total.toString())}
                                            </span>
                                            <CurrencyBadge currency={currency as Currency} size="sm" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="border rounded-md p-2 min-h-[200px]">
                                {movement.from.length === 0 ? (
                                    <div className="flex flex-col justify-center items-center h-full py-8">
                                        <p className="text-muted-foreground mb-2">No hay cuentas seleccionadas</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {movement.from.map((entry, index) => (
                                            <div key={entry?.id} className="border rounded-md p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div>
                                                        <div className="font-medium">{entry?.businessName}</div>
                                                        <div className="flex items-center">
                                                            <span className="mr-2">{entry?.accountName}</span>
                                                            <CurrencyBadge currency={entry?.currency} size="sm" />
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleRemoveEntry("from", index)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>

                                                {/* Si es cuenta agregada, mostrar subcuentas */}
                                                {entry?.hasSubAccounts ? (
                                                    <div className="space-y-2 mt-2">
                                                        {/* Listado de subcuentas */}
                                                        {entry?.subAccounts && entry?.subAccounts.length > 0 ? (
                                                            <div className="space-y-1">
                                                                {entry?.subAccounts.map((subAccount, subIndex) => (
                                                                    <div key={subAccount.id} className="flex items-center justify-between gap-2 border rounded p-2">
                                                                        <span className="text-sm">{subAccount.entityName}</span>
                                                                        <div className="flex items-center gap-1">
                                                                            <CurrencyInput
                                                                                className="w-24 h-8 text-xs"
                                                                                value={subAccount.amount}
                                                                                onChange={(e) => handleSubAccountAmountChange("from", index, subIndex, e.target.value)}
                                                                                placeholder="Monto"
                                                                            />
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-7 w-7"
                                                                                onClick={() => handleRemoveSubAccount("from", index, subIndex)}
                                                                            >
                                                                                <Trash2 className="h-3 w-3" />
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="text-sm text-muted-foreground mb-2">
                                                                No hay subcuentas seleccionadas
                                                            </div>
                                                        )}

                                                        {/* Botón para agregar subcuenta */}
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-full mt-1"
                                                            onClick={() => handleEditSubAccount("from", index)}
                                                        >
                                                            <Plus className="h-3.5 w-3.5 mr-1" /> Agregar subcuenta
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end items-center mt-2">
                                                        <CurrencyInput
                                                            className="w-32"
                                                            value={entry?.amount}
                                                            onChange={(e) => handleAmountChange("from", index, e.target.value)}
                                                            placeholder="Monto"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => handleAddAccount("from")}
                                className="gap-1"
                            >
                                <Plus className="h-4 w-4" /> Agregar cuenta
                            </Button>
                        </div>

                        {/* Columna HACIA */}
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-semibold">Hacia</h3>
                                <div className="flex gap-2">
                                    {Object.entries(toTotals).map(([currency, total]) => (
                                        <div key={currency} className="flex items-center">
                                            <span className="font-bold mr-1">
                                                {formatPrice(total.toString())}
                                            </span>
                                            <CurrencyBadge currency={currency as Currency} size="sm" />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="border rounded-md p-2 min-h-[200px]">
                                {movement.to.length === 0 ? (
                                    <div className="flex flex-col justify-center items-center h-full py-8">
                                        <p className="text-muted-foreground mb-2">No hay cuentas seleccionadas</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {movement.to.map((entry, index) => (
                                            <div key={entry?.id} className="border rounded-md p-3">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div>
                                                        <div className="font-medium">{entry?.businessName}</div>
                                                        <div className="flex items-center">
                                                            <span className="mr-2">{entry?.accountName}</span>
                                                            <CurrencyBadge currency={entry?.currency} size="sm" />
                                                        </div>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleRemoveEntry("to", index)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>

                                                {/* Si es cuenta agregada, mostrar subcuentas */}
                                                {entry?.hasSubAccounts ? (
                                                    <div className="space-y-2 mt-2">
                                                        {/* Listado de subcuentas */}
                                                        {entry?.subAccounts && entry?.subAccounts.length > 0 ? (
                                                            <div className="space-y-1">
                                                                {entry?.subAccounts.map((subAccount, subIndex) => (
                                                                    <div key={subAccount.id} className="flex items-center justify-between gap-2 border rounded p-2">
                                                                        <span className="text-sm">{subAccount.entityName}</span>
                                                                        <div className="flex items-center gap-1">
                                                                            <CurrencyInput
                                                                                className="w-24 h-8 text-xs"
                                                                                value={subAccount.amount}
                                                                                onChange={(e) => handleSubAccountAmountChange("to", index, subIndex, e.target.value)}
                                                                                placeholder="Monto"
                                                                            />
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="icon"
                                                                                className="h-7 w-7"
                                                                                onClick={() => handleRemoveSubAccount("to", index, subIndex)}
                                                                            >
                                                                                <Trash2 className="h-3 w-3" />
                                                                            </Button>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <div className="text-sm text-muted-foreground mb-2">
                                                                No hay subcuentas seleccionadas
                                                            </div>
                                                        )}

                                                        {/* Botón para agregar subcuenta */}
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="w-full mt-1"
                                                            onClick={() => handleEditSubAccount("to", index)}
                                                        >
                                                            <Plus className="h-3.5 w-3.5 mr-1" /> Agregar subcuenta
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="flex justify-end items-center mt-2">
                                                        <CurrencyInput
                                                            className="w-32"
                                                            value={entry?.amount}
                                                            onChange={(e) => handleAmountChange("to", index, e.target.value)}
                                                            placeholder="Monto"
                                                        />
                                                    </div>
                                                )}

                                                {/* Mostrar botón de tipo de cambio si es necesario */}
                                                {movement.from.length > 0 &&
                                                    movement.from[0]?.currency !== entry?.currency && (
                                                        <div className="mt-3 flex items-center justify-end">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="text-xs"
                                                                onClick={() => handleOpenExchangeRateDialog(
                                                                    movement.from[0]!.currency,
                                                                    entry?.currency
                                                                )}
                                                            >
                                                                {Object.keys(movement.exchangeRates).some(key => {
                                                                    const [from, to] = key.split('_');
                                                                    return (from === movement.from[0]?.currency && to === entry?.currency) ||
                                                                        (from === entry?.currency && to === movement.from[0]?.currency);
                                                                }) ? (
                                                                    `Editar cotización ${movement.from[0]?.currency}/${entry?.currency}`
                                                                ) : (
                                                                    `Establecer cotización ${movement.from[0]?.currency}/${entry?.currency}`
                                                                )}
                                                            </Button>
                                                        </div>
                                                    )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => handleAddAccount("to")}
                                className="gap-1"
                            >
                                <Plus className="h-4 w-4" /> Agregar cuenta
                            </Button>
                        </div>
                    </div>

                    {/* Sección de tipos de cambio */}
                    {Object.keys(movement.exchangeRates).length > 0 && (
                        <div className="mt-4">
                            <h3 className="text-sm font-medium mb-2">Tipos de cambio</h3>
                            <div className="space-y-2 border rounded-md p-2">
                                {Object.entries(movement.exchangeRates).map(([key, { fromCurrency, toCurrency, rate }]) => (
                                    <div key={key} className="flex items-center justify-between">
                                        <div className="flex items-center">
                                            <span className="mr-1">1</span>
                                            <CurrencyBadge currency={fromCurrency} size="sm" />
                                            <span className="mx-1">=</span>
                                            <span className="mr-1">{rate}</span>
                                            <CurrencyBadge currency={toCurrency} size="sm" />
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleOpenExchangeRateDialog(fromCurrency, toCurrency)}
                                        >
                                            Editar
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {getSelectionError() && (
                        <div className="text-red-500 text-sm mt-2">{getSelectionError()}</div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={onClose}>Cancelar</Button>
                        <Button
                            onClick={onClose}
                            disabled={!!getSelectionError()}
                        >
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Diálogo de selección de cuenta */}
            {accountDialogOpen && (
                <AccountSelectionDialog
                    open={accountDialogOpen}
                    onClose={() => setAccountDialogOpen(false)}
                    onSelectAccount={handleAccountSelected}
                    transactionType={transactionType}
                    guildSlug={params.guildSlug as string}
                    businessSlug={params.businessSlug as string}
                    context={currentSide}
                    excludeAccountIds={[
                        ...movement.from.map(e => e.accountId),
                        ...movement.to.map(e => e.accountId)
                    ]}
                />
            )}

            {/* Diálogo de selección de subcuenta */}
            {subAccountDialogOpen && currentSide && currentEntryIndex !== null && (
                <SubAccountSelectionDialog
                    open={subAccountDialogOpen}
                    onClose={() => setSubAccountDialogOpen(false)}
                    onSelectSubAccount={handleSubAccountSelected}
                    entry={movement[currentSide][currentEntryIndex]}
                    guildSlug={params.guildSlug as string}
                />
            )}

            {/* Diálogo de tipo de cambio */}
            {exchangeRateDialogOpen && currentCurrencyPair && (
                <ExchangeRateDialog
                    open={exchangeRateDialogOpen}
                    onClose={() => setExchangeRateDialogOpen(false)}
                    onExchangeRateSet={handleExchangeRateSet}
                    fromCurrency={currentCurrencyPair.fromCurrency}
                    toCurrency={currentCurrencyPair.toCurrency}
                    currentRate={(() => {
                        const key = `${currentCurrencyPair.fromCurrency}_${currentCurrencyPair.toCurrency}`;
                        const reverseKey = `${currentCurrencyPair.toCurrency}_${currentCurrencyPair.fromCurrency}`;
                        return movement.exchangeRates[key]?.rate ||
                            movement.exchangeRates[reverseKey]?.rate || "";
                    })()}
                />
            )}
        </>
    );
}