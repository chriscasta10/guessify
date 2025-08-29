import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken, checkTokenScopes, generateReauthUrl } from "@/lib/spotify-utils";

export async function GET(req: NextRequest) {
	console.log("liked-tracks API: request received", { search: req.nextUrl.search });
	
	const tokenInfo = await getValidAccessToken();
	if (!tokenInfo) {
		console.log("liked-tracks API: no valid access token available");
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	// Check if token has required scopes
	const scopeCheck = await checkTokenScopes();
	if (!scopeCheck.hasLibraryRead) {
		console.log("liked-tracks API: missing user-library-read scope");
		return NextResponse.json({ 
			error: "insufficient_scopes", 
			missingScopes: scopeCheck.missingScopes,
			reauthUrl: generateReauthUrl()
		}, { status: 403 });
	}

	console.log("liked-tracks API: calling Spotify API with valid token");

	const url = new URL("https://api.spotify.com/v1/me/tracks");
	url.search = req.nextUrl.search;
	console.log("liked-tracks API: calling Spotify API", url.toString());

	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${tokenInfo.access_token}` },
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


