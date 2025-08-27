import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
	console.log("liked-tracks API: request received", { search: req.nextUrl.search });
	
	const cookieStore = await cookies();
	const access = cookieStore.get("spotify_access_token")?.value;
	const expStr = cookieStore.get("spotify_token_expires_at")?.value;
	const refresh = cookieStore.get("spotify_refresh_token")?.value;
	const exp = expStr ? Number(expStr) : 0;

	let accessToken = access;

	// If token is expired, try to refresh it
	if (!access || Date.now() >= exp) {
		console.log("liked-tracks API: token expired, attempting refresh");
		if (!refresh) {
			console.log("liked-tracks API: no refresh token available");
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
				console.log("liked-tracks API: token refresh failed");
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
			console.log("liked-tracks API: token refreshed successfully");
		} catch (error) {
			console.error("liked-tracks API: error refreshing token:", error);
			return NextResponse.json({ error: "token_refresh_error" }, { status: 401 });
		}
	}

	if (!accessToken) {
		console.log("liked-tracks API: no access token available after refresh");
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	console.log("liked-tracks API: access token", accessToken ? "present" : "missing");

	const url = new URL("https://api.spotify.com/v1/me/tracks");
	url.search = req.nextUrl.search;
	console.log("liked-tracks API: calling Spotify API", url.toString());

	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	
	console.log("liked-tracks API: Spotify response", { status: res.status, ok: res.ok });
	
	if (res.status === 429) {
		const retryAfter = res.headers.get("retry-after");
		console.log("liked-tracks API: rate limited", { retryAfter });
		return NextResponse.json(
			{ error: "rate_limited", retryAfter },
			{ status: 429, headers: { "retry-after": retryAfter ?? "1" } },
		);
	}
	
	if (!res.ok) {
		const errorText = await res.text();
		console.error("liked-tracks API: Spotify API error", { status: res.status, error: errorText });
		return NextResponse.json({ error: `Spotify API error: ${res.status}` }, { status: res.status });
	}
	
	const json = await res.json();
	console.log("liked-tracks API: success", { itemCount: json.items?.length, hasNext: !!json.next });
	return NextResponse.json(json);
}


