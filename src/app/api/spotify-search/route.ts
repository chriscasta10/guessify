import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
	const { searchParams } = new URL(req.url);
	const query = searchParams.get("q");
	
	if (!query || query.trim().length < 2) {
		return NextResponse.json({ error: "Query too short" }, { status: 400 });
	}

	const cookieStore = await cookies();
	const access = cookieStore.get("spotify_access_token")?.value;
	const expStr = cookieStore.get("spotify_token_expires_at")?.value;
	const refresh = cookieStore.get("spotify_refresh_token")?.value;
	const exp = expStr ? Number(expStr) : 0;

	let accessToken = access;

	// If token is expired, try to refresh it
	if (!access || Date.now() >= exp) {
		console.log("spotify-search API: token expired, attempting refresh");
		if (!refresh) {
			console.log("spotify-search API: no refresh token available");
			return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
				console.log("spotify-search API: token refresh failed");
				return NextResponse.json({ error: "token_refresh_failed" }, { status: 401 });
			}
			
			type TokenJson = { access_token: string; expires_in: number; refresh_token?: string };
			const json = (await tokenRes.json()) as TokenJson;
			const expiresAt = Date.now() + json.expires_in * 1000 - 30_000;
			
			// Update cookies with new tokens
			cookieStore.set("spotify_access_token", json.access_token, { httpOnly: true, sameSite: "lax" });
			cookieStore.set("spotify_token_expires_at", String(expiresAt), { httpOnly: true, sameSite: "lax" });
			if (json.refresh_token) {
				cookieStore.set("spotify_refresh_token", json.refresh_token, { httpOnly: true, sameSite: "lax" });
			}
			
			accessToken = json.access_token;
			console.log("spotify-search API: token refreshed successfully");
		} catch (error) {
			console.error("spotify-search API: error refreshing token:", error);
			return NextResponse.json({ error: "token_refresh_error" }, { status: 401 });
		}
	}

	if (!accessToken) {
		console.log("spotify-search API: no access token available after refresh");
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	// Search Spotify for tracks
	const searchUrl = new URL("https://api.spotify.com/v1/search");
	searchUrl.searchParams.set("q", query);
	searchUrl.searchParams.set("type", "track");
	searchUrl.searchParams.set("limit", "10");
	searchUrl.searchParams.set("market", "US");

	try {
		const res = await fetch(searchUrl.toString(), {
			headers: { Authorization: `Bearer ${accessToken}` },
		});

		if (!res.ok) {
			const errorText = await res.text();
			console.error("spotify-search API: Spotify search error", { status: res.status, error: errorText });
			return NextResponse.json({ error: `Spotify search failed: ${res.status}` }, { status: res.status });
		}

		const data = await res.json();
		const tracks = data.tracks?.items?.map((track: any) => ({
			id: track.id,
			name: track.name,
			artist: track.artists.map((a: any) => a.name).join(", "),
			album: track.album.name,
			uri: track.uri,
		})) || [];

		return NextResponse.json({ tracks });
	} catch (error) {
		console.error("spotify-search API: error during search:", error);
		return NextResponse.json({ error: "search_failed" }, { status: 500 });
	}
}
