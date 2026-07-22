"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	ArrowLeftRight,
	BadgeDollarSign,
	Landmark,
	PanelLeftClose,
	PanelLeftOpen,
	ReceiptText,
	WalletCards,
} from "lucide-react";

import { cn } from "~/lib/utils";

const navItems = [
	{ segment: "transactions", label: "Transacciones", icon: ArrowLeftRight },
	{ segment: "accounts", label: "Cuentas", icon: WalletCards },
	{ segment: "operations", label: "Operaciones", icon: ReceiptText },
] as const;

export function DashboardSidebar(props: {
	guildSlug: string;
	guildName: string;
}) {
	const pathname = usePathname();
	const [collapsed, setCollapsed] = useState(false);
	const base = `/dashboard/${props.guildSlug}`;

	return (
		<aside
			className={cn(
				"bg-sidebar text-sidebar-foreground relative hidden shrink-0 flex-col border-r transition-[width] duration-200 md:flex",
				collapsed ? "w-20" : "w-64",
			)}
		>
			<button
				type="button"
				onClick={() => setCollapsed((value) => !value)}
				className="bg-sidebar hover:bg-sidebar-accent absolute right-0 top-20 z-10 flex size-7 translate-x-1/2 items-center justify-center rounded-full border shadow-sm transition-colors"
				aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
				title={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
			>
				{collapsed ? (
					<PanelLeftOpen className="size-3.5" />
				) : (
					<PanelLeftClose className="size-3.5" />
				)}
			</button>

			<div
				className={cn(
					"flex h-16 items-center gap-3 border-b",
					collapsed ? "justify-center px-3" : "px-5",
				)}
			>
				<div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl">
					<Landmark className="size-5" />
				</div>
				<div className={cn("min-w-0", collapsed && "hidden")}>
					<p className="truncate font-semibold">{props.guildName}</p>
					<p className="text-muted-foreground text-xs">Gestión financiera</p>
				</div>
			</div>

			<nav className="space-y-1 p-3">
				<p
					className={cn(
						"text-muted-foreground px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-widest",
						collapsed && "sr-only",
					)}
				>
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
								collapsed && "justify-center px-2",
								active
									? "bg-sidebar-accent text-primary"
									: "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
							)}
							aria-label={item.label}
							title={collapsed ? item.label : undefined}
						>
							<Icon className="size-5 shrink-0" />
							<span className={cn(collapsed && "hidden")}>{item.label}</span>
						</Link>
					);
				})}
			</nav>

			<div className={cn("mt-auto border-t", collapsed ? "p-3" : "p-4")}>
				<div
					className={cn(
						"bg-muted/50 rounded-xl p-3",
						collapsed && "flex justify-center px-2",
					)}
					title={collapsed ? "Próximo: préstamos y créditos" : undefined}
				>
					<div className="mb-1 flex items-center gap-2 text-sm font-medium">
						<BadgeDollarSign className="size-4" />
						<span className={cn(collapsed && "hidden")}>Próximo módulo</span>
					</div>
					<p className={cn("text-muted-foreground text-xs", collapsed && "hidden")}>
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
							active ? "bg-accent text-primary" : "text-muted-foreground",
						)}
					>
						<Icon className="size-5" />
					</Link>
				);
			})}
		</nav>
	);
}
