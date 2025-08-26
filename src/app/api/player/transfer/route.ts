import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
	const { deviceId, play } = (await req.json()) as { deviceId: string; play?: boolean };
	const access = cookies().get("spotify_access_token")?.value;
	if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
	const res = await fetch("https://api.spotify.com/v1/me/player", {
		method: "PUT",
		headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
		body: JSON.stringify({ device_ids: [deviceId], play: Boolean(play) }),
	});
	return NextResponse.json({ ok: res.ok });
}


