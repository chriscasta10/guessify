import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function PUT(req: Request) {
  const { deviceId, positionMs } = (await req.json()) as {
    deviceId: string;
    positionMs: number;
  };
  const access = cookies().get("spotify_access_token")?.value;
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await fetch(
    `https://api.spotify.com/v1/me/player/seek?device_id=${encodeURIComponent(deviceId)}&position_ms=${encodeURIComponent(
      positionMs,
    )}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${access}` },
    },
  );
  return NextResponse.json({ ok: res.ok });
}


