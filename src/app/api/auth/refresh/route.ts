import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCookie, setCookie } from "@/lib/cookies";

type SpotifyTokenResponse = {
	access_token: string;
	token_type: string;
	scope: string;
	expires_in: number;
	refresh_token?: string;
};

export async function GET() {
	const refreshToken = await getCookie("spotify_refresh_token");
	if (!refreshToken) return NextResponse.json({ error: "no_refresh_token" }, { status: 401 });

	const body = new URLSearchParams({
		client_id: env.SPOTIFY_CLIENT_ID,
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	});

	const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});

	if (!tokenRes.ok) return NextResponse.json({ error: "refresh_failed" }, { status: 401 });

	const json = (await tokenRes.json()) as SpotifyTokenResponse;
	const expiresAt = Date.now() + json.expires_in * 1000 - 30_000;
	await setCookie("spotify_access_token", json.access_token, { maxAge: json.expires_in });
	await setCookie("spotify_token_expires_at", String(expiresAt), { maxAge: 60 * 60 * 24 * 30 });
	if (json.refresh_token) {
		await setCookie("spotify_refresh_token", json.refresh_token, { maxAge: 60 * 60 * 24 * 30 });
	}

	return NextResponse.json({ ok: true });
}


