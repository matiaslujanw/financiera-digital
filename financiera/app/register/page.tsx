import { redirect } from "next/navigation";

import { getSessionUser } from "~/server/auth";
import { RegisterForm } from "~/components/auth/forms";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";

export default async function RegisterPage() {
	const user = await getSessionUser();
	if (user) redirect("/");

	return (
		<main className="flex flex-1 items-center justify-center p-4">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle className="text-2xl">Crear tu negocio</CardTitle>
					<CardDescription>
						Sos el dueño. Se crea tu negocio con un plan de cuentas inicial.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<RegisterForm />
				</CardContent>
			</Card>
		</main>
	);
}
