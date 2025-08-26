export const env = {
	SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? "",
	SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? "",
	SPOTIFY_REDIRECT_URI:
		process.env.SPOTIFY_REDIRECT_URI ?? "https://guessify-4027zlpqp-christopher-castanedas-projects.vercel.app/api/auth/callback/spotify",
	APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "https://guessify-4027zlpqp-christopher-castanedas-projects.vercel.app",
};

export function assertEnv() {
	if (!env.SPOTIFY_CLIENT_ID) throw new Error("Missing SPOTIFY_CLIENT_ID");
	if (!env.SPOTIFY_REDIRECT_URI) throw new Error("Missing SPOTIFY_REDIRECT_URI");
}


