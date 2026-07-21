// Ruta: apps/nextjs/src/app/(app)/dashboard/[guildSlug]/transactions/_components/special-dialog.tsx
"use client";

import { Button } from "@acme/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@acme/ui/dialog";
import { Icons } from "@acme/ui/icons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@acme/ui/select";
import React, { Suspense, useState } from "react";
import { CheckPurchase } from "./special/check-purchase";
import { CheckSale } from "./special/check-sale";
import { Credit } from "./special/credit";
import { Loan } from "./special/loan";
import { Cable } from "./special/cable";
import { PurchaseCheckInput } from "@acme/validators";
import { OpenDialog, TransactionType } from "~/utils/types";

interface SpecialDialogProps {
	openDialog: OpenDialog;
	context: 'guild' | 'business';
	setOpenDialog: React.Dispatch<React.SetStateAction<OpenDialog>>;
	createdChecks: PurchaseCheckInput[];
	setCreatedChecks: React.Dispatch<React.SetStateAction<PurchaseCheckInput[]>>;
}

const descriptions = {
	purchase: "Puedes agregar uno o varios cheques. Se crearán 4 transacciones por cheque y un grupo de toda la operación.",
	sale: "Venta de cheques",
	cable: "Es una operación en donde entregas dinero a una cuenta en el exterior. Se debitará de una cuenta de disponibilidad que elijas y se acreditará en dos cuentas: comisión cable y una cuenta de activo donde vuelve el dinero transferido",
	loan: "Préstamo a un tercero. Se debitara de una cuenta de disponibilidad que elijas y se acreditara en dos cuentas: prestamos e ingresos cobrados",
	credit: "Recibes plata prestada de un tercero. Se acredita en una cuenta de disponibilidad que elijas y se debita en dos cuentas: creditos e ingresos pagados",
};

export function SpecialDialog({
	openDialog,
	context,
	setOpenDialog,
	createdChecks,
	setCreatedChecks,
}: SpecialDialogProps) {
	const [specialTransactionType, setSpecialTransactionType] = useState<TransactionType>("purchase");

	return (
		<Dialog open={openDialog === 'special'} onOpenChange={() => {
			setOpenDialog('none');
			setCreatedChecks([]);
		}}>
			<DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col h-screen flex-1 overflow-y-clip gap-2 py-4 px-6 m-0 justify-start">
				<div className="pr-5">
					<DialogHeader className="flex flex-row justify-between">
						<div className="flex flex-col">
							<DialogTitle className="text-xl w-max">
								Operaciones especiales
							</DialogTitle>
							<DialogDescription className="text-left text-wrap">
								{descriptions[specialTransactionType]}
							</DialogDescription>
						</div>
						<Select
							defaultValue="purchase"
							onValueChange={(type) => {
								setSpecialTransactionType(type as TransactionType);
							}}
							value={specialTransactionType}
						>
							<SelectTrigger className="gap-2 w-fit text-xs">
								<SelectValue className="text-xs" placeholder="Selecciona una plantilla" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="purchase" className="text-xs">
									Compra de cheques
								</SelectItem>
								<SelectItem value="sale" className="text-xs">
									Venta de cheques
								</SelectItem>
								<SelectItem value="cable" className="text-xs">
									Cable
								</SelectItem>
								<SelectItem value="loan" className="text-xs">
									Prestamo
								</SelectItem>
								<SelectItem value="credit" className="text-xs">
									Crédito
								</SelectItem>
							</SelectContent>
						</Select>
					</DialogHeader>
				</div>
				{specialTransactionType === "purchase" ? (
					<CheckPurchase
						context={context}
						createdChecks={createdChecks}
						setCreatedChecks={setCreatedChecks}
						setOpenDialog={setOpenDialog}
					/>
				) : specialTransactionType === "sale" ? (
					<CheckSale
						context={context}
						setOpenDialog={setOpenDialog}
					/>
				) : specialTransactionType === "cable" ? (
					<Cable
						context={context}
						setOpenDialog={setOpenDialog}
					/>
				) : specialTransactionType === "credit" ? (
					<Credit
						context={context}
						setOpenDialog={setOpenDialog}
					/>
				) : (
					<Loan
						context={context}
						setOpenDialog={setOpenDialog}
					/>
				)}
				<DialogFooter className="sm:justify-end">
					<DialogClose asChild>
						<Button type="button" variant="outline">
							Cerrar
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}