// apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/_components/movement/account-selection-dialog.tsx
"use client"

import { useMemo, useState } from "react";
import { Currency } from "@acme/db/schema";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@acme/ui/dialog";
import { Input } from "@acme/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@acme/ui/table";
import { Badge } from "@acme/ui/badge";
import { cn } from "@acme/ui";
import { ArrowDown, ArrowUp, Check, ChevronDown, Filter } from "lucide-react";
import { CurrencyBadge } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/badge";
import { getTypeLabel } from "~/utils/format";
import { useTRPC } from "~/trpc/react";
import { 
    Popover, 
    PopoverContent, 
    PopoverTrigger 
} from "@acme/ui/popover";
import { 
    DropdownMenu, 
    DropdownMenuContent, 
    DropdownMenuGroup,
    DropdownMenuItem, 
    DropdownMenuTrigger 
} from "@acme/ui/dropdown-menu";

export type Account = {
    id: string;
    name: string;
    businessId: string;
    businessName: string;
    accountType: string;
    currency: Currency;
    hasSubAccounts: boolean;
    entityType?: string;
    availability?: boolean;
};

interface AccountSelectionDialogProps {
    open: boolean;
    onClose: () => void;
    onSelectAccount: (account: Account) => void;
    transactionType: string;
    guildSlug: string;
    businessSlug?: string;
    context: "from" | "to";
    excludeAccountIds: string[];
}

type SortField = "name" | "accountType" | "currency";
type SortDirection = "asc" | "desc";

export function AccountSelectionDialog({
    open,
    onClose,
    onSelectAccount,
    transactionType,
    guildSlug,
    businessSlug,
    context,
    excludeAccountIds
}: AccountSelectionDialogProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
    const [filterCurrency, setFilterCurrency] = useState<Currency | null>(null);
    const [filterAccountType, setFilterAccountType] = useState<string | null>(null);
    
    const trpc = useTRPC();

    // Obtener empresas
    const { data: businesses } = useSuspenseQuery(
        trpc.business.byGuildSlug.queryOptions({
            guildSlug
        })
    );

    // Obtener cuentas de diccionario
    const { data: dictionaryAccounts } = useSuspenseQuery(
        trpc.dictionaryAccount.byGuildSlug.queryOptions({
            guildSlug
        })
    );

    // Toggle de ordenamiento
    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === "asc" ? "desc" : "asc");
        } else {
            setSortField(field);
            setSortDirection("asc");
        }
    };

    // Crear opciones de filtro
    const currencyOptions = useMemo(() => {
        if (!dictionaryAccounts) return [];
        
        const currencies = new Set<Currency>();
        dictionaryAccounts.forEach(account => {
            currencies.add(account.currency);
        });
        
        return Array.from(currencies).sort();
    }, [dictionaryAccounts]);

    const accountTypeOptions = useMemo(() => {
        if (!dictionaryAccounts) return [];
        
        const types = new Set<string>();
        dictionaryAccounts.forEach(account => {
            types.add(account.accountType);
        });
        
        return Array.from(types).sort();
    }, [dictionaryAccounts]);
    
    // Filtrar y ordenar cuentas
    const filteredAccounts = useMemo(() => {
        if (!dictionaryAccounts || !businesses) return [];

        // Filtrar cuentas según criterios
        let accounts = dictionaryAccounts.filter(account => {
            // Filtrar por término de búsqueda
            if (searchTerm && !account.name.toLowerCase().includes(searchTerm.toLowerCase())) {
                return false;
            }

            // Excluir cuentas ya seleccionadas
            if (excludeAccountIds.includes(account.id)) {
                return false;
            }

            // Filtrar por moneda si hay seleccionada
            if (filterCurrency && account.currency !== filterCurrency) {
                return false;
            }
            
            // Filtrar por tipo de cuenta si hay seleccionado
            if (filterAccountType && account.accountType !== filterAccountType) {
                return false;
            }

            // Para cuentas de origen en transacciones entre empresas
            if (context === "from" && transactionType === "outbound") {
                return account.availability;
            }

            return true;
        });

        // Ordenar cuentas
        accounts.sort((a, b) => {
            let comparison = 0;
            
            switch (sortField) {
                case "name":
                    comparison = a.name.localeCompare(b.name);
                    break;
                case "accountType":
                    comparison = a.accountType.localeCompare(b.accountType);
                    break;
                case "currency":
                    comparison = a.currency.localeCompare(b.currency);
                    break;
            }
            
            return sortDirection === "asc" ? comparison : -comparison;
        });

        // Mapear a formato de cuenta con empresa
        return accounts.map(account => {
            // Encontrar la empresa asociada (para transacciones internas usar la empresa del negocio)
            const businessId = transactionType === "inbound" && businessSlug
                ? businesses.find(b => b.businessSlug === businessSlug)?.id
                : businesses[0]?.id;
            
            return {
                id: account.id,
                name: account.name,
                businessId: businessId || "",
                businessName: businesses.find(b => b.id === businessId)?.name || "",
                accountType: account.accountType,
                currency: account.currency,
                hasSubAccounts: account.hasSubAccounts,
                entityType: account.entityType,
                availability: account.availability
            };
        });
    }, [dictionaryAccounts, businesses, searchTerm, excludeAccountIds, context, transactionType, 
        businessSlug, sortField, sortDirection, filterCurrency, filterAccountType]);

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>
                        Seleccionar cuenta {context === "from" ? "origen" : "destino"}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <Input
                        placeholder="Buscar cuenta..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    <div className="max-h-[400px] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50%]">
                                        <div className="flex items-center gap-1">
                                            <button 
                                                className="flex items-center gap-1 font-semibold"
                                                onClick={() => handleSort("name")}
                                            >
                                                Nombre
                                                {sortField === "name" && (
                                                    sortDirection === "asc" ? 
                                                    <ArrowUp className="h-3 w-3" /> : 
                                                    <ArrowDown className="h-3 w-3" />
                                                )}
                                            </button>
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center gap-1">
                                            <button 
                                                className="flex items-center gap-1 font-semibold"
                                                onClick={() => handleSort("accountType")}
                                            >
                                                Tipo
                                                {sortField === "accountType" && (
                                                    sortDirection === "asc" ? 
                                                    <ArrowUp className="h-3 w-3" /> : 
                                                    <ArrowDown className="h-3 w-3" />
                                                )}
                                            </button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                                        <Filter className="h-3 w-3" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="start" className="w-[180px]">
                                                    <DropdownMenuGroup>
                                                        <DropdownMenuItem 
                                                            onClick={() => setFilterAccountType(null)}
                                                            className={cn(
                                                                "flex items-center justify-between",
                                                                filterAccountType === null && "font-semibold"
                                                            )}
                                                        >
                                                            Todos
                                                            {filterAccountType === null && <Check className="h-4 w-4" />}
                                                        </DropdownMenuItem>
                                                        {accountTypeOptions.map(type => (
                                                            <DropdownMenuItem 
                                                                key={type}
                                                                onClick={() => setFilterAccountType(type)}
                                                                className={cn(
                                                                    "flex items-center justify-between",
                                                                    filterAccountType === type && "font-semibold"
                                                                )}
                                                            >
                                                                {getTypeLabel(type)}
                                                                {filterAccountType === type && <Check className="h-4 w-4" />}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuGroup>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableHead>
                                    <TableHead>
                                        <div className="flex items-center gap-1">
                                            <button 
                                                className="flex items-center gap-1 font-semibold"
                                                onClick={() => handleSort("currency")}
                                            >
                                                Moneda
                                                {sortField === "currency" && (
                                                    sortDirection === "asc" ? 
                                                    <ArrowUp className="h-3 w-3" /> : 
                                                    <ArrowDown className="h-3 w-3" />
                                                )}
                                            </button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6">
                                                        <Filter className="h-3 w-3" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="start" className="w-[180px]">
                                                    <DropdownMenuGroup>
                                                        <DropdownMenuItem 
                                                            onClick={() => setFilterCurrency(null)}
                                                            className={cn(
                                                                "flex items-center justify-between",
                                                                filterCurrency === null && "font-semibold"
                                                            )}
                                                        >
                                                            Todos
                                                            {filterCurrency === null && <Check className="h-4 w-4" />}
                                                        </DropdownMenuItem>
                                                        {currencyOptions.map(currency => (
                                                            <DropdownMenuItem 
                                                                key={currency}
                                                                onClick={() => setFilterCurrency(currency)}
                                                                className={cn(
                                                                    "flex items-center justify-between",
                                                                    filterCurrency === currency && "font-semibold"
                                                                )}
                                                            >
                                                                <div className="flex items-center gap-1">
                                                                    <CurrencyBadge currency={currency} size="sm" />
                                                                    <span>{currency}</span>
                                                                </div>
                                                                {filterCurrency === currency && <Check className="h-4 w-4" />}
                                                            </DropdownMenuItem>
                                                        ))}
                                                    </DropdownMenuGroup>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredAccounts.map((account) => (
                                    <TableRow
                                        key={account.id}
                                        className="hover:bg-muted/50 cursor-pointer"
                                        onClick={() => onSelectAccount(account)}
                                    >
                                        <TableCell>
                                            <div className="flex items-center">
                                                <span className="font-medium">{account.name}</span>
                                                {account.hasSubAccounts && (
                                                    <Badge variant="secondary" className="ml-2 text-xs">
                                                        Agregada
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>{getTypeLabel(account.accountType)}</TableCell>
                                        <TableCell>
                                            <CurrencyBadge
                                                currency={account.currency}
                                                size="sm"
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredAccounts.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center py-8">
                                            No se encontraron cuentas disponibles
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}