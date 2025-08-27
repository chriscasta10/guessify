export const env = {
	SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID ?? "",
	SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET ?? "",
	SPOTIFY_REDIRECT_URI:
		process.env.SPOTIFY_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback/spotify",
	APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

export function assertEnv() {
	if (!env.SPOTIFY_CLIENT_ID) throw new Error("Missing SPOTIFY_CLIENT_ID");
	if (!env.SPOTIFY_REDIRECT_URI) throw new Error("Missing SPOTIFY_REDIRECT_URI");
}


