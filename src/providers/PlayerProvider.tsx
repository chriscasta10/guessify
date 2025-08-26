"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type PlayerContextValue = {
	initPlayer: () => Promise<void>;
	connect: () => Promise<boolean>;
	play: (uri: string, positionMs?: number) => Promise<void>;
	pause: () => Promise<void>;
	seek: (ms: number) => Promise<void>;
	onStateChange: (cb: (state: unknown) => void) => void;
	isSdkAvailable: boolean;
};

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);

declare global {
	interface Window {
		Spotify: {
			Player: new (options: {
				name: string;
				getOAuthToken: (cb: (t: string) => void) => void;
				volume?: number;
			}) => {
				connect: () => Promise<boolean>;
				addListener: (event: string, cb: (state: unknown) => void) => void;
				_options?: { id?: string };
			};
		};
		onSpotifyWebPlaybackSDKReady: () => void;
	}
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
	const playerRef = useRef<any>(null);
	const [ready, setReady] = useState(false);
	const [listeners, setListeners] = useState<Array<(s: unknown) => void>>([]);

	const initPlayer = useCallback(async () => {
		if (ready) return;
		await new Promise<void>((resolve) => {
			if (window.Spotify) return resolve();
			const script = document.createElement("script");
			script.src = "https://sdk.scdn.co/spotify-player.js";
			script.async = true;
			window.onSpotifyWebPlaybackSDKReady = () => resolve();
			document.body.appendChild(script);
		});
		setReady(true);
	}, [ready]);

	const connect = useCallback(async () => {
		if (playerRef.current) return true;
		const tokenRes = await fetch("/api/auth/token");
		const tokenJson = (await tokenRes.json().catch(() => ({}))) as { accessToken?: string };
		const accessToken = tokenJson?.accessToken as string | undefined;
		if (!accessToken || !window.Spotify) return false;
		playerRef.current = new window.Spotify.Player({
			name: "Guessify Player",
			getOAuthToken: (cb: (t: string) => void) => cb(accessToken),
			volume: 0.8,
		});
		playerRef.current.addListener("player_state_changed", (state: unknown) => {
			listeners.forEach((l) => l(state));
		});
		await playerRef.current.connect();
		return true;
	}, [listeners]);

	const play = useCallback(async (uri: string, positionMs = 0) => {
		const deviceId = (playerRef.current && playerRef.current._options?.id) || "";
		await fetch("/api/player/play", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ deviceId, uri, positionMs }),
		});
	}, []);

	const pause = useCallback(async () => {
		await fetch("/api/player/pause", { method: "PUT" });
	}, []);

	const seek = useCallback(async (ms: number) => {
		const deviceId = (playerRef.current && playerRef.current._options?.id) || "";
		await fetch("/api/player/seek", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ deviceId, positionMs: ms }),
		});
	}, []);

	const onStateChange = useCallback((cb: (s: unknown) => void) => {
		setListeners((prev) => prev.concat(cb));
	}, []);

	const value: PlayerContextValue = {
		initPlayer,
		connect,
		play,
		pause,
		seek,
		onStateChange,
		isSdkAvailable: ready,
	};

	return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
	const ctx = useContext(PlayerContext);
	if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
	return ctx;
}


