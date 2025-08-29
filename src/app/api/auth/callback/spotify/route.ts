import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

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
	
	const cookieStore = await cookies();
	const storedState = cookieStore.get("spotify_auth_state")?.value;
	const verifier = cookieStore.get("spotify_pkce_verifier")?.value;

	// Debug logging
	console.log("Callback received:", { 
		hasCode: !!code, 
		hasState: !!state, 
		hasStoredState: !!storedState, 
		hasVerifier: !!verifier,
		stateMatch: state === storedState,
		redirectUri: env.SPOTIFY_REDIRECT_URI,
		appUrl: env.APP_URL
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

	console.log("Exchanging authorization code for token...");
	const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});

	if (!tokenRes.ok) {
		const errorText = await tokenRes.text();
		console.log("Token exchange failed:", { status: tokenRes.status, error: errorText });
		return NextResponse.redirect(`${env.APP_URL}/?error=token_exchange_failed&status=${tokenRes.status}`);
	}

	const json = (await tokenRes.json()) as SpotifyTokenResponse;
	console.log("Token exchange successful:", { 
		hasAccessToken: !!json.access_token, 
		hasRefreshToken: !!json.refresh_token,
		scope: json.scope,
		expiresIn: json.expires_in
	});
	
	const expiresAt = Date.now() + json.expires_in * 1000 - 30_000; // 30s skew

	// Set cookies using the same method as other routes
	cookieStore.set("spotify_access_token", json.access_token, { 
		maxAge: json.expires_in,
		path: "/",
		sameSite: "lax",
		secure: true,
		httpOnly: true
	});
	cookieStore.set("spotify_refresh_token", json.refresh_token, { 
		maxAge: 60 * 60 * 24 * 30,
		path: "/",
		sameSite: "lax",
		secure: true,
		httpOnly: true
	});
	cookieStore.set("spotify_token_expires_at", String(expiresAt), { 
		maxAge: 60 * 60 * 24 * 30,
		path: "/",
		sameSite: "lax",
		secure: true,
		httpOnly: true
	});

	// Clear the PKCE cookies after successful token exchange
	cookieStore.delete("spotify_pkce_verifier");
	cookieStore.delete("spotify_auth_state");

	console.log("Cookies set successfully, redirecting to app...");
	return NextResponse.redirect(`${env.APP_URL}/`);
}


