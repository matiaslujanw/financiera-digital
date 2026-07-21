import { LogOut } from "lucide-react";

import { logoutAction } from "~/server/auth-actions";
import { Button } from "~/components/ui/button";

export function LogoutButton() {
	return (
		<form action={logoutAction}>
			<Button type="submit" variant="ghost" size="sm" className="gap-2">
				<LogOut className="size-4" />
				Salir
			</Button>
		</form>
	);
}
