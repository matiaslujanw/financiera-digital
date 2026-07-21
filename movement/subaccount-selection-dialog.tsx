// apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/_components/movement/subaccount-selection-dialog.tsx
"use client"

import { useState, useMemo } from "react";
import { EntityType } from "@acme/db/schema";
import { useSuspenseQuery } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@acme/ui/dialog";
import { Input } from "@acme/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@acme/ui/table";
import { cn } from "@acme/ui";
import { ArrowDown, ArrowUp, Filter, Check } from "lucide-react";
import { useTRPC } from "~/trpc/react";
import { MovementEntry, MovementEntrySubAccount } from "./movement-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@acme/ui/dropdown-menu";

interface SubAccountSelectionDialogProps {
    open: boolean;
    onClose: () => void;
    onSelectSubAccount: (entityId: string, entityName: string, entityType: EntityType) => void;
    entry: MovementEntrySubAccount;
    guildSlug: string;
}

type SortField = "name" | "type" | "id";
type SortDirection = "asc" | "desc";

type EntityItem = {
    id: string;
    name: string;
    type: EntityType;
    identifier?: string;
}

export function SubAccountSelectionDialog({
    open,
    onClose,
    onSelectSubAccount,
    entry,
    guildSlug
}: SubAccountSelectionDialogProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [sortField, setSortField] = useState<SortField>("name");
    const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
    const trpc = useTRPC();

    // Obtener entidades según el tipo necesario para la cuenta agregada
    const { data: people } = useSuspenseQuery(
        trpc.person.byGuildSlug.queryOptions(
            { guildSlug },
            { enabled: open && entry?.entityType === 'PERSON' }
        )
    );

    const { data: machinery } = useSuspenseQuery(
        trpc.machinery.byGuildSlug.queryOptions(
            { guildSlug },
            { enabled: open && entry?.entityType === 'MACHINERY' }
        )
    );

    const { data: vehicles } = useSuspenseQuery(
        trpc.vehicle.byGuildSlug.queryOptions(
            { guildSlug },
            { enabled: open && entry?.entityType === 'VEHICLE' }
        )
    );

    const { data: properties } = useSuspenseQuery(
        trpc.property.byGuildSlug.queryOptions(
            { guildSlug },
            { enabled: open && entry?.entityType === 'PROPERTY' }
        )
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

    // IDs de las subcuentas ya seleccionadas
    const selectedEntityIds = useMemo(() => {
        return entry.subAccounts?.map(sa => sa.entityId) || [];
    }, [entry.subAccounts]);

    // Obtener las entidades filtradas según el tipo y término de búsqueda
    const filteredEntities = useMemo(() => {
        let entities: EntityItem[] = [];

        if (entry?.entityType === 'PERSON' && people) {
            entities = people.map(p => ({ 
                id: p.id, 
                name: p.name, 
                type: 'PERSON' as EntityType,
                identifier: p.identifier || undefined
            }));
        } else if (entry?.entityType === 'MACHINERY' && machinery) {
            entities = machinery.map(m => ({ 
                id: m.id, 
                name: m.name, 
                type: 'MACHINERY' as EntityType,
                identifier: m.identifier || undefined
            }));
        } else if (entry?.entityType === 'VEHICLE' && vehicles) {
            entities = vehicles.map(v => ({ 
                id: v.id, 
                name: v.name, 
                type: 'VEHICLE' as EntityType,
                identifier: v.identifier || undefined
            }));
        } else if (entry?.entityType === 'PROPERTY' && properties) {
            entities = properties.map(p => ({ 
                id: p.id, 
                name: p.name, 
                type: 'PROPERTY' as EntityType,
                identifier: p.identifier || undefined
            }));
        }

        // Filtrar por término de búsqueda
        if (searchTerm) {
            entities = entities.filter(e => 
                e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (e.identifier && e.identifier.toLowerCase().includes(searchTerm.toLowerCase()))
            );
        }

        // Ordenar entidades
        entities.sort((a, b) => {
            let comparison = 0;
            
            switch (sortField) {
                case "name":
                    comparison = a.name.localeCompare(b.name);
                    break;
                case "type":
                    comparison = a.type.localeCompare(b.type);
                    break;
                case "id":
                    comparison = (a.identifier || "").localeCompare((b.identifier || ""));
                    break;
            }
            
            return sortDirection === "asc" ? comparison : -comparison;
        });

        return entities;
    }, [entry?.entityType, people, machinery, vehicles, properties, searchTerm, sortField, sortDirection]);

    const entityType = useMemo(() => {
        switch(entry?.entityType) {
            case 'PERSON': return 'Persona';
            case 'MACHINERY': return 'Maquinaria';
            case 'VEHICLE': return 'Vehículo';
            case 'PROPERTY': return 'Propiedad';
            default: return 'Subcuenta';
        }
    }, [entry?.entityType]);

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        Seleccionar subcuenta de tipo {entityType} para {entry?.accountName}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <Input
                        placeholder={`Buscar ${entityType.toLowerCase()}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    <div className="max-h-[400px] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[60%]">
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
                                                onClick={() => handleSort("id")}
                                            >
                                                Identificador
                                                {sortField === "id" && (
                                                    sortDirection === "asc" ? 
                                                    <ArrowUp className="h-3 w-3" /> : 
                                                    <ArrowDown className="h-3 w-3" />
                                                )}
                                            </button>
                                        </div>
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredEntities.length > 0 ? (
                                    filteredEntities.map((entity) => (
                                        <TableRow
                                            key={entity.id}
                                            className={cn(
                                                "hover:bg-muted/50 cursor-pointer",
                                                selectedEntityIds.includes(entity.id) && "bg-muted/70"
                                            )}
                                            onClick={() => onSelectSubAccount(entity.id, entity.name, entity.type)}
                                        >
                                            <TableCell>
                                                <div className="flex items-center justify-between">
                                                    <span className="font-medium">{entity.name}</span>
                                                    {selectedEntityIds.includes(entity.id) && (
                                                        <Check className="h-4 w-4 text-primary ml-2" />
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {entity.identifier || "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={2} className="text-center py-8">
                                            No se encontraron {entityType.toLowerCase()}s
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