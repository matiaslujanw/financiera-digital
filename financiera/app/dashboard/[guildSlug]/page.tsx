import { redirect } from "next/navigation";

export default async function GuildPage(props: {
	params: Promise<{ guildSlug: string }>;
}) {
	const { guildSlug } = await props.params;
	redirect(`/dashboard/${guildSlug}/accounts`);
}
