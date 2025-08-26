import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { deleteCookie } from "@/lib/cookies";

export async function POST() {
	deleteCookie("spotify_access_token");
	deleteCookie("spotify_refresh_token");
	deleteCookie("spotify_token_expires_at");
	deleteCookie("spotify_pkce_verifier");
	deleteCookie("spotify_auth_state");
	return NextResponse.redirect(`${env.APP_URL}/`);
}


