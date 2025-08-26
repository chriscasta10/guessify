import { getCookie } from "@/lib/cookies";

export async function getAccessToken(): Promise<string | null> {
	const token = getCookie("spotify_access_token");
	const expiresAtStr = getCookie("spotify_token_expires_at");
	const expiresAt = expiresAtStr ? Number(expiresAtStr) : 0;
	if (!token) return null;
	if (Date.now() > expiresAt) {
		await fetch("/api/auth/refresh", { cache: "no-store" });
		return getCookie("spotify_access_token") ?? null;
	}
	return token;
}

export type LikedTrack = {
	id: string;
	uri: string;
	name: string;
	artist: string;
	hasPreview: boolean;
	previewUrl?: string;
	durationMs: number;
};


