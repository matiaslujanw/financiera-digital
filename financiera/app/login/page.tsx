import { redirect } from "next/navigation";

import { getSessionUser } from "~/server/auth";
import { LoginForm } from "~/components/auth/forms";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";

export default async function LoginPage() {
	const user = await getSessionUser();
	if (user) redirect("/");

	return (
		<main className="flex flex-1 items-center justify-center p-4">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle className="text-2xl">Financiera</CardTitle>
					<CardDescription>Ingresá a tu negocio</CardDescription>
				</CardHeader>
				<CardContent>
					<LoginForm />
				</CardContent>
			</Card>
		</main>
	);
}
