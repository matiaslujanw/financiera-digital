"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction, registerAction, type AuthState } from "~/server/auth-actions";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

const initialState: AuthState = {};

function SubmitButton({ children }: { children: React.ReactNode }) {
	const { pending } = useFormStatus();
	return (
		<Button type="submit" className="w-full" disabled={pending}>
			{pending ? "Un momento…" : children}
		</Button>
	);
}

function FieldError({ state }: { state: AuthState }) {
	if (!state.error) return null;
	return (
		<p className="text-destructive text-sm" role="alert">
			{state.error}
		</p>
	);
}

export function LoginForm() {
	const [state, formAction] = useActionState(loginAction, initialState);
	return (
		<form action={formAction} className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor="email">Email</Label>
				<Input id="email" name="email" type="email" autoComplete="email" required />
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="password">Contraseña</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autoComplete="current-password"
					required
				/>
			</div>
			<FieldError state={state} />
			<SubmitButton>Ingresar</SubmitButton>
			<p className="text-muted-foreground text-center text-sm">
				¿No tenés cuenta?{" "}
				<Link href="/register" className="text-foreground underline">
					Crear negocio
				</Link>
			</p>
		</form>
	);
}

export function RegisterForm() {
	const [state, formAction] = useActionState(registerAction, initialState);
	return (
		<form action={formAction} className="flex flex-col gap-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor="name">Tu nombre</Label>
				<Input id="name" name="name" type="text" autoComplete="name" required />
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="guildName">Nombre del negocio</Label>
				<Input id="guildName" name="guildName" type="text" required />
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="email">Email</Label>
				<Input id="email" name="email" type="email" autoComplete="email" required />
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="password">Contraseña</Label>
				<Input
					id="password"
					name="password"
					type="password"
					autoComplete="new-password"
					required
					minLength={6}
				/>
			</div>
			<FieldError state={state} />
			<SubmitButton>Crear negocio</SubmitButton>
			<p className="text-muted-foreground text-center text-sm">
				¿Ya tenés cuenta?{" "}
				<Link href="/login" className="text-foreground underline">
					Ingresar
				</Link>
			</p>
		</form>
	);
}
