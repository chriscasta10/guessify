import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/spotify-utils";

export async function GET() {
	const tokenInfo = await getValidAccessToken();
	if (!tokenInfo) {
		return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	}

	return NextResponse.json({ access_token: tokenInfo.access_token });
}


