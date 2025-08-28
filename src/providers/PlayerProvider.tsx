"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// Request model for proper serialization
interface PlayRequest {
	requestId: number;
	uri: string;
	startMs: number;
	durationMs: number;
	abortController: AbortController;
	createdAt: number;
}

// State model for clean status tracking
interface PlayerState {
	status: 'idle' | 'requesting' | 'seeking' | 'playing' | 'paused' | 'ended' | 'error';
	currentRequestId: number | null;
	isPlaying: boolean;
	startTs: number | null;
	durationMs: number | null;
	progressMs: number;
}

type PlayerContextValue = {
	// Core playback
	playSnippet: (params: { uri: string; startMs: number; durationMs: number }) => Promise<void>;
	replay: () => Promise<void>;
	stop: () => Promise<void>;
	seek: (ms: number) => Promise<void>;
	
	// State and events
	playerState: PlayerState;
	onSnippetStart: (cb: (durationMs: number) => void) => void;
	onSnippetProgress: (cb: (progressMs: number) => void) => void;
	onSnippetEnd: (cb: () => void) => void;
	onError: (cb: (error: Error) => void) => void;
	onStateChange: (cb: (state: PlayerState) => void) => void;
	
	// Connection management
	initPlayer: () => Promise<void>;
	connect: () => Promise<boolean>;
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
				getCurrentState?: () => Promise<any>;
				seek: (ms: number) => Promise<void>;
				resume: () => Promise<void>;
				pause: () => Promise<void>;
			};
		};
		onSpotifyWebPlaybackSDKReady: () => void;
	}
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
	const playerRef = useRef<any>(null);
	const [ready, setReady] = useState(false);
	const [deviceId, setDeviceId] = useState<string>("");
	
	// Request serialization
	const playRequestIdRef = useRef(0);
	const currentRequestRef = useRef<PlayRequest | null>(null);
	const playRequestsRef = useRef<Map<number, AbortController>>(new Map());
	
	// Timing and progress
	const rafRef = useRef<number | null>(null);
	const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const trueStartTsRef = useRef<number | null>(null);
	
	// Event listeners
	const snippetStartListenersRef = useRef<Array<(d: number) => void>>([]);
	const snippetProgressListenersRef = useRef<Array<(p: number) => void>>([]);
	const snippetEndListenersRef = useRef<Array<() => void>>([]);
	const errorListenersRef = useRef<Array<(e: Error) => void>>([]);
	const stateChangeListenersRef = useRef<Array<(s: PlayerState) => void>>([]);
	
	// Player state
	const [playerState, setPlayerState] = useState<PlayerState>({
		status: 'idle',
		currentRequestId: null,
		isPlaying: false,
		startTs: null,
		durationMs: null,
		progressMs: 0
	});

	// Update player state and notify listeners
	const updatePlayerState = useCallback((updates: Partial<PlayerState>) => {
		const newState = { ...playerState, ...updates };
		setPlayerState(newState);
		stateChangeListenersRef.current.forEach(cb => { try { cb(newState); } catch {} });
	}, [playerState]);

	// Cleanup function for a specific request
	const cleanupRequest = useCallback((requestId: number) => {
		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		if (pollIntervalRef.current) {
			clearTimeout(pollIntervalRef.current);
			pollIntervalRef.current = null;
		}
		playRequestsRef.current.delete(requestId);
		trueStartTsRef.current = null;
	}, []);

	// Cancel all active requests
	const cancelAllRequests = useCallback(async () => {
		// Abort all active requests
		playRequestsRef.current.forEach(controller => controller.abort());
		playRequestsRef.current.clear();
		
		// Cleanup timers
		cleanupRequest(playRequestIdRef.current);
		
		// Pause player
		try {
			if (playerRef.current) {
				await playerRef.current.pause();
			}
		} catch (error) {
			console.log("Error pausing player during cleanup:", error);
		}
		
		// Reset state
		updatePlayerState({
			status: 'idle',
			currentRequestId: null,
			isPlaying: false,
			startTs: null,
			durationMs: null,
			progressMs: 0
		});
	}, [cleanupRequest, updatePlayerState]);

	// Seek then confirm pattern (as recommended by ChatGPT 5)
	const seekThenConfirm = useCallback(async (targetMs: number, requestId: number, signal: AbortSignal): Promise<{ confirmedAt: number; confirmedPosition: number }> => {
		console.log("🎵 Seeking to position:", targetMs, "requestId:", requestId);
		
		await playerRef.current.seek(targetMs);
		
		// Wait for confirmation via getCurrentState
		for (let i = 0; i < 40; i++) { // ~2s total wait max
			if (signal.aborted) throw new Error('aborted');
			
			const state = await playerRef.current.getCurrentState();
			const position = state?.position ?? -1;
			const isPlaying = state && !state.paused && !state.loading;
			
			console.log("🎵 Seek confirmation check:", { i, position, isPlaying, targetMs, requestId });
			
			if (position >= targetMs - 20 && isPlaying) {
				// We've advanced to the target region and playback has started
				const confirmedAt = performance.now();
				console.log("🎵 Seek confirmed at:", confirmedAt, "position:", position, "requestId:", requestId);
				return { confirmedAt, confirmedPosition: position };
			}
			
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		
		throw new Error('Failed to confirm seek position');
	}, []);

	// RAF progress loop (as recommended by ChatGPT 5)
	const startRAFProgressLoop = useCallback((requestId: number, trueStartTs: number, durationMs: number) => {
		console.log("🎵 Starting RAF progress loop:", { requestId, trueStartTs, durationMs });
		
		const tick = () => {
			if (requestId !== playRequestIdRef.current) return; // stale
			
			const elapsed = performance.now() - trueStartTs;
			const progressMs = Math.min(elapsed, durationMs);
			
			// Emit progress
			snippetProgressListenersRef.current.forEach(cb => { try { cb(progressMs); } catch {} });
			updatePlayerState({ progressMs });
			
			if (elapsed >= durationMs) {
				// End handled by poll loop for safety
				return;
			}
			
			rafRef.current = requestAnimationFrame(tick);
		};
		
		rafRef.current = requestAnimationFrame(tick);
	}, [updatePlayerState]);

	// Polling correction loop (as recommended by ChatGPT 5)
	const startPollingCorrectionLoop = useCallback((requestId: number, trueStartTs: number, startMs: number, durationMs: number) => {
		console.log("🎵 Starting polling correction loop:", { requestId, trueStartTs, startMs, durationMs });
		
		let corrections = 0;
		
		const poll = async () => {
			if (requestId !== playRequestIdRef.current) return;
			
			try {
				const state = await playerRef.current.getCurrentState();
				if (!state) {
					pollIntervalRef.current = setTimeout(poll, 100);
					return;
				}
				
				const actualPos = state.position; // ms
				const wallElapsed = performance.now() - trueStartTs;
				const posElapsed = actualPos - startMs;
				
				console.log("🎵 Poll correction check:", { requestId, actualPos, wallElapsed, posElapsed, corrections });
				
				// If they diverge by > 100ms, correct the UI baseline
				if (Math.abs(posElapsed - wallElapsed) > 100) {
					trueStartTsRef.current = performance.now() - posElapsed;
					corrections++;
					console.log("🎵 Corrected timing baseline:", { corrections, newBaseline: trueStartTsRef.current });
				}
				
				// Enforce stop if position >= startMs + duration - jitter
				if (posElapsed >= durationMs - 40) {
					console.log("🎵 Poll loop enforcing stop:", { requestId, posElapsed, durationMs });
					await playerRef.current.pause();
					
					// Emit end event
					snippetEndListenersRef.current.forEach(cb => { try { cb(); } catch {} });
					updatePlayerState({ status: 'ended', isPlaying: false });
					
					// Cleanup
					cleanupRequest(requestId);
					return;
				}
				
				pollIntervalRef.current = setTimeout(poll, 50);
			} catch (error) {
				console.error("🎵 Error in poll loop:", error);
				pollIntervalRef.current = setTimeout(poll, 100);
			}
		};
		
		poll();
	}, [cleanupRequest, updatePlayerState]);

	// Initialize Spotify SDK
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

	// Connect to Spotify
	const connect = useCallback(async () => {
		console.log("🎵 Connecting to Spotify...");
		
		if (playerRef.current && deviceId) {
			console.log("🎵 Already connected with device ID:", deviceId);
			return true;
		}
		
		try {
			// Get token
			const tokenRes = await fetch("/api/auth/token");
			if (!tokenRes.ok) {
				throw new Error(`Token fetch failed: ${tokenRes.status}`);
			}
			const { access_token } = await tokenRes.json();
			
			// Create player
			playerRef.current = new window.Spotify.Player({
				name: "Guessify Player",
				getOAuthToken: (cb) => cb(access_token),
				volume: 0.8
			});
			
			// Add listeners
			playerRef.current.addListener("ready", ({ device_id }: { device_id: string }) => {
				console.log("🎵 Player ready with device ID:", device_id);
				setDeviceId(device_id);
			});
			
			playerRef.current.addListener("not_ready", ({ device_id }: { device_id: string }) => {
				console.log("🎵 Player not ready:", device_id);
			});
			
			playerRef.current.addListener("player_state_changed", (state: any) => {
				console.log("🎵 Player state changed:", state);
			});
			
			// Connect
			const connected = await playerRef.current.connect();
			if (!connected) {
				throw new Error("Failed to connect to Spotify");
			}
			
			console.log("🎵 Successfully connected to Spotify");
			return true;
			
		} catch (error) {
			console.error("🎵 Connection error:", error);
			return false;
		}
	}, [deviceId]);

	// Play function for Spotify Web Playback SDK
	const play = useCallback(async (uri: string, positionMs = 0) => {
		console.log("🎵 Play called:", { uri, positionMs });
		const currentDeviceId = deviceId || (playerRef.current?._options?.id);
		
		if (!currentDeviceId) {
			throw new Error("No device ID available - player not ready");
		}
		
		try {
			const response = await fetch("/api/player/play", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deviceId: currentDeviceId, uri, positionMs }),
			});
			
			if (!response.ok) {
				const errorText = await response.text();
				throw new Error(`Play API failed: ${response.status} - ${errorText}`);
			}
			
			console.log("🎵 Play API success");
		} catch (error) {
			console.error("🎵 Play error:", error);
			throw error;
		}
	}, [deviceId]);

	// Pause function for Spotify Web Playback SDK
	const pause = useCallback(async () => {
		console.log("🎵 Pause called");
		try {
			const response = await fetch("/api/player/pause", { method: "PUT" });
			if (!response.ok) {
				console.error("🎵 Pause API error:", response.status);
			}
		} catch (error) {
			console.error("🎵 Pause error:", error);
		}
	}, []);

	// Main playSnippet function (as recommended by ChatGPT 5)
	const playSnippet = useCallback(async ({ uri, startMs, durationMs }: { uri: string; startMs: number; durationMs: number }) => {
		console.log("🎵 playSnippet called:", { uri, startMs, durationMs });
		
		// Cancel previous request
		if (currentRequestRef.current) {
			console.log("🎵 Cancelling previous request:", currentRequestRef.current.requestId);
			currentRequestRef.current.abortController.abort();
			cleanupRequest(currentRequestRef.current.requestId);
		}
		
		// Create new request
		const requestId = ++playRequestIdRef.current;
		const abortController = new AbortController();
		const request: PlayRequest = {
			requestId,
			uri,
			startMs,
			durationMs,
			abortController,
			createdAt: performance.now()
		};
		
		currentRequestRef.current = request;
		playRequestsRef.current.set(requestId, abortController);
		
		console.log("🎵 Starting new request:", requestId);
		updatePlayerState({ status: 'requesting', currentRequestId: requestId });
		
		try {
			// Ensure device is connected
			await connect();
			
			// Seek then confirm (as recommended by ChatGPT 5)
			const { confirmedAt, confirmedPosition } = await seekThenConfirm(startMs, requestId, abortController.signal);
			
			// Start playback
			await play(uri, startMs);
			
			// Start timing
			trueStartTsRef.current = confirmedAt;
			updatePlayerState({ 
				status: 'playing', 
				isPlaying: true, 
				startTs: confirmedAt,
				durationMs,
				progressMs: 0
			});
			
			// Emit start event
			snippetStartListenersRef.current.forEach(cb => { try { cb(durationMs); } catch {} });
			
			// Start RAF progress loop
			startRAFProgressLoop(requestId, confirmedAt, durationMs);
			
			// Start polling correction loop
			startPollingCorrectionLoop(requestId, confirmedAt, startMs, durationMs);
			
			console.log("🎵 Request started successfully:", requestId);
			
		} catch (error) {
			if (error instanceof Error && error.message === 'aborted') {
				console.log("🎵 Request aborted:", requestId);
				return;
			}
			
			console.error("🎵 Error in playSnippet:", error);
			errorListenersRef.current.forEach(cb => { try { cb(error as Error); } catch {} });
			updatePlayerState({ status: 'error' });
			throw error;
		}
	}, [connect, seekThenConfirm, startRAFProgressLoop, startPollingCorrectionLoop, cleanupRequest, updatePlayerState, play]);

	// Replay function (as recommended by ChatGPT 5)
	const replay = useCallback(async () => {
		if (!currentRequestRef.current) {
			console.log("🎵 No current request to replay");
			return;
		}
		
		const { uri, startMs, durationMs } = currentRequestRef.current;
		console.log("🎵 Replaying current snippet:", { uri, startMs, durationMs });
		
		// Use minimal debounce (100ms) to avoid double-triggered replays
		await new Promise(resolve => setTimeout(resolve, 100));
		
		await playSnippet({ uri, startMs, durationMs });
	}, [playSnippet]);

	// Stop function
	const stop = useCallback(async () => {
		console.log("🎵 Stop requested");
		await cancelAllRequests();
	}, [cancelAllRequests]);

	// Seek function
	const seek = useCallback(async (ms: number) => {
		console.log("🎵 Seek requested:", ms);
		if (playerRef.current) {
			await playerRef.current.seek(ms);
		}
	}, []);

	// Event subscription functions
	const onSnippetStart = useCallback((cb: (durationMs: number) => void) => {
		snippetStartListenersRef.current.push(cb);
	}, []);
	
	const onSnippetProgress = useCallback((cb: (progressMs: number) => void) => {
		snippetProgressListenersRef.current.push(cb);
	}, []);
	
	const onSnippetEnd = useCallback((cb: () => void) => {
		snippetEndListenersRef.current.push(cb);
	}, []);
	
	const onError = useCallback((cb: (error: Error) => void) => {
		errorListenersRef.current.push(cb);
	}, []);
	
	const onStateChange = useCallback((cb: (state: PlayerState) => void) => {
		stateChangeListenersRef.current.push(cb);
	}, []);

	const value: PlayerContextValue = {
		playSnippet,
		replay,
		stop,
		seek,
		playerState,
		onSnippetStart,
		onSnippetProgress,
		onSnippetEnd,
		onError,
		onStateChange,
		initPlayer,
		connect,
		isSdkAvailable: ready,
	};

	return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
	const ctx = useContext(PlayerContext);
	if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
	return ctx;
}


