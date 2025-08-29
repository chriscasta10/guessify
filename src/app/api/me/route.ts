import { NextResponse } from "next/server";
import { getValidAccessToken, checkTokenScopes, generateReauthUrl } from "@/lib/spotify-utils";

export async function GET() {
	const tokenInfo = await getValidAccessToken();
	if (!tokenInfo) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	// Check if token has required scopes
	const scopeCheck = await checkTokenScopes();
	if (scopeCheck.missingScopes.length > 0) {
		console.log("me API: missing scopes", scopeCheck.missingScopes);
		return NextResponse.json({ 
			error: "insufficient_scopes", 
			missingScopes: scopeCheck.missingScopes,
			reauthUrl: generateReauthUrl()
		}, { status: 403 });
	}

	console.log("me API: calling Spotify API with valid token");

	const res = await fetch("https://api.spotify.com/v1/me", {
		headers: { Authorization: `Bearer ${tokenInfo.access_token}` },
	});
	
	console.log("me API: Spotify response", { status: res.status, ok: res.ok });
	
	if (res.status === 401) {
		console.log("me API: unauthorized - token may be invalid");
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}
	
	if (!res.ok) {
		const errorText = await res.text();
		console.error("me API: Spotify API error", { status: res.status, error: errorText });
		return NextResponse.json({ error: `Spotify API error: ${res.status}` }, { status: res.status });
	}
	
	const json = await res.json();
	console.log("me API: success", { userId: json.id, displayName: json.display_name });
	return NextResponse.json(json);
}


