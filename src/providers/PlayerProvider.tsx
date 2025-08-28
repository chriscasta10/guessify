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

interface PlaySnippetParams {
	uri: string;
	startMs: number;
	durationMs: number;
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
	// Current request tracking
	const currentRequestRef = useRef<number | null>(null);
	const playRequestsRef = useRef<Map<number, AbortController>>(new Map());
	const replayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	
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

	// Clean up a specific request
	const cleanupRequest = useCallback((requestId: number) => {
		console.log("🎵 Cleaning up request:", requestId);
		
		// Clear timers
		if (rafRef.current) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
		
		if (pollIntervalRef.current) {
			clearTimeout(pollIntervalRef.current);
			pollIntervalRef.current = null;
		}
		
		// Remove from requests map
		playRequestsRef.current.delete(requestId);
		
		// If this was the current request, clear it
		if (currentRequestRef.current === requestId) {
			currentRequestRef.current = null;
			
			// Don't reset player state here - let the end event handle it
			// The end event will set status to 'ended', and the UI can transition from there
		}
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
		
		try {
			await playerRef.current.seek(targetMs);
			console.log("🎵 Seek command sent successfully");
		} catch (error) {
			console.error("🎵 Seek command failed:", error);
			throw new Error(`Seek failed: ${error}`);
		}
		
		// Wait for confirmation via getCurrentState
		for (let i = 0; i < 40; i++) { // ~2s total wait max
			if (signal.aborted) throw new Error('aborted');
			
			try {
				const state = await playerRef.current.getCurrentState();
				console.log("🎵 Seek confirmation check:", { 
					i, 
					hasState: !!state,
					position: state?.position, 
					isPaused: state?.paused, 
					isLoading: state?.loading,
					targetMs, 
					requestId 
				});
				
				// Check if we have valid state data
				if (!state || typeof state.position !== 'number') {
					console.log("🎵 Player state incomplete, waiting...");
					await new Promise(resolve => setTimeout(resolve, 50));
					continue;
				}
				
				const position = state.position;
				const isPlaying = state && !state.paused && !state.loading;
				
				// More lenient confirmation - just check we're in the right ballpark
				if (position >= targetMs - 100 && isPlaying) {
					// We've advanced to the target region and playback has started
					const confirmedAt = performance.now();
					console.log("🎵 Seek confirmed at:", confirmedAt, "position:", position, "requestId:", requestId);
					return { confirmedAt, confirmedPosition: position };
				}
				
				// If we're way off, log it
				if (Math.abs(position - targetMs) > 1000) {
					console.warn("🎵 Position way off target:", { position, targetMs, difference: position - targetMs });
				}
				
			} catch (error) {
				console.error("🎵 Error getting player state:", error);
			}
			
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		
		// If we get here, try a fallback approach
		console.warn("🎵 Seek confirmation timed out, trying fallback...");
		
		try {
			const state = await playerRef.current.getCurrentState();
			if (state && typeof state.position === 'number') {
				const position = state.position;
				const confirmedAt = performance.now();
				console.log("🎵 Fallback confirmation:", { position, targetMs, confirmedAt });
				return { confirmedAt, confirmedPosition: position };
			}
		} catch (error) {
			console.error("🎵 Fallback confirmation failed:", error);
		}
		
		throw new Error('Failed to confirm seek position after timeout and fallback');
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

	// Wait for track to be loaded (as recommended by ChatGPT 5)
	const waitForTrackLoaded = useCallback(async (requestId: number, signal: AbortSignal): Promise<any> => {
		return new Promise((resolve, reject) => {
			let retries = 0;
			const maxRetries = 20; // 2 seconds max
			
			const listener = (state: any) => {
				if (signal.aborted) {
					playerRef.current?.removeListener('player_state_changed', listener);
					reject(new Error('Aborted'));
					return;
				}
				
				if (state?.track_window?.current_track) {
					playerRef.current?.removeListener('player_state_changed', listener);
					resolve(state);
				} else if (retries++ > maxRetries) {
					playerRef.current?.removeListener('player_state_changed', listener);
					reject(new Error('Timeout waiting for track load'));
				}
			};
			
			playerRef.current?.addListener('player_state_changed', listener);
			
			// Also check current state immediately
			playerRef.current?.getCurrentState().then((state: any) => {
				if (state?.track_window?.current_track) {
					playerRef.current?.removeListener('player_state_changed', listener);
					resolve(state);
				}
			});
		});
	}, []);
	
	// Safe seek with retry (as recommended by ChatGPT 5)
	const safeSeek = useCallback(async (ms: number, requestId: number, signal: AbortSignal, retries = 2): Promise<void> => {
		try {
			await playerRef.current?.seek(ms);
			console.log("🎯 Seek success:", ms);
		} catch (err) {
			if (retries > 0 && !signal.aborted) {
				console.warn("⚠️ Seek failed, retrying...", err);
				await new Promise(r => setTimeout(r, 300));
				return safeSeek(ms, requestId, signal, retries - 1);
			} else {
				console.error("❌ Seek failed after retries:", err);
				throw err;
			}
		}
	}, []);
	
	// Wait for snippet to end (as recommended by ChatGPT 5)
	const waitForSnippetEnd = useCallback(async (requestId: number, durationMs: number, signal: AbortSignal): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (signal.aborted) {
				reject(new Error('Aborted'));
				return;
			}
			
			// Set a timeout for the exact duration
			const timeoutId = setTimeout(async () => {
				try {
					await playerRef.current?.pause();
					console.log("⏹️ Snippet stopped after", durationMs, "ms");
					
					// Update player state to reflect snippet has ended
					updatePlayerState({ 
						status: 'ended', 
						isPlaying: false, 
						startTs: null,
						durationMs: null,
						progressMs: 0
					});
					
					// Emit end event BEFORE cleanup to ensure it's not lost
					snippetEndListenersRef.current.forEach(cb => { try { cb(); } catch {} });
					
					// Resolve the promise
					resolve();
				} catch (err) {
					console.error("❌ Error stopping snippet:", err);
					resolve(); // Resolve anyway to not block
				}
			}, durationMs);
			
			// Clean up timeout if aborted
			signal.addEventListener('abort', () => {
				clearTimeout(timeoutId);
				reject(new Error('Aborted'));
			});
		});
	}, [updatePlayerState]);

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
				const errorText = await tokenRes.text();
				console.error("🎵 Token fetch failed:", { status: tokenRes.status, error: errorText });
				throw new Error(`Token fetch failed: ${tokenRes.status} - ${errorText}`);
			}
			
			const tokenData = await tokenRes.json();
			console.log("🎵 Token response:", { 
				hasAccessToken: !!tokenData.access_token, 
				tokenLength: tokenData.access_token?.length,
				responseKeys: Object.keys(tokenData)
			});
			
			if (!tokenData.access_token) {
				throw new Error("No access token in response");
			}
			
			// Create player
			playerRef.current = new window.Spotify.Player({
				name: "Guessify Player",
				getOAuthToken: (cb) => cb(tokenData.access_token),
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
			
			// Add error listeners for debugging
			playerRef.current.addListener("initialization_error", (error: any) => {
				console.error("🎵 Player initialization error:", error);
			});
			
			playerRef.current.addListener("authentication_error", (error: any) => {
				console.error("🎵 Player authentication error:", error);
			});
			
			playerRef.current.addListener("account_error", (error: any) => {
				console.error("🎵 Player account error:", error);
			});
			
			playerRef.current.addListener("playback_error", (error: any) => {
				console.error("🎵 Player playback error:", error);
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
	const playSnippet = useCallback(async ({ uri, startMs, durationMs }: PlaySnippetParams): Promise<void> => {
		const requestId = ++playRequestIdRef.current;
		console.log("🎵 playSnippet requested:", { uri, startMs, durationMs, requestId });
		
		// Cancel any previous request
		if (currentRequestRef.current) {
			await cancelAllRequests();
		}
		
		// Create new abort controller for this request
		const abortController = new AbortController();
		playRequestsRef.current.set(requestId, abortController);
		currentRequestRef.current = requestId;
		
		try {
			// Ensure device is connected
			await connect();
			
			// Clamp start time if too close to end (safety check)
			const safeStartMs = Math.max(0, startMs);
			const trackDurationMs = 180000; // fallback default (3min) - ideally get from API
			if (safeStartMs + durationMs >= trackDurationMs) {
				startMs = Math.max(0, trackDurationMs - durationMs - 500);
				console.log("🎵 Adjusted start time to avoid end of track:", { original: safeStartMs, adjusted: startMs });
			}
			
			// Step 1: Start playback (always fresh so seek works)
			console.log("🎵 Starting playback for track:", uri);
			await play(uri);
			
			// Step 2: Wait until track is confirmed loaded
			console.log("🎵 Waiting for track to load...");
			const state = await waitForTrackLoaded(requestId, abortController.signal);
			console.log("✅ Track loaded:", state.track_window.current_track.name);
			
			// Step 3: Safe seek with retry
			await safeSeek(startMs, requestId, abortController.signal);
			
			// Step 4: Start timing and progress tracking
			const trueStart = performance.now();
			
			// Store parameters for replay
			lastRequestParamsRef.current = { uri, startMs, durationMs };
			
			// Update player state
			updatePlayerState({ 
				status: 'playing', 
				isPlaying: true, 
				startTs: trueStart,
				durationMs,
				progressMs: 0
			});
			
			// Emit start event
			snippetStartListenersRef.current.forEach(cb => { try { cb(durationMs); } catch {} });
			
			startRAFProgressLoop(requestId, trueStart, durationMs);
			startPollingCorrectionLoop(requestId, trueStart, startMs, durationMs);
			
			// Step 5: Wait for snippet to end
			await waitForSnippetEnd(requestId, durationMs, abortController.signal);
			
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				console.log("🎵 playSnippet aborted for request:", requestId);
				return;
			}
			console.error("🎵 Error in playSnippet:", error);
			throw error;
		} finally {
			cleanupRequest(requestId);
		}
	}, [connect, play]);

	// Store last request parameters for replay
	const lastRequestParamsRef = useRef<PlaySnippetParams | null>(null);
	
	// Replay function (as recommended by ChatGPT 5)
	const replay = useCallback(async (): Promise<void> => {
		if (!lastRequestParamsRef.current) {
			console.warn("🎵 No previous request to replay");
			return;
		}
		
		// Debounce replay to avoid double-triggering
		if (replayTimeoutRef.current) {
			clearTimeout(replayTimeoutRef.current);
		}
		
		replayTimeoutRef.current = setTimeout(async () => {
			try {
				console.log("🎵 Replaying last request:", lastRequestParamsRef.current);
				await playSnippet(lastRequestParamsRef.current!);
			} catch (error) {
				console.error("🎵 Replay failed:", error);
			}
		}, 100);
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
		console.log("🎵 onSnippetEnd callback registered");
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


