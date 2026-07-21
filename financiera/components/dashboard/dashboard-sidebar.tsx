"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	BadgeDollarSign,
	Landmark,
	ReceiptText,
	WalletCards,
} from "lucide-react";

import { cn } from "~/lib/utils";

const navItems = [
	{ segment: "accounts", label: "Cuentas", icon: WalletCards },
	{ segment: "operations", label: "Operaciones", icon: ReceiptText },
] as const;

export function DashboardSidebar(props: {
	guildSlug: string;
	guildName: string;
}) {
	const pathname = usePathname();
	const base = `/dashboard/${props.guildSlug}`;

	return (
		<aside className="bg-sidebar text-sidebar-foreground hidden w-64 shrink-0 flex-col border-r md:flex">
			<div className="flex h-16 items-center gap-3 border-b px-5">
				<div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl">
					<Landmark className="size-5" />
				</div>
				<div className="min-w-0">
					<p className="truncate font-semibold">{props.guildName}</p>
					<p className="text-muted-foreground text-xs">Gestión financiera</p>
				</div>
			</div>

			<nav className="space-y-1 p-3">
				<p className="text-muted-foreground px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-widest">
					Administración
				</p>
				{navItems.map((item) => {
					const href = `${base}/${item.segment}`;
					const active = pathname.startsWith(href);
					const Icon = item.icon;
					return (
						<Link
							key={item.segment}
							href={href}
							className={cn(
								"flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
								active
									? "bg-sidebar-accent text-sidebar-accent-foreground"
									: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
							)}
						>
							<Icon className="size-4" />
							{item.label}
						</Link>
					);
				})}
			</nav>

			<div className="mt-auto border-t p-4">
				<div className="bg-muted/50 rounded-xl p-3">
					<div className="mb-1 flex items-center gap-2 text-sm font-medium">
						<BadgeDollarSign className="size-4" />
						Próximo módulo
					</div>
					<p className="text-muted-foreground text-xs">
						Préstamos y créditos con cuotas.
					</p>
				</div>
			</div>
		</aside>
	);
}

export function DashboardMobileNav({ guildSlug }: { guildSlug: string }) {
	const pathname = usePathname();
	const base = `/dashboard/${guildSlug}`;

	return (
		<nav className="flex items-center gap-1 md:hidden">
			{navItems.map((item) => {
				const href = `${base}/${item.segment}`;
				const active = pathname.startsWith(href);
				const Icon = item.icon;
				return (
					<Link
						key={item.segment}
						href={href}
						aria-label={item.label}
						className={cn(
							"rounded-lg p-2",
							active ? "bg-accent text-foreground" : "text-muted-foreground",
						)}
					>
						<Icon className="size-5" />
					</Link>
				);
			})}
		</nav>
	);
}
