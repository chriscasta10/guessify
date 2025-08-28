import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function GET() {
	const cookieStore = await cookies();
	const access = cookieStore.get("spotify_access_token")?.value;
	const expStr = cookieStore.get("spotify_token_expires_at")?.value;
	const refresh = cookieStore.get("spotify_refresh_token")?.value;
	const exp = expStr ? Number(expStr) : 0;

	if (access && Date.now() < exp) {
		return NextResponse.json({ access_token: access });
	}

	if (!refresh) return NextResponse.json({ error: "no_refresh" }, { status: 401 });

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
	if (!tokenRes.ok) return NextResponse.json({ error: "refresh_failed" }, { status: 401 });
	type TokenJson = { access_token: string; expires_in: number; refresh_token?: string };
	const json = (await tokenRes.json()) as TokenJson;
	const expiresAt = Date.now() + json.expires_in * 1000 - 30_000;
	cookieStore.set("spotify_access_token", json.access_token, { httpOnly: true, sameSite: "lax" });
	cookieStore.set("spotify_token_expires_at", String(expiresAt), { httpOnly: true, sameSite: "lax" });
	if (json.refresh_token) {
		cookieStore.set("spotify_refresh_token", json.refresh_token, { httpOnly: true, sameSite: "lax" });
	}
	return NextResponse.json({ accessToken: json.access_token });
}


