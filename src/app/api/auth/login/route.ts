import { NextResponse } from "next/server";
import { assertEnv, env } from "@/lib/env";
import { createCodeChallenge, generateRandomString } from "@/lib/pkce";
import { setCookie } from "@/lib/cookies";

const SCOPE = [
	"user-library-read",
	"streaming",
	"user-read-email",
	"user-read-private",
	"user-read-playback-state",
	"user-modify-playback-state",
].join(" ");

export async function GET() {
	assertEnv();
	const state = generateRandomString(16);
	const verifier = generateRandomString(64);
	const challenge = await createCodeChallenge(verifier);

	await setCookie("spotify_pkce_verifier", verifier, { maxAge: 600 });
	await setCookie("spotify_auth_state", state, { maxAge: 600 });

	const params = new URLSearchParams({
		response_type: "code",
		client_id: env.SPOTIFY_CLIENT_ID,
		scope: SCOPE,
		redirect_uri: env.SPOTIFY_REDIRECT_URI,
		state,
		code_challenge_method: "S256",
		code_challenge: challenge,
		show_dialog: "false",
	});

	const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
	return NextResponse.redirect(url);
}


