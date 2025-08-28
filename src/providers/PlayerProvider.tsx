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
	// Add timeout management
	startPlaybackTimeout: (durationMs: number, onTimeout: () => void) => void;
	clearPlaybackTimeout: () => void;
	// Authoritative snippet API
	playSnippet: (uri: string, startMs: number, durationMs: number) => Promise<void>;
	onSnippetStart: (cb: (durationMs: number) => void) => void;
	onSnippetEnd: (cb: () => void) => void;
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
				getCurrentState?: () => Promise<any>;
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
	const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Snippet authority state
	const playRequestIdRef = useRef(0);
	const snippetRafRef = useRef<number | null>(null);
	const snippetStartListenersRef = useRef<Array<(d: number) => void>>([]);
	const snippetEndListenersRef = useRef<Array<() => void>>([]);

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

	// Timeout management functions
	const startPlaybackTimeout = useCallback((durationMs: number, onTimeout: () => void) => {
		// Clear any existing timeout
		if (playbackTimeoutRef.current) {
			clearTimeout(playbackTimeoutRef.current);
		}
		
		console.log(`PlayerProvider: Starting playback timeout for ${durationMs}ms`);
		playbackTimeoutRef.current = setTimeout(() => {
			console.log("PlayerProvider: Playback timeout triggered!");
			onTimeout();
			playbackTimeoutRef.current = null;
		}, durationMs);
	}, []);

	const clearPlaybackTimeout = useCallback(() => {
		if (playbackTimeoutRef.current) {
			console.log("PlayerProvider: Clearing playback timeout");
			clearTimeout(playbackTimeoutRef.current);
			playbackTimeoutRef.current = null;
		}
	}, []);

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
			
			// CRITICAL: Handle player_state_changed to detect when playback actually starts
			playerRef.current.addListener("player_state_changed", (state: unknown) => {
				console.log("PlayerProvider: player state changed:", state);
				
				// Log the full state for debugging
				const playerState = state as any;
				console.log("PlayerProvider: Full state details:", {
					is_playing: playerState?.is_playing,
					paused: playerState?.paused,
					loading: playerState?.loading,
					position: playerState?.position,
					duration: playerState?.duration,
					track: playerState?.track,
					device_id: playerState?.device_id
				});
				
				// CRITICAL FIX: Extract is_playing from the actual state properties
				// The is_playing field might be undefined, but we can derive it
				const isActuallyPlaying = playerState && !playerState.paused && !playerState.loading;
				console.log("PlayerProvider: Derived is_playing status:", isActuallyPlaying);
				
				// Notify listeners for all state changes
				listeners.forEach((l, index) => {
					try { l(state); } catch (e) { console.error(`PlayerProvider: Error in listener ${index}:`, e); }
				});
			});
			
			// Create a promise to wait for the device ID
			let deviceIdResolve: (value: string) => void;
			const deviceIdPromise = new Promise<string>((resolve) => {
				deviceIdResolve = resolve;
			});
			
			playerRef.current.addListener("ready", (data: unknown) => {
				console.log("PlayerProvider: player ready event:", data);
				// Extract device ID from the ready event data
				const readyData = data as { device_id?: string };
				if (readyData?.device_id) {
					const newDeviceId = readyData.device_id;
					console.log("PlayerProvider: device ID captured from ready event:", newDeviceId);
					setDeviceId(newDeviceId);
					deviceIdResolve(newDeviceId);
				} else {
					console.log("PlayerProvider: device ID not found in ready event data");
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
				
				// Wait for the device ID to be available with a timeout
				console.log("PlayerProvider: waiting for device ID...");
				try {
					const capturedDeviceId = await Promise.race([
						deviceIdPromise,
						new Promise<string>((_, reject) => 
							setTimeout(() => reject(new Error("Device ID timeout")), 5000)
						)
					]);
					console.log("PlayerProvider: device ID received:", capturedDeviceId);
					return true;
				} catch (error) {
					console.error("PlayerProvider: error waiting for device ID:", error);
					return false;
				}
			}
			
			return false;
		} catch (error) {
			console.error("PlayerProvider: error during connection:", error);
			return false;
		}
	}, [listeners]);

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

	// Snippet event subscriptions
	const onSnippetStart = useCallback((cb: (d: number) => void) => {
		snippetStartListenersRef.current.push(cb);
	}, []);
	const onSnippetEnd = useCallback((cb: () => void) => {
		snippetEndListenersRef.current.push(cb);
	}, []);

	const cancelSnippetTimers = () => {
		if (snippetRafRef.current) cancelAnimationFrame(snippetRafRef.current);
		snippetRafRef.current = null;
		clearPlaybackTimeout();
	};

	const playSnippet = useCallback(async (uri: string, startMs: number, durationMs: number) => {
		const requestId = ++playRequestIdRef.current;
		await seek(startMs);
		await play(uri, startMs);
		
		const confirmStart = async () => {
			if (requestId !== playRequestIdRef.current) return; // canceled
			const state = await playerRef.current?.getCurrentState?.();
			if (state && !state.paused && state.position >= startMs + 30) {
				// Fire start
				snippetStartListenersRef.current.forEach(cb => { try { cb(durationMs); } catch {} });
				const trueStart = performance.now() + 75; // small cross-device buffer
				const tick = async () => {
					if (requestId !== playRequestIdRef.current) return; // canceled
					const elapsed = performance.now() - trueStart;
					if (elapsed >= durationMs - 40) {
						await pause();
						snippetEndListenersRef.current.forEach(cb => { try { cb(); } catch {} });
						cancelSnippetTimers();
						return;
					}
					snippetRafRef.current = requestAnimationFrame(tick);
				};
				snippetRafRef.current = requestAnimationFrame(tick);
			} else {
				setTimeout(confirmStart, 50);
			}
		};
		confirmStart();
	}, [pause, play, seek, clearPlaybackTimeout]);

	const value: PlayerContextValue = {
		initPlayer,
		connect,
		play,
		pause,
		seek,
		onStateChange,
		isSdkAvailable: ready,
		startPlaybackTimeout,
		clearPlaybackTimeout,
		playSnippet,
		onSnippetStart,
		onSnippetEnd,
	};

	return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
	const ctx = useContext(PlayerContext);
	if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
	return ctx;
}


