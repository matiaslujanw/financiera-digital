// apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/_components/movement/exchange-rate-dialog.tsx
"use client"

import { Currency } from "@acme/db/schema";
import { useState } from "react";

import { Button } from "@acme/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@acme/ui/dialog";
import { Input } from "@acme/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@acme/ui/select";
import { CurrencyBadge } from "~/app/(app)/dashboard/[guildSlug]/_components/currency/badge";

interface ExchangeRateDialogProps {
    open: boolean;
    onClose: () => void;
    onExchangeRateSet: (fromCurrency: Currency, toCurrency: Currency, rate: string) => void;
    fromCurrency: Currency;
    toCurrency: Currency;
    currentRate?: string;
}

export function ExchangeRateDialog({
    open,
    onClose,
    onExchangeRateSet,
    fromCurrency,
    toCurrency,
    currentRate = ""
}: ExchangeRateDialogProps) {
    const [rate, setRate] = useState(currentRate);
    const [direction, setDirection] = useState<"normal" | "inverse">("normal");

    const handleSubmit = () => {
        if (direction === "normal") {
            onExchangeRateSet(fromCurrency, toCurrency, rate);
        } else {
            onExchangeRateSet(toCurrency, fromCurrency, rate);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Establecer tipo de cambio</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4 my-2">
                    <Select
                        value={direction}
                        onValueChange={(value) => setDirection(value as "normal" | "inverse")}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Seleccionar dirección" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="normal">
                                <div className="flex items-center gap-2">
                                    <CurrencyBadge currency={fromCurrency} size="sm" />
                                    <span>a</span>
                                    <CurrencyBadge currency={toCurrency} size="sm" />
                                </div>
                            </SelectItem>
                            <SelectItem value="inverse">
                                <div className="flex items-center gap-2">
                                    <CurrencyBadge currency={toCurrency} size="sm" />
                                    <span>a</span>
                                    <CurrencyBadge currency={fromCurrency} size="sm" />
                                </div>
                            </SelectItem>
                        </SelectContent>
                    </Select>
                    
                    <div className="flex items-center gap-2 justify-center">
                        <div className="flex items-center">
                            <span className="mr-1">1</span>
                            <CurrencyBadge 
                                currency={direction === "normal" ? fromCurrency : toCurrency} 
                                size="sm" 
                            />
                            <span className="mx-1">=</span>
                        </div>
                        <Input
                            className="w-32"
                            value={rate}
                            onChange={(e) => setRate(e.target.value)}
                            placeholder="Cotización"
                        />
                        <CurrencyBadge 
                            currency={direction === "normal" ? toCurrency : fromCurrency} 
                            size="sm" 
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={!rate}>
                        Confirmar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}