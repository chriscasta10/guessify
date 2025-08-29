import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { assertEnv, env } from "@/lib/env";
import { createCodeChallenge, generateRandomString } from "@/lib/pkce";

const SCOPE = [
	"user-library-read",
	"streaming",
	"user-read-email",
	"user-read-private",
	"user-read-playback-state",
	"user-modify-playback-state",
].join(" ");

export async function GET(request: Request) {
	assertEnv();
	
	const { searchParams } = new URL(request.url);
	const forceReauth = searchParams.get("force") === "true";
	
	const state = generateRandomString(16);
	const verifier = generateRandomString(64);
	const challenge = await createCodeChallenge(verifier);

	const cookieStore = await cookies();
	cookieStore.set("spotify_pkce_verifier", verifier, { 
		maxAge: 600,
		path: "/",
		sameSite: "lax",
		secure: true,
		httpOnly: true
	});
	cookieStore.set("spotify_auth_state", state, { 
		maxAge: 600,
		path: "/",
		sameSite: "lax",
		secure: true,
		httpOnly: true
	});

	const params = new URLSearchParams({
		response_type: "code",
		client_id: env.SPOTIFY_CLIENT_ID,
		scope: SCOPE,
		redirect_uri: env.SPOTIFY_REDIRECT_URI,
		state,
		code_challenge_method: "S256",
		code_challenge: challenge,
		show_dialog: forceReauth ? "true" : "false",
	});

	const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
	console.log("Redirecting to Spotify authorization:", { 
		clientId: env.SPOTIFY_CLIENT_ID ? "present" : "missing",
		redirectUri: env.SPOTIFY_REDIRECT_URI,
		scope: SCOPE,
		forceReauth,
		showDialog: forceReauth ? "true" : "false"
	});
	return NextResponse.redirect(url);
}


