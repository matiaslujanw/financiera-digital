"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Book, ChevronDown } from "lucide-react";

import { cn } from "~/lib/utils";
import { useTRPC } from "~/trpc/react";
import type { AccountType } from "~/server/db/schema";
import {
	ACCOUNT_TYPE_LABELS,
	ACCOUNT_TYPE_ORDER,
	formatPrice,
} from "~/utils/format";
import { Skeleton } from "~/components/ui/skeleton";
import { Badge } from "~/components/ui/badge";

export function AccountsSummary({ guildSlug }: { guildSlug: string }) {
	const trpc = useTRPC();
	const { data, isLoading } = useQuery(
		trpc.accountOnBusiness.guildSummary.queryOptions({ guildSlug }),
	);

	const [open, setOpen] = useState(false);

	return (
		<aside className="bg-card w-full shrink-0 overflow-hidden rounded-xl border">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="hover:bg-accent/40 flex w-full items-center gap-2 p-4 text-left transition-colors"
				aria-expanded={open}
			>
				<Book className="text-primary size-5" />
				<h2 className="font-semibold">Resumen de cuentas</h2>
				<span className="text-muted-foreground ml-auto text-xs">
					{open ? "Ocultar" : "Ver saldos"}
				</span>
				<ChevronDown
					className={cn(
						"text-muted-foreground size-4 transition-transform",
						open && "rotate-180",
					)}
				/>
			</button>

			{open && (
				<div className="border-t">
					{isLoading && (
						<div className="space-y-2 p-4">
							<Skeleton className="h-6 w-full" />
							<Skeleton className="h-6 w-full" />
							<Skeleton className="h-6 w-2/3" />
						</div>
					)}

					{!isLoading && (!data || data.length === 0) && (
						<p className="text-muted-foreground p-4 text-sm">
							No hay negocios ni cuentas todavía.
						</p>
					)}

					<div className="divide-y">
						{data?.map((business) => (
							<BusinessBlock key={business.id} business={business} />
						))}
					</div>
				</div>
			)}
		</aside>
	);
}

type Business = {
	id: string;
	name: string;
	accounts: {
		id: string;
		name: string;
		currentBalance: string;
		accountType: AccountType;
		currency: string;
	}[];
};

function BusinessBlock({ business }: { business: Business }) {
	const byType = new Map<AccountType, Business["accounts"]>();
	for (const acc of business.accounts) {
		const list = byType.get(acc.accountType) ?? [];
		list.push(acc);
		byType.set(acc.accountType, list);
	}

	return (
		<div className="p-4">
			<h3 className="mb-3 text-sm font-semibold tracking-wide">{business.name}</h3>
			<div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
				{ACCOUNT_TYPE_ORDER.filter((t) => byType.has(t)).map((type) => {
					const accounts = byType.get(type)!;
					const total = accounts.reduce(
						(sum, a) => sum + (parseFloat(a.currentBalance) || 0),
						0,
					);
					return (
						<div key={type} className="space-y-1.5">
							<p className="text-muted-foreground text-xs font-medium uppercase">
								{ACCOUNT_TYPE_LABELS[type]}
							</p>
							{accounts.map((acc) => (
								<div
									key={acc.id}
									className="flex items-center justify-between gap-2 text-sm"
								>
									<span className="text-muted-foreground truncate">{acc.name}</span>
									<span className="flex items-center gap-1.5 font-mono tabular-nums">
										{formatPrice(acc.currentBalance)}
										<Badge variant="outline" className="text-[10px]">
											{acc.currency}
										</Badge>
									</span>
								</div>
							))}
							<div className="flex items-center justify-between border-t pt-1.5 text-sm font-medium">
								<span className="text-muted-foreground">Total</span>
								<span className="text-primary font-mono tabular-nums">{formatPrice(total)}</span>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
