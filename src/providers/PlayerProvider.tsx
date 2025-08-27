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
	const [deviceId, setDeviceId] = useState<string>("");
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
		console.log("PlayerProvider: connect() called");
		if (playerRef.current && deviceId) {
			console.log("PlayerProvider: player already exists with device ID, returning true");
			return true;
		}
		
		console.log("PlayerProvider: fetching token...");
		const tokenRes = await fetch("/api/auth/token");
		console.log("PlayerProvider: token response status:", tokenRes.status);
		
		const tokenJson = (await tokenRes.json().catch(() => ({}))) as { accessToken?: string };
		console.log("PlayerProvider: token response:", tokenJson);
		
		const accessToken = tokenJson?.accessToken as string | undefined;
		if (!accessToken) {
			console.log("PlayerProvider: no access token available");
			return false;
		}
		
		if (!window.Spotify) {
			console.log("PlayerProvider: window.Spotify not available");
			return false;
		}
		
		console.log("PlayerProvider: creating new Spotify Player...");
		try {
			playerRef.current = new window.Spotify.Player({
				name: "Guessify Player",
				getOAuthToken: (cb: (t: string) => void) => {
					console.log("PlayerProvider: getOAuthToken callback called");
					cb(accessToken);
				},
				volume: 0.8,
			});
			
			console.log("PlayerProvider: player created, adding listeners...");
			playerRef.current.addListener("player_state_changed", (state: unknown) => {
				console.log("PlayerProvider: player state changed:", state);
				listeners.forEach((l) => l(state));
			});
			
			playerRef.current.addListener("ready", (data: unknown) => {
				console.log("PlayerProvider: player ready event:", data);
				// The device ID should be available in the ready event
				if (playerRef.current?._options?.id) {
					const newDeviceId = playerRef.current._options.id;
					console.log("PlayerProvider: device ID captured:", newDeviceId);
					setDeviceId(newDeviceId);
				} else {
					console.log("PlayerProvider: device ID not found in ready event");
				}
			});
			
			playerRef.current.addListener("not_ready", (data: unknown) => {
				console.log("PlayerProvider: player not ready event:", data);
			});
			
			playerRef.current.addListener("initialization_error", (data: unknown) => {
				console.log("PlayerProvider: initialization error:", data);
			});
			
			playerRef.current.addListener("authentication_error", (data: unknown) => {
				console.log("PlayerProvider: authentication error:", data);
			});
			
			playerRef.current.addListener("account_error", (data: unknown) => {
				console.log("PlayerProvider: account error:", data);
			});
			
			playerRef.current.addListener("playback_error", (data: unknown) => {
				console.log("PlayerProvider: playback error:", data);
			});
			
			console.log("PlayerProvider: attempting to connect...");
			const connected = await playerRef.current.connect();
			console.log("PlayerProvider: connect() result:", connected);
			
			if (connected) {
				console.log("PlayerProvider: successfully connected!");
				console.log("PlayerProvider: player options:", playerRef.current._options);
				
				// Wait for the device ID to be available
				if (!deviceId) {
					console.log("PlayerProvider: waiting for device ID...");
					await new Promise<void>((resolve) => {
						const checkDeviceId = () => {
							if (deviceId || (playerRef.current?._options?.id)) {
								resolve();
							} else {
								setTimeout(checkDeviceId, 100);
							}
						};
						checkDeviceId();
					});
				}
			}
			
			return connected;
		} catch (error) {
			console.error("PlayerProvider: error during connection:", error);
			return false;
		}
	}, [listeners, deviceId]);

	const play = useCallback(async (uri: string, positionMs = 0) => {
		console.log("PlayerProvider: play() called", { uri, positionMs });
		const currentDeviceId = deviceId || (playerRef.current?._options?.id);
		console.log("PlayerProvider: device ID for play:", currentDeviceId);
		
		if (!currentDeviceId) {
			throw new Error("No device ID available - player not ready");
		}
		
		try {
			const response = await fetch("/api/player/play", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceId: currentDeviceId, uri, positionMs }),
			});
			
			console.log("PlayerProvider: play API response status:", response.status);
			if (!response.ok) {
				const errorText = await response.text();
				console.error("PlayerProvider: play API error:", { status: response.status, error: errorText });
				throw new Error(`Play API failed: ${response.status} - ${errorText}`);
			}
			
			const result = await response.json();
			console.log("PlayerProvider: play API success:", result);
		} catch (error) {
			console.error("PlayerProvider: play() error:", error);
			throw error;
		}
	}, [deviceId]);

	const pause = useCallback(async () => {
		console.log("PlayerProvider: pause() called");
		try {
			const response = await fetch("/api/player/pause", { method: "PUT" });
			console.log("PlayerProvider: pause API response status:", response.status);
			if (!response.ok) {
				const errorText = await response.text();
				console.error("PlayerProvider: pause API error:", { status: response.status, error: errorText });
			}
		} catch (error) {
			console.error("PlayerProvider: pause() error:", error);
		}
	}, []);

	const seek = useCallback(async (ms: number) => {
		console.log("PlayerProvider: seek() called", { ms });
		const currentDeviceId = deviceId || (playerRef.current?._options?.id);
		console.log("PlayerProvider: device ID for seek:", currentDeviceId);
		
		if (!currentDeviceId) {
			throw new Error("No device ID available - player not ready");
		}
		
		try {
			const response = await fetch("/api/player/seek", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceId: currentDeviceId, positionMs: ms }),
			});
			
			console.log("PlayerProvider: seek API response status:", response.status);
			if (!response.ok) {
				const errorText = await response.text();
				console.error("PlayerProvider: seek API error:", { status: response.status, error: errorText });
				throw new Error(`Seek API failed: ${response.status} - ${errorText}`);
			}
			
			const result = await response.json();
			console.log("PlayerProvider: seek API success:", result);
		} catch (error) {
			console.error("PlayerProvider: seek() error:", error);
			throw error;
		}
	}, [deviceId]);

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


