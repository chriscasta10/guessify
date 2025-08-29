import { cookies } from "next/headers";
import { env } from "@/lib/env";

export interface SpotifyTokenInfo {
	access_token: string;
	expires_at: number;
	scope?: string;
}

export interface SpotifyScopeCheck {
	hasLibraryRead: boolean;
	hasStreaming: boolean;
	hasUserRead: boolean;
	missingScopes: string[];
}

/**
 * Get the current access token, refreshing if necessary
 */
export async function getValidAccessToken(): Promise<SpotifyTokenInfo | null> {
	const cookieStore = await cookies();
	const access = cookieStore.get("spotify_access_token")?.value;
	const expStr = cookieStore.get("spotify_token_expires_at")?.value;
	const refresh = cookieStore.get("spotify_refresh_token")?.value;
	const exp = expStr ? Number(expStr) : 0;

	let accessToken = access;
	let expiresAt = exp;

	// If token is expired, try to refresh it
	if (!access || Date.now() >= exp) {
		console.log("Token expired, attempting refresh");
		if (!refresh) {
			console.log("No refresh token available");
			return null;
		}

		try {
			const body = new URLSearchParams({
				client_id: env.SPOTIFY_CLIENT_ID,
				client_secret: env.SPOTIFY_CLIENT_SECRET,
				grant_type: "refresh_token",
				refresh_token: refresh,
			});
			
			const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body,
			});
			
			if (!tokenRes.ok) {
				console.log("Token refresh failed");
				return null;
			}
			
			type TokenJson = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };
			const json = (await tokenRes.json()) as TokenJson;
			expiresAt = Date.now() + json.expires_in * 1000 - 30_000;
			
			// Update cookies with new tokens
			cookieStore.set("spotify_access_token", json.access_token, { httpOnly: true, sameSite: "lax" });
			cookieStore.set("spotify_token_expires_at", String(expiresAt), { httpOnly: true, sameSite: "lax" });
			if (json.refresh_token) {
				cookieStore.set("spotify_refresh_token", json.refresh_token, { httpOnly: true, sameSite: "lax" });
			}
			
			accessToken = json.access_token;
			console.log("Token refreshed successfully");
		} catch (error) {
			console.error("Error refreshing token:", error);
			return null;
		}
	}

	if (!accessToken) {
		return null;
	}

	return {
		access_token: accessToken,
		expires_at: expiresAt,
	};
}

/**
 * Check if the current token has the required scopes
 */
export async function checkTokenScopes(): Promise<SpotifyScopeCheck> {
	const tokenInfo = await getValidAccessToken();
	if (!tokenInfo) {
		return {
			hasLibraryRead: false,
			hasStreaming: false,
			hasUserRead: false,
			missingScopes: ["user-library-read", "streaming", "user-read-email", "user-read-private"]
		};
	}

	// Get current scopes from Spotify API
	try {
		const res = await fetch("https://api.spotify.com/v1/me", {
			headers: { Authorization: `Bearer ${tokenInfo.access_token}` },
		});

		if (!res.ok) {
			// If we can't even get user info, assume no scopes
			return {
				hasLibraryRead: false,
				hasStreaming: false,
				hasUserRead: false,
				missingScopes: ["user-library-read", "streaming", "user-read-email", "user-read-private"]
			};
		}

		const userData = await res.json();
		const scopes = userData.scope || ""; // Note: Spotify doesn't always return scopes in user endpoint
		
		// For now, we'll test the scopes by making actual API calls
		// This is more reliable than parsing scope strings
		const scopeCheck: SpotifyScopeCheck = {
			hasLibraryRead: false,
			hasStreaming: false,
			hasUserRead: false,
			missingScopes: []
		};

		// Test library read access
		try {
			const libraryRes = await fetch("https://api.spotify.com/v1/me/tracks?limit=1", {
				headers: { Authorization: `Bearer ${tokenInfo.access_token}` },
			});
			scopeCheck.hasLibraryRead = libraryRes.ok;
		} catch {
			scopeCheck.hasLibraryRead = false;
		}

		// Test streaming access (this is harder to test without actual playback)
		// We'll assume it's available if we have a valid token
		scopeCheck.hasStreaming = true;

		// Test user read access
		scopeCheck.hasUserRead = true; // We already got user data

		// Determine missing scopes
		if (!scopeCheck.hasLibraryRead) scopeCheck.missingScopes.push("user-library-read");
		if (!scopeCheck.hasStreaming) scopeCheck.missingScopes.push("streaming");
		if (!scopeCheck.hasUserRead) scopeCheck.missingScopes.push("user-read-email", "user-read-private");

		return scopeCheck;
	} catch (error) {
		console.error("Error checking token scopes:", error);
		return {
			hasLibraryRead: false,
			hasStreaming: false,
			hasUserRead: false,
			missingScopes: ["user-library-read", "streaming", "user-read-email", "user-read-private"]
		};
	}
}

/**
 * Generate a re-authorization URL when scopes are missing
 */
export function generateReauthUrl(): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: env.SPOTIFY_CLIENT_ID,
		scope: "user-library-read streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state",
		redirect_uri: env.SPOTIFY_REDIRECT_URI,
		show_dialog: "true", // Force re-authorization
	});

	return `https://accounts.spotify.com/authorize?${params.toString()}`;
}
