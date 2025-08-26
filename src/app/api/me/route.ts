import { NextResponse } from "next/server";
import { getCookie } from "@/lib/cookies";

export async function GET() {
	const accessToken = getCookie("spotify_access_token");
	if (!accessToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

	const res = await fetch("https://api.spotify.com/v1/me", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (res.status === 401) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}
	const json = await res.json();
	return NextResponse.json(json);
}


