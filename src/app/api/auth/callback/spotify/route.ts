import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCookie, setCookie } from "@/lib/cookies";

type SpotifyTokenResponse = {
	access_token: string;
	token_type: string;
	scope: string;
	expires_in: number;
	refresh_token: string;
};

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const code = searchParams.get("code");
	const state = searchParams.get("state");
	const storedState = await getCookie("spotify_auth_state");
	const verifier = await getCookie("spotify_pkce_verifier");

	// Debug logging
	console.log("Callback received:", { 
		hasCode: !!code, 
		hasState: !!state, 
		hasStoredState: !!storedState, 
		hasVerifier: !!verifier,
		stateMatch: state === storedState 
	});

	if (!code || !state || !verifier || state !== storedState) {
		console.log("State verification failed:", { 
			code: !!code, 
			state: !!state, 
			verifier: !!verifier, 
			stateMatch: state === storedState 
		});
		return NextResponse.redirect(`${env.APP_URL}/?error=state_mismatch&debug=${encodeURIComponent(JSON.stringify({ hasCode: !!code, hasState: !!state, hasStoredState: !!storedState, hasVerifier: !!verifier }))}`);
	}

	const body = new URLSearchParams({
		client_id: env.SPOTIFY_CLIENT_ID,
		grant_type: "authorization_code",
		code,
		redirect_uri: env.SPOTIFY_REDIRECT_URI,
		code_verifier: verifier,
	});

	const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});

	if (!tokenRes.ok) {
		console.log("Token exchange failed:", await tokenRes.text());
		return NextResponse.redirect(`${env.APP_URL}/?error=token_exchange_failed`);
	}

	const json = (await tokenRes.json()) as SpotifyTokenResponse;
	const expiresAt = Date.now() + json.expires_in * 1000 - 30_000; // 30s skew

	await setCookie("spotify_access_token", json.access_token, { 
		maxAge: json.expires_in,
		path: "/",
		sameSite: "lax",
		secure: true
	});
	await setCookie("spotify_refresh_token", json.refresh_token, { 
		maxAge: 60 * 60 * 24 * 30,
		path: "/",
		sameSite: "lax",
		secure: true
	});
	await setCookie("spotify_token_expires_at", String(expiresAt), { 
		maxAge: 60 * 60 * 24 * 30,
		path: "/",
		sameSite: "lax",
		secure: true
	});

	// Clear the PKCE cookies after successful token exchange
	await setCookie("spotify_pkce_verifier", "", { maxAge: 0, path: "/" });
	await setCookie("spotify_auth_state", "", { maxAge: 0, path: "/" });

	return NextResponse.redirect(`${env.APP_URL}/`);
}


