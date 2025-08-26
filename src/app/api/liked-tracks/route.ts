import { NextRequest, NextResponse } from "next/server";
import { getCookie } from "@/lib/cookies";

export async function GET(req: NextRequest) {
	const accessToken = await getCookie("spotify_access_token");
	if (!accessToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

	const url = new URL("https://api.spotify.com/v1/me/tracks");
	url.search = req.nextUrl.search;

	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	if (res.status === 429) {
		const retryAfter = res.headers.get("retry-after");
		return NextResponse.json(
			{ error: "rate_limited", retryAfter },
			{ status: 429, headers: { "retry-after": retryAfter ?? "1" } },
		);
	}
	const json = await res.json();
	return NextResponse.json(json);
}


