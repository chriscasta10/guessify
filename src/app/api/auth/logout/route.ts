import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { deleteCookie } from "@/lib/cookies";

export async function POST() {
	await deleteCookie("spotify_access_token");
	await deleteCookie("spotify_refresh_token");
	await deleteCookie("spotify_token_expires_at");
	await deleteCookie("spotify_pkce_verifier");
	await deleteCookie("spotify_auth_state");
	return NextResponse.redirect(`${env.APP_URL}/`);
}


