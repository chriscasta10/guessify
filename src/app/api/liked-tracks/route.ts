import { NextRequest, NextResponse } from "next/server";
import { getCookie } from "@/lib/cookies";

export async function GET(req: NextRequest) {
	console.log("liked-tracks API: request received", { search: req.nextUrl.search });
	
	const accessToken = await getCookie("spotify_access_token");
	console.log("liked-tracks API: access token", accessToken ? "present" : "missing");
	
	if (!accessToken) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

	const url = new URL("https://api.spotify.com/v1/me/tracks");
	url.search = req.nextUrl.search;
	console.log("liked-tracks API: calling Spotify API", url.toString());

	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	
	console.log("liked-tracks API: Spotify response", { status: res.status, ok: res.ok });
	
	if (res.status === 429) {
		const retryAfter = res.headers.get("retry-after");
		console.log("liked-tracks API: rate limited", { retryAfter });
		return NextResponse.json(
			{ error: "rate_limited", retryAfter },
			{ status: 429, headers: { "retry-after": retryAfter ?? "1" } },
		);
	}
	
	if (!res.ok) {
		const errorText = await res.text();
		console.error("liked-tracks API: Spotify API error", { status: res.status, error: errorText });
		return NextResponse.json({ error: `Spotify API error: ${res.status}` }, { status: res.status });
	}
	
	const json = await res.json();
	console.log("liked-tracks API: success", { itemCount: json.items?.length, hasNext: !!json.next });
	return NextResponse.json(json);
}


