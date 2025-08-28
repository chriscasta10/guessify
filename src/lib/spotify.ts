import { getCookie } from "@/lib/cookies";

export async function getAccessToken(): Promise<string | null> {
	const token = await getCookie("spotify_access_token");
	const expiresAtStr = await getCookie("spotify_token_expires_at");
	const expiresAt = expiresAtStr ? Number(expiresAtStr) : 0;
	if (!token) return null;
	if (Date.now() > expiresAt) {
		await fetch("/api/auth/refresh", { cache: "no-store" });
		return await getCookie("spotify_access_token") ?? null;
	}
	return token;
}

export type LikedTrack = {
	id: string;
	uri: string;
	name: string;
	artist: string; // Keep for backward compatibility
	// ✅ NEW: Full artist data with IDs
	artists: Array<{ id: string; name: string }>;
	// ✅ NEW: Album data with images
	album: {
		name: string;
		images: Array<{ url: string; width: number; height: number }>;
	};
	hasPreview: boolean;
	previewUrl?: string;
	durationMs: number;
};


