"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { usePlayer } from "@/providers/PlayerProvider";
import { SearchAutocomplete } from "@/components/SearchAutocomplete";

// Level-based round system: one song progresses through difficulty levels
interface GameLevel {
	name: string;
	duration: number;
	points: number;
}

const GAME_LEVELS: GameLevel[] = [
	{ name: "Extreme", duration: 1000, points: 1000 },   // 1.0s - more challenging
	{ name: "Hard", duration: 2000, points: 500 },       // 2.0s
	{ name: "Medium", duration: 5000, points: 250 },     // 5.0s
	{ name: "Easy", duration: 10000, points: 125 },      // 10.0s
];

type GameState = "waiting" | "playing" | "guessing" | "correct" | "gameOver";

interface GameStats {
	currentScore: number;
	highScore: number;
	currentStreak: number;
	bestStreak: number;
}

interface RoundData {
	track: any;
	currentLevelIndex: number;
	attempts: number;
}

interface SearchResult {
	id: string;
	name: string;
	artist: string;
	album: string;
	uri: string;
}

interface UserProfile {
	display_name: string;
	images: Array<{ url: string }>;
}

export function GuessifyGame() {
	const { initPlayer, connect, playSnippet, pause, seek, isSdkAvailable, onSnippetStart, onSnippetEnd, onStateChange } = usePlayer() as any;
	const { tracks, loadAll, loading, error, loadingProgress } = useLikedTracks(50);
	const [gameState, setGameState] = useState<GameState>("waiting");
	const [currentRound, setCurrentRound] = useState<RoundData | null>(null);
	const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult | null>(null);
	const [gameStats, setGameStats] = useState<GameStats>(() => {
		// Load from localStorage on init
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('guessify-stats');
			if (saved) {
				try {
					return JSON.parse(saved);
				} catch (e) {
					console.error('Failed to parse saved stats:', e);
				}
			}
		}
		return {
			currentScore: 0,
			highScore: 0,
			currentStreak: 0,
			bestStreak: 0,
		};
	});
	const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
	const [debugInfo, setDebugInfo] = useState<string>("");
	const [audioDebug, setAudioDebug] = useState<string>("");
	const [endScreenData, setEndScreenData] = useState<{
		finalScore: number;
		finalStreak: number;
		track: any;
		wasCorrect: boolean;
	} | null>(null);
	const [buttonAnimation, setButtonAnimation] = useState<string>("");
	const [hasStartedGame, setHasStartedGame] = useState(false); // Track if game has started
	const [isPreloading, setIsPreloading] = useState(false); // Track audio preloading
	const [fetchedArtistImages, setFetchedArtistImages] = useState<Record<string, string>>({}); // Store fetched artist images
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const isPlayingRef = useRef(false);
	const hasPlayedRef = useRef(false);
	const currentLevelRef = useRef<GameLevel | null>(null);
	// CRITICAL FIX: Store the exact snippet position for replay
	const currentSnippetPositionRef = useRef<number>(0);
	// Store snippet positions for each level to ensure consistency
	const levelSnippetPositionsRef = useRef<Record<number, number>>({});
	// Pending duration for the next started playback (used to bind timers exactly)
	const pendingDurationRef = useRef<number | null>(null);

	// Hard-cap timeout to guarantee exact stop time
	const hardCapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clearHardCapTimeout = useCallback(() => {
		if (hardCapTimeoutRef.current) {
			clearTimeout(hardCapTimeoutRef.current);
			hardCapTimeoutRef.current = null;
		}
	}, []);

	// Celebration SFX
	const correctSfxRef = useRef<HTMLAudioElement | null>(null);
	const correctExtremeSfxRef = useRef<HTMLAudioElement | null>(null);
	const wrongSfxRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		// Preload SFX
		if (typeof window === 'undefined') return;
		try {
			correctSfxRef.current = new Audio('/sfx/correct.mp3');
			correctSfxRef.current.preload = 'auto';
			correctSfxRef.current.volume = 0.6;
			correctExtremeSfxRef.current = new Audio('/sfx/correct-extreme.mp3');
			correctExtremeSfxRef.current.preload = 'auto';
			correctExtremeSfxRef.current.volume = 0.65;
			wrongSfxRef.current = new Audio('/sfx/wrong.mp3');
			wrongSfxRef.current.preload = 'auto';
			wrongSfxRef.current.volume = 0.6;
		} catch {}
	}, []);

	const playSfx = (ref: React.MutableRefObject<HTMLAudioElement | null>) => {
		try {
			const el = ref.current;
			if (!el) return;
			el.currentTime = 0;
			void el.play().catch(() => {});
		} catch {}
	};

	const triggerConfetti = () => {
		// Lightweight DOM confetti
		const container = document.createElement('div');
		container.style.position = 'fixed';
		container.style.left = '0';
		container.style.top = '0';
		container.style.width = '100%';
		container.style.height = '100%';
		container.style.pointerEvents = 'none';
		container.style.zIndex = '1000';
		document.body.appendChild(container);
		const colors = ['#34d399','#60a5fa','#a78bfa','#fbbf24','#ef4444'];
		const pieces = 80;
		for (let i = 0; i < pieces; i++) {
			const piece = document.createElement('div');
			piece.style.position = 'absolute';
			piece.style.width = '8px';
			piece.style.height = '12px';
			piece.style.background = colors[i % colors.length];
			piece.style.left = Math.random()*100 + '%';
			piece.style.top = '-20px';
			piece.style.opacity = '0.9';
			piece.style.transform = `rotate(${Math.random()*360}deg)`;
			const fall = 700 + Math.random()*700;
			const drift = (Math.random()*2-1)*200;
			piece.animate([
				{ transform: 'translate(0,0) rotate(0deg)', top: '-20px' },
				{ transform: `translate(${drift}px, 100vh) rotate(${Math.random()*720}deg)`, top: '100vh' }
			], { duration: fall, easing: 'cubic-bezier(0.2, 0.6, 0.2, 1)', fill: 'forwards' });
			container.appendChild(piece);
		}
		setTimeout(() => { try { document.body.removeChild(container); } catch {} }, 1200);
	};

	// Load user profile from Spotify
	const loadUserProfile = useCallback(async () => {
		try {
			const response = await fetch('/api/me');
			if (response.ok) {
				const profile = await response.json();
				setUserProfile(profile);
			}
		} catch (error) {
			console.error('Failed to load user profile:', error);
		}
	}, []);

	// CRITICAL FIX: Pre-initialize Spotify SDK when user first visits
	const preInitializeSpotify = useCallback(async () => {
		if (!isSdkAvailable) return;
		
		console.log("🚀 Pre-initializing Spotify SDK for faster first play...");
		setAudioDebug("Pre-initializing Spotify SDK...");
		
		try {
			// Connect to SDK in background
			await connect();
			setAudioDebug("Spotify SDK pre-initialized successfully!");
			console.log("✅ Spotify SDK pre-initialized");
		} catch (error) {
			console.log("⚠️ Spotify SDK pre-initialization failed (this is okay):", error);
			setAudioDebug("Pre-initialization failed (will initialize on first play)");
		}
	}, [isSdkAvailable, connect]);

	// CRITICAL FIX: Fetch artist image when album data is missing
	const fetchArtistImage = useCallback(async (track: any): Promise<string | null> => {
		if (!track) return null;
		
		const artistName = track.artist;
		console.log("🖼️ fetchArtistImage called for track:", {
			trackId: track.id,
			trackName: track.name,
			artistName: artistName,
			// ✅ NEW: Check if we have the new data fields
			hasArtistsArray: !!track.artists,
			artistsArray: track.artists,
			hasAlbumData: !!track.album,
			albumData: track.album,
			// Legacy fields
			hasPreview: track.hasPreview,
			previewUrl: track.previewUrl,
			// ✅ NEW: Show the full track object structure
			fullTrackObject: track
		});
		
		// CRITICAL FIX: Check if we have the new data structure
		if (track.artists && track.artists.length > 0 && track.artists[0].id) {
			const artistId = track.artists[0].id;
			console.log("🎯 Found artist ID:", artistId, "for artist:", track.artists[0].name);
			
			try {
				const response = await fetch(`/api/artists/${artistId}`);
				if (response.ok) {
					const artistData = await response.json();
					console.log("🎨 Artist API response:", artistData);
					
					if (artistData.images && artistData.images.length > 0) {
						const imageUrl = artistData.images[0].url;
						console.log("✅ Found artist image via ID:", imageUrl);
						setFetchedArtistImages(prev => ({ ...prev, [artistName]: imageUrl }));
						return imageUrl;
					} else {
						console.log("⚠️ Artist API returned no images for ID:", artistId);
					}
				} else {
					console.log("❌ Artist API failed for ID:", artistId, "Status:", response.status);
				}
			} catch (error) {
				console.log("❌ Error fetching artist by ID:", error);
			}
		} else {
			console.log("⚠️ No artist ID available, falling back to search");
		}
		
		// Fallback: search by artist name
		console.log("🔍 Searching for artist by name:", artistName);
		try {
			const response = await fetch(`/api/spotify-search?q=${encodeURIComponent(artistName)} artist&type=artist&limit=5`);
			if (response.ok) {
				const searchData = await response.json();
				console.log("🔍 Search results:", searchData);
				
				if (searchData.artists && searchData.artists.items && searchData.artists.items.length > 0) {
					// Find best match
					const bestMatch = searchData.artists.items.find((artist: any) => 
						artist.name.toLowerCase() === artistName.toLowerCase()
					) || searchData.artists.items[0];
					
					console.log("🎯 Best artist match:", bestMatch);
					
					if (bestMatch.images && bestMatch.images.length > 0) {
						const imageUrl = bestMatch.images[0].url;
						console.log("✅ Found artist image via search:", imageUrl);
						setFetchedArtistImages(prev => ({ ...prev, [artistName]: imageUrl }));
						return imageUrl;
					} else {
						console.log("⚠️ Best match has no images");
					}
				} else {
					console.log("❌ No search results found");
				}
			} else {
				console.log("❌ Search API failed, Status:", response.status);
			}
		} catch (error) {
			console.log("❌ Error searching for artist:", error);
		}
		
		console.log("❌ No artist image found, will use fallback emoji");
		return null;
	}, []);

	useEffect(() => {
		console.log("PlayTestClip: useEffect triggered");
		void initPlayer();
		// Load user profile
		void loadUserProfile();
		
		// CRITICAL FIX: Pre-initialize Spotify SDK after a short delay
		setTimeout(() => {
			void preInitializeSpotify();
		}, 2000); // Wait 2 seconds after component mounts
	}, [initPlayer, preInitializeSpotify]);

	// Listen for player state changes to start timeout when SDK playback begins
	useEffect(() => {
		const handlePlayerStateChange = (state: unknown) => {
			console.log("GuessifyGame: Player state changed:", state);
			
			// Log the full state object for debugging
			const playerState = state as any;
			console.log("GuessifyGame: Full player state:", {
				is_playing: playerState?.is_playing,
				paused: playerState?.paused,
				loading: playerState?.loading,
				position: playerState?.position,
				duration: playerState?.duration,
				track: playerState?.track,
				device_id: playerState?.device_id
			});
			
			// CRITICAL FIX: Derive is_playing status the same way as PlayerProvider
			const isActuallyPlaying = playerState && !playerState.paused && !playerState.loading;
			console.log("GuessifyGame: Derived is_playing status:", isActuallyPlaying);
			
			// Check if this is a playback start event and we're waiting for it
			if (isActuallyPlaying && isPlayingRef.current && currentLevelRef.current) {
				console.log("GuessifyGame: SDK playback started! Starting timeout now...");
				setAudioDebug(`SDK playback confirmed, starting ${formatTime(currentLevelRef.current.duration)} timeout...`);
				
				// Start the timeout now that playback has actually started
				const timeoutMs = pendingDurationRef.current ?? currentLevelRef.current.duration;
				pendingDurationRef.current = null;
				// The provider handles the timeout, so we just need to ensure state is correct
				// setGameState("guessing"); // This will be handled by the provider's onSnippetEnd
				// setAudioDebug("🚨 SDK TIMEOUT: Time's up - time to guess!"); // This will be handled by the provider's onSnippetEnd
				// stopProgress(); // This will be handled by the provider's onSnippetEnd
				// Force stop SDK playback // This will be handled by the provider's onSnippetEnd
				// try { pause(); } catch (e) { console.log("SDK pause failed during timeout, but that's okay:", e); } // This will be handled by the provider's onSnippetEnd
			} else {
				console.log("GuessifyGame: State change ignored - conditions not met:", {
					hasState: !!playerState,
					isActuallyPlaying,
					isPlayingRef: isPlayingRef.current,
					hasCurrentLevel: !!currentLevelRef.current
				});
			}
		};

		console.log("GuessifyGame: Setting up player state change listener");
		onStateChange(handlePlayerStateChange);
		
		// Return cleanup function
		return () => {
			console.log("GuessifyGame: Cleaning up player state change listener");
		};
	}, [onStateChange, currentLevelRef.current]);

	useEffect(() => {
		console.log("PlayTestClip: tracks changed", { 
			tracksLength: tracks.length, 
			loading, 
			error,
			sampleTrack: tracks[0] 
		});
	}, [tracks, loading, error]);

	// Save stats to localStorage whenever they change
	useEffect(() => {
		if (typeof window !== 'undefined') {
			localStorage.setItem('guessify-stats', JSON.stringify(gameStats));
		}
	}, [gameStats]);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
			clearHardCapTimeout();
		};
	}, [clearHardCapTimeout]);

	// CRITICAL FIX: Preload audio for current track to eliminate delays
	const preloadAudio = useCallback(async (track: any) => {
		if (!track.previewUrl) return;
		
		setIsPreloading(true);
		setAudioDebug("Preloading audio for instant playback...");
		
		try {
			// Create new audio element for preloading
			const preloadAudio = new Audio(track.previewUrl);
			preloadAudio.preload = 'auto';
			
			// Wait for audio to be ready
			await new Promise((resolve, reject) => {
				preloadAudio.oncanplaythrough = resolve;
				preloadAudio.onerror = reject;
				// Timeout after 5 seconds
				setTimeout(() => reject(new Error('Preload timeout')), 5000);
			});
			
			// Store preloaded audio
			audioRef.current = preloadAudio;
			setAudioDebug("Audio preloaded successfully!");
		} catch (error) {
			console.error('Audio preload failed:', error);
			setAudioDebug("Preload failed, will load on-demand");
		} finally {
			setIsPreloading(false);
		}
	}, []);

	const startNewRound = useCallback(async () => {
		console.log("PlayTestClip: startNewRound called", { 
			tracksLength: tracks.length, 
			isSdkAvailable, 
			loading,
			error 
		});

		// Clear any existing timeout and reset state
		// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
		clearHardCapTimeout();
		stopProgress();
		isPlayingRef.current = false;
		hasPlayedRef.current = false;
		currentSnippetPositionRef.current = 0; // Reset snippet position
		currentLevelRef.current = null; // Reset level ref to avoid duration carryover
		// Clear all level snippet positions for new round
		levelSnippetPositionsRef.current = {};
		try { pause(); } catch {}
		if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }

		// CRITICAL FIX: Only reset current score/streak if this is a completely new game
		// If continuing from a correct guess, keep the accumulated score/streak
		if (!hasStartedGame) {
			setGameStats(prev => ({
				...prev,
				currentScore: 0,
				currentStreak: 0,
			}));
		}

		// Load tracks on-demand if we don't have any
		if (tracks.length === 0) {
			setDebugInfo("Loading tracks...");
			console.log("No tracks available, loading on-demand");
			await loadAll();
			// Wait a bit for tracks to load
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		if (tracks.length === 0) {
			setDebugInfo("Still no tracks loaded");
			console.log("Still no tracks available after loading");
			return;
		}

		// Get a random track, prioritizing ones with preview URLs
		const tracksWithPreview = tracks.filter(t => t.hasPreview && t.previewUrl);
		const availableTracks = tracksWithPreview.length > 0 ? tracksWithPreview : tracks;
		const randomIndex = Math.floor(Math.random() * availableTracks.length);
		const track = availableTracks[randomIndex];
		
		console.log("Selected track:", track);
		console.log("Track preview info:", { hasPreview: track.hasPreview, previewUrl: track.previewUrl });
		
		// Start new round at Level 1 (Extreme difficulty)
		const newRound: RoundData = {
			track,
			currentLevelIndex: 0,
			attempts: 0,
		};
		
		setCurrentRound(newRound);
		setSelectedSearchResult(null);
		setGameState("waiting");
		setHasStartedGame(true); // Mark that game has started
		setDebugInfo("New round started! Click 'Play' to begin.");
		
		// CRITICAL FIX: Preload audio for instant playback
		if (track.previewUrl) {
			void preloadAudio(track);
		}
	}, [tracks, loading, error, loadAll, hasStartedGame, preloadAudio, pause]);

	// CRITICAL FIX: New function that takes a specific level parameter
	const playCurrentLevelWithLevel = useCallback(async (specificLevel?: any) => {
		console.log("🎵 playCurrentLevelWithLevel called:", {
			specificLevel: specificLevel?.name || "none",
			currentGameState: gameState,
			hasCurrentRound: !!currentRound,
			isPlayingRef: isPlayingRef.current
		});
		
		if (!currentRound) {
			console.log("❌ No current round, cannot play");
			return;
		}

		// Prevent multiple simultaneous plays unless this is an override for a new level
		if (isPlayingRef.current && !specificLevel) {
			console.log("⚠️ Already playing, ignoring play request");
			return;
		}

		// If overriding with a new level, force-stop current playback first
		if (specificLevel) {
			console.log("🔄 Overriding with new level, stopping current playback");
			// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
			clearHardCapTimeout();
			isPlayingRef.current = false;
			try { pause(); } catch {}
			if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
		}

		// CRITICAL FIX: Use the passed level OR get from currentRound state
		const currentLevel = specificLevel || GAME_LEVELS[currentRound.currentLevelIndex];
		const track = currentRound.track;
		// Record intended duration for the upcoming playback start event
		pendingDurationRef.current = currentLevel.duration;
		
		console.log("🎵 playCurrentLevelWithLevel details:", {
			specificLevel: specificLevel?.name || "none",
			levelIndex: currentRound.currentLevelIndex,
			levelName: currentLevel.name,
			levelDuration: currentLevel.duration,
			formattedDuration: formatTime(currentLevel.duration),
			currentLevelRef: currentLevelRef.current?.name,
			currentLevelRefDuration: currentLevelRef.current?.duration,
			// ✅ NEW: Show the exact duration that will be used
			willPlayFor: formatTime(currentLevel.duration),
			levelMismatch: currentLevelRef.current?.duration !== currentLevel.duration ? "⚠️ MISMATCH!" : "✅ Match",
			trackUri: track?.uri,
			trackName: track?.name
		});
		
		// CRITICAL FIX: Use stored snippet position for replay, or generate new one
		let snippetPosition: number;
		const isReplay = hasPlayedRef.current && levelSnippetPositionsRef.current[currentRound.currentLevelIndex] && !specificLevel;
		
		if (isReplay) {
			// Replay: use the exact same snippet position for this level
			snippetPosition = levelSnippetPositionsRef.current[currentRound.currentLevelIndex];
			console.log("🔄 REPLAY: Using exact same snippet position:", snippetPosition, "for level", currentRound.currentLevelIndex);
		} else {
			// First play or level change: generate new random position
			snippetPosition = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (currentLevel.duration + 5000))));
			// Store this position for this specific level
			levelSnippetPositionsRef.current[currentRound.currentLevelIndex] = snippetPosition;
			console.log("🎯 NEW: Generated snippet position:", snippetPosition, "for level", currentRound.currentLevelIndex);
		}

		// CRITICAL FIX: For "More Time" button, stay in guessing mode and just show playing message
		if (gameState === "guessing" || specificLevel) {
			// This is a replay or level change - just show playing message, don't change state
			console.log("🔄 Replay/level change - staying in current state:", gameState);
			setDebugInfo(`Playing ${currentLevel.name} level clip...`);
			setAudioDebug(`Playing ${formatTime(currentLevel.duration)} snippet (${currentLevel.name} level)...`);
		} else {
			// This is first play - change to playing state
			console.log("🎯 First play - changing gameState from", gameState, "to playing");
			setDebugInfo(`Playing ${currentLevel.name} level clip...`);
			setGameState("playing");
			setAudioDebug(`Starting ${formatTime(currentLevel.duration)} snippet (${currentLevel.name} level)...`);
		}
		
		isPlayingRef.current = true;
		hasPlayedRef.current = true;
		// CRITICAL FIX: Update the current level reference to match the current round
		currentLevelRef.current = currentLevel;
		
		console.log("🎵 About to call playSnippet with:", {
			uri: track.uri,
			startMs: snippetPosition,
			durationMs: currentLevel.duration,
			gameState: gameState,
			isPlayingRef: isPlayingRef.current
		});
		
		try {
			// Always try Spotify SDK first (works for all tracks)
			if (isSdkAvailable) {
				console.log("🎵 Using Spotify SDK for playback");
				await connect();
				console.log("🎵 Connected to Spotify, calling playSnippet...");
				await playSnippet(track.uri, snippetPosition, currentLevel.duration);
				console.log("🎵 playSnippet completed successfully");
				return;
			}

			// Fallback to preview URL if SDK failed or not available
			if (track.previewUrl) {
				console.log("Using preview URL fallback");
				setAudioDebug("Using preloaded audio for instant playback");
				
				// Use preloaded audio if available
				if (!audioRef.current) {
					audioRef.current = new Audio(track.previewUrl);
					console.log("Created new Audio element (fallback)");
				}
				
				// Reset audio and set position
				audioRef.current.currentTime = snippetPosition / 1000;
				audioRef.current.volume = 0.8;
				
				// Add event listeners for debugging
				audioRef.current.onloadstart = () => setAudioDebug("Audio loading started");
				audioRef.current.oncanplay = () => setAudioDebug("Audio can play");
				audioRef.current.onplay = () => {
					setAudioDebug("Audio play event fired - starting timeout now!");
					console.log("Preview audio started, setting timeout for", currentLevel.duration, "ms");
					
					// Set timeout ONLY after audio actually starts playing
					const previewDur = pendingDurationRef.current ?? currentLevel.duration;
					pendingDurationRef.current = null;
					// The provider handles the timeout, so we just need to ensure state is correct
					// startPlaybackTimeout(previewDur, () => { // This will be handled by the provider's onSnippetEnd
					// 	console.log("🚨 PREVIEW TIMEOUT TRIGGERED - STOPPING AUDIO");
					// 	isPlayingRef.current = false;
						
					// 	// CRITICAL FIX: Only change state if we're still in playing mode
					// 	// This prevents conflicts with Give Up button
					// 	if (gameState === "playing") {
					// 		setGameState("guessing");
					// 		setAudioDebug("🚨 PREVIEW TIMEOUT: Time's up - time to guess!");
					// 	} else {
					// 		console.log("🚨 Timeout triggered but game state is already:", gameState);
					// 	}
					// 	stopProgress();
					// 	// Force stop preview audio
					// 	if (audioRef.current) {
					// 		audioRef.current.pause();
					// 		audioRef.current.currentTime = 0;
					// 	}
					// });
					// Safety hard-cap for preview
					clearHardCapTimeout();
					hardCapTimeoutRef.current = setTimeout(() => {
						if (!isPlayingRef.current) return;
						console.log("⛔ Hard-cap (preview) enforcing exact duration");
						isPlayingRef.current = false;
						if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
						stopProgress();
						setGameState("guessing");
					}, previewDur + 40);
				};
				audioRef.current.onended = () => setAudioDebug("Audio ended");
				audioRef.current.onerror = (e) => setAudioDebug("Audio error: " + e);
				
				// Play the audio
				try {
					setAudioDebug("Playing preloaded audio...");
					await audioRef.current.play();
					console.log("Preview audio play() called, waiting for onplay event...");
					// Don't set timeout here - wait for onplay event
				} catch (playError) {
					console.error("Error playing audio:", playError);
					setDebugInfo(`Audio playback error: ${playError instanceof Error ? playError.message : 'Unknown error'}`);
					setAudioDebug("Play error: " + (playError instanceof Error ? playError.message : 'Unknown'));
					setGameState("waiting");
					isPlayingRef.current = false;
				}
			} else {
				setDebugInfo("No preview URL available for this track");
				setAudioDebug("No preview URL - can't play this track");
				setGameState("waiting");
				isPlayingRef.current = false;
			}
		} catch (err) {
			console.error("Error playing clip:", err);
			setDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			setAudioDebug("General error: " + (err instanceof Error ? err.message : 'Unknown'));
			setGameState("waiting");
			isPlayingRef.current = false;
		}
	}, [currentRound, connect, isSdkAvailable, pause, playSnippet, gameState]);

	// CRITICAL FIX: Use the new function that handles level parameters properly
	const playCurrentLevel = useCallback(async () => {
		await playCurrentLevelWithLevel();
	}, [playCurrentLevelWithLevel]);

	const nextLevel = useCallback(() => {
		if (!currentRound) return;
		
		// Move to next level (longer clip)
		if (currentRound.currentLevelIndex < GAME_LEVELS.length - 1) {
			const nextLevelIndex = currentRound.currentLevelIndex + 1;
			const nextLevel = GAME_LEVELS[nextLevelIndex];
			
			console.log(`🎯 Moving from level ${currentRound.currentLevelIndex} (${GAME_LEVELS[currentRound.currentLevelIndex].name}) to level ${nextLevelIndex} (${nextLevel.name})`);
			console.log(`⏱️ Duration changing from ${formatTime(GAME_LEVELS[currentRound.currentLevelIndex].duration)} to ${formatTime(nextLevel.duration)}`);
			
			// If currently playing/replaying, force stop immediately so More Time takes over
			if (isPlayingRef.current) {
				// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
				clearHardCapTimeout();
				isPlayingRef.current = false;
				try { pause(); } catch {}
				if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
				stopProgress();
			}
			
			// CRITICAL FIX: Update the round state FIRST
			setCurrentRound(prev => prev ? {
				...prev,
				currentLevelIndex: nextLevelIndex,
				attempts: prev.attempts + 1,
			} : null);
			
			setDebugInfo(`Level increased to ${nextLevel.name} (${formatTime(nextLevel.duration)})`);
			
			// CRITICAL FIX: Reset snippet position for new level
			currentSnippetPositionRef.current = 0; // Reset for new level
			hasPlayedRef.current = false; // Reset play state
			
			// CRITICAL FIX: Clear replay cache for new level
			// clearReplayCache(); // This was removed from usePlayer, so no longer needed here
			
			// CRITICAL FIX: Update the current level reference to the new level
			currentLevelRef.current = nextLevel;
			
			// CRITICAL FIX: Play the new level immediately with the correct duration
			console.log(`🎵 Playing new level immediately: ${nextLevel.name} (${formatTime(nextLevel.duration)})`);
			
			// Force play with the new level - this will generate a new snippet position
			setTimeout(() => {
				// CRITICAL FIX: Pass the new level directly instead of relying on state
				void playCurrentLevelWithLevel(nextLevel);
			}, 25);
		}
	}, [currentRound, clearHardCapTimeout, pause, playCurrentLevelWithLevel]);

	const submitGuess = useCallback(() => {
		if (!currentRound || !selectedSearchResult) return;

		// Stop any playback immediately to prevent bleed into end screen or next round
		// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
		clearHardCapTimeout();
		isPlayingRef.current = false;
		currentSnippetPositionRef.current = 0;
		currentLevelRef.current = null;
		stopProgress();
		try { pause(); } catch {}
		if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }

		// Check if guess is correct (ID match first)
		let isCorrect = selectedSearchResult.id === currentRound.track.id;
		
		// Fallback: strict title + primary artist match (case-insensitive, trimmed)
		if (!isCorrect) {
			const normalize = (s: string) => s.trim().toLowerCase();
			const guessedName = normalize(selectedSearchResult.name);
			const guessedArtist = normalize(selectedSearchResult.artist.split(',')[0] || selectedSearchResult.artist);
			const trackName = normalize(currentRound.track.name);
			const trackArtist = normalize((currentRound.track.artist || '').split(',')[0] || currentRound.track.artist || '');
			isCorrect = guessedName === trackName && (!!trackArtist && guessedArtist === trackArtist);
			console.log("submitGuess: ID mismatch, name/artist fallback:", {
				guessedName,
				trackName,
				guessedArtist,
				trackArtist,
				result: isCorrect
			});
		}

		if (isCorrect) {
			// Award points for current level
			const currentLevel = GAME_LEVELS[currentRound.currentLevelIndex];
			const pointsEarned = currentLevel.points;
			
			// Play SFX + confetti (Extreme only)
			if (currentLevel.name === 'Extreme') {
				playSfx(correctExtremeSfxRef);
				triggerConfetti();
			} else {
				playSfx(correctSfxRef);
			}
			
			// Update stats
			setGameStats(prev => {
				const newScore = prev.currentScore + pointsEarned;
				const newStreak = prev.currentStreak + 1;
				
				return {
					currentScore: newScore,
					highScore: Math.max(prev.highScore, newScore),
					currentStreak: newStreak,
					bestStreak: Math.max(prev.bestStreak, newStreak),
				};
			});
			
			setDebugInfo(`Correct! +${pointsEarned} points for ${currentLevel.name} level.`);
			setButtonAnimation("correct");
			
			// Reset level/timer state to avoid carryover into next round
			// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
			clearHardCapTimeout();
			isPlayingRef.current = false;
			currentSnippetPositionRef.current = 0;
			currentLevelRef.current = null;
			
			// End round and show end screen (with Next Round)
			setEndScreenData({
				finalScore: gameStats.currentScore + pointsEarned,
				finalStreak: gameStats.currentStreak + 1,
				track: currentRound.track,
				wasCorrect: true,
			});
			setGameState("gameOver");
		} else {
			// Wrong guess - end run immediately
			playSfx(wrongSfxRef);
			setButtonAnimation("incorrect");
			setEndScreenData({
				finalScore: gameStats.currentScore,
				finalStreak: gameStats.currentStreak,
				track: currentRound.track,
				wasCorrect: false,
			});
			setGameState("gameOver");
		}
	}, [currentRound, selectedSearchResult, gameStats.currentScore, gameStats.currentStreak, clearHardCapTimeout, pause]);

	const giveUp = useCallback(() => {
		if (!currentRound) return;
		
		// CRITICAL FIX: Clear any active timeouts to prevent state conflicts
		// clearPlaybackTimeout(); // No longer needed as provider handles timeouts
		clearHardCapTimeout();
		isPlayingRef.current = false;
		currentSnippetPositionRef.current = 0;
		currentLevelRef.current = null;
		stopProgress();
		
		// Play wrong SFX
		playSfx(wrongSfxRef);
		
		// Give up - end run with 0 points, break streak
		setGameStats(prev => ({
			...prev,
			currentStreak: 0,
		}));
		
		setEndScreenData({
			finalScore: gameStats.currentScore,
			finalStreak: 0,
			track: currentRound.track,
			wasCorrect: false,
		});
		
		// CRITICAL FIX: Force game over state immediately
		setGameState("gameOver");
		
		// CRITICAL FIX: Stop any playing audio
		if (audioRef.current) {
			audioRef.current.pause();
			audioRef.current.currentTime = 0;
		}
		
		// CRITICAL FIX: Force stop SDK playback
		try {
			pause();
		} catch (e) {
			console.log("SDK pause during give up failed:", e);
		}
	}, [currentRound, gameStats.currentScore, clearHardCapTimeout, pause]);

	const handleSearchSelect = useCallback((result: SearchResult) => {
		setSelectedSearchResult(result);
	}, []);

	const startNewGame = useCallback(() => {
		// Reset for new game - CRITICAL FIX: Reset current score and streak
		setGameStats(prev => ({
			...prev,
			currentScore: 0,
			currentStreak: 0,
		}));
		setCurrentRound(null);
		setSelectedSearchResult(null);
		setEndScreenData(null);
		setGameState("waiting");
		setButtonAnimation("");
		setHasStartedGame(false); // Reset game start state
		setDebugInfo("New game started! Click 'Start Round' to begin.");
	}, []);

	const formatTime = (ms: number) => {
		if (ms < 1000) return `${ms}ms`;
		return `${(ms / 1000).toFixed(1)}s`;
	};

	const getLoadingMessage = () => {
		if (loadingProgress.total && loadingProgress.total > 1000) {
			return "This may take a few seconds if you have a lot of liked songs...";
		} else if (loadingProgress.total && loadingProgress.total > 500) {
			return "Loading your music library...";
		}
		return "Loading your liked tracks...";
	};

	const getCurrentLevel = () => {
		return currentRound ? GAME_LEVELS[currentRound.currentLevelIndex] : null;
	};

	const [progressMs, setProgressMs] = useState(0);
	const progressTotalRef = useRef(0);
	const progressStartRef = useRef<number | null>(null);
	const rafRef = useRef<number | null>(null);
	const stopProgress = () => {
		if (rafRef.current) cancelAnimationFrame(rafRef.current);
		rafRef.current = null;
		progressStartRef.current = null;
		setProgressMs(0);
		progressTotalRef.current = 0;
	};
	const tickProgress = () => {
		if (progressStartRef.current === null) return;
		const elapsed = performance.now() - progressStartRef.current;
		setProgressMs(Math.min(elapsed, progressTotalRef.current));
		rafRef.current = requestAnimationFrame(tickProgress);
	};
	const startProgress = (durationMs: number) => {
		stopProgress();
		progressTotalRef.current = durationMs;
		progressStartRef.current = performance.now();
		rafRef.current = requestAnimationFrame(tickProgress);
	};

	// Subscribe to provider snippet events to drive the time bar
	useEffect(() => {
		const handleSnippetStart = (d: number) => {
			console.log("🎵 Snippet start event received:", d, "ms, current gameState:", gameState);
			isPlayingRef.current = true;
			if (gameState !== "playing") {
				console.log("🎵 Setting gameState to playing");
				setGameState("playing");
			}
			startProgress(d);
		};
		
		const handleSnippetEnd = () => {
			console.log("🎵 Snippet end event received, current gameState:", gameState);
			isPlayingRef.current = false;
			// Clamp at end but keep bar rendered until next start
			setProgressMs(progressTotalRef.current);
			setGameState("guessing");
		};
		
		onSnippetStart(handleSnippetStart);
		onSnippetEnd(handleSnippetEnd);
		
		// Cleanup function to remove listeners
		return () => {
			// Note: The provider doesn't have a removeListener method, so we rely on the provider's cleanup
			// This effect should only run once on mount
		};
	}, [onSnippetStart, onSnippetEnd]); // Remove gameState dependency

	return (
		<div className="min-h-screen w-full bg-transparent text-white relative overflow-hidden">
			{/* Background Design Elements - Full Screen Coverage */}
			{/* Left Side - Extended Coverage */}
			<div className="absolute left-0 top-0 w-1/3 h-full">
				<div className="absolute left-4 top-16 w-40 h-40 bg-gradient-to-br from-green-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute left-20 top-48 w-32 h-32 bg-gradient-to-br from-blue-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute left-8 top-80 w-24 h-24 bg-gradient-to-br from-purple-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute left-28 top-[400px] w-20 h-20 bg-gradient-to-br from-yellow-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute left-12 top-[600px] w-36 h-36 bg-gradient-to-br from-green-500/10 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute left-32 top-[700px] w-28 h-28 bg-gradient-to-br from-blue-500/10 to-transparent rounded-full blur-3xl"></div>
			</div>

			{/* Right Side - Extended Coverage */}
			<div className="absolute right-0 top-0 w-1/3 h-full">
				<div className="absolute right-4 top-20 w-36 h-36 bg-gradient-to-bl from-green-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute right-24 top-64 w-28 h-28 bg-gradient-to-bl from-blue-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute right-8 top-[350px] w-32 h-32 bg-gradient-to-bl from-purple-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute right-28 top-[500px] w-24 h-24 bg-gradient-to-bl from-yellow-500/15 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute right-12 top-[650px] w-40 h-40 bg-gradient-to-bl from-green-500/10 to-transparent rounded-full blur-3xl"></div>
				<div className="absolute right-32 top-[750px] w-20 h-20 bg-gradient-to-bl from-blue-500/10 to-transparent rounded-full blur-3xl"></div>
			</div>

			{/* Top Section - Extended Coverage */}
			<div className="absolute top-0 left-0 w-full h-1/3">
				<div className="absolute left-1/4 top-8 w-24 h-24 bg-gradient-to-b from-purple-500/10 to-transparent rounded-full blur-2xl"></div>
				<div className="absolute right-1/4 top-16 w-20 h-20 bg-gradient-to-b from-blue-500/10 to-transparent rounded-full blur-2xl"></div>
				<div className="absolute left-1/3 top-24 w-16 h-16 bg-gradient-to-b from-green-500/10 to-transparent rounded-full blur-2xl"></div>
				<div className="absolute right-1/3 top-32 w-28 h-28 bg-gradient-to-b from-yellow-500/10 to-transparent rounded-full blur-2xl"></div>
			</div>

			{/* Bottom Section - Extended Coverage */}
			<div className="absolute bottom-0 left-0 w-full h-1/3">
				<div className="absolute left-1/4 bottom-16 w-32 h-32 bg-gradient-to-t from-green-500/10 to-transparent rounded-full blur-2xl"></div>
				<div className="absolute right-1/4 bottom-24 w-24 h-24 bg-gradient-to-t from-blue-500/10 to-transparent rounded-full blur-2xl"></div>
				<div className="absolute left-1/3 bottom-32 w-20 h-20 bg-gradient-to-t from-purple-500/10 to-transparent rounded-full blur-2xl"></div>
				<div className="absolute right-1/3 bottom-40 w-36 h-36 bg-gradient-to-t from-yellow-500/10 to-transparent rounded-full blur-2xl"></div>
			</div>

			{/* Center Background Elements */}
			<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
				<div className="w-full max-w-6xl h-full relative">
					{/* Center left */}
					<div className="absolute left-8 top-1/4 w-16 h-16 bg-gradient-to-r from-green-500/5 to-transparent rounded-full blur-xl"></div>
					<div className="absolute left-16 top-3/4 w-12 h-12 bg-gradient-to-r from-blue-500/5 to-transparent rounded-full blur-xl"></div>
					
					{/* Center right */}
					<div className="absolute right-8 top-1/3 w-20 h-20 bg-gradient-to-l from-purple-500/5 to-transparent rounded-full blur-xl"></div>
					<div className="absolute right-16 top-2/3 w-14 h-14 bg-gradient-to-l from-yellow-500/5 to-transparent rounded-full blur-xl"></div>
				</div>
			</div>

			{/* Floating Music Notes - Extended Coverage */}
			<div className="absolute inset-0 pointer-events-none">
				<div className="absolute left-8 top-1/4 text-4xl text-green-500/20 animate-bounce">♪</div>
				<div className="absolute right-12 top-1/3 text-3xl text-blue-500/20 animate-pulse">♫</div>
				<div className="absolute left-1/3 bottom-1/4 text-2xl text-purple-500/20 animate-bounce">♩</div>
				<div className="absolute right-1/4 bottom-1/3 text-3xl text-yellow-500/20 animate-pulse">♪</div>
				<div className="absolute left-1/2 top-1/6 text-2xl text-green-500/15 animate-pulse">♫</div>
				<div className="absolute right-1/2 bottom-1/6 text-3xl text-blue-500/15 animate-bounce">♪</div>
				<div className="absolute left-1/6 top-1/2 text-2xl text-purple-500/15 animate-bounce">♩</div>
				<div className="absolute right-1/6 top-1/2 text-2xl text-yellow-500/15 animate-pulse">♫</div>
			</div>

			{/* Subtle Grid Pattern Overlay */}
			<div className="absolute inset-0 pointer-events-none opacity-5">
				<div className="w-full h-full" style={{
					backgroundImage: `
						linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
						linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
					`,
					backgroundSize: '50px 50px'
				}}></div>
			</div>

			{/* User Profile Header */}
			{userProfile && (
				<div className="fixed top-4 right-4 flex items-center space-x-3 bg-black/70 backdrop-blur-md rounded-full px-4 py-2 z-50 border border-white/20 shadow-2xl">
					<img 
						src={userProfile.images[0]?.url || '/default-avatar.png'} 
						alt="Profile" 
						className="w-8 h-8 rounded-full"
					/>
					<span className="text-white font-medium">{userProfile.display_name}</span>
				</div>
			)}

			{/* Refresh Liked Songs Button - Top Left */}
			<div className="fixed top-4 left-4 z-50">
				<button 
					onClick={() => {
						console.log("🔄 Manual refresh of liked songs requested");
						void loadAll();
					}}
					className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm shadow-lg hover:shadow-blue-500/25 transition-all duration-300 flex items-center space-x-2"
					disabled={loading}
				>
					{loading ? (
						<>
							<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
							<span>Loading...</span>
						</>
					) : (
						<>
							<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							<span>Refresh Songs</span>
						</>
					)}
				</button>
			</div>

			<div className="mx-auto px-6 sm:px-10 lg:px-16 xl:px-24 py-8 w-full relative z-10">
				{/* Game Header */}
				<div className="text-center mb-8">
					<h1 className="text-5xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent mb-4">
						🎵 Guessify
					</h1>
					<p className="text-gray-300 text-lg">Test your music memory with your Spotify likes!</p>
				</div>

				{/* Game Stats HUD */}
				{/* CRITICAL FIX: Dynamic layout based on game state */}
				{!hasStartedGame ? (
					/* When game hasn't started: center the 2 achievement stats */
					<div className="flex justify-center mb-8">
						<div className="grid grid-cols-2 gap-4">
							<div className="bg-gradient-to-r from-purple-500/20 to-purple-600/20 backdrop-blur-sm p-4 rounded-xl border border-purple-500/30">
								<div className="text-2xl font-bold text-purple-400">{gameStats.highScore}</div>
								<div className="text-sm text-purple-300">High Score</div>
							</div>
							<div className="bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 backdrop-blur-sm p-4 rounded-xl border border-yellow-500/30">
								<div className="text-2xl font-bold text-yellow-400">{gameStats.bestStreak}</div>
								<div className="text-sm text-yellow-300">Best Streak</div>
							</div>
						</div>
					</div>
				) : (
					/* When game has started: show all 4 stats in grid */
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
						<div className="bg-gradient-to-r from-green-500/20 to-green-600/20 backdrop-blur-sm p-4 rounded-xl border border-green-500/30">
							<div className="text-3xl font-bold text-green-400">{gameStats.currentScore}</div>
							<div className="text-sm text-green-300">Current Score</div>
						</div>
						<div className="bg-gradient-to-r from-blue-500/20 to-blue-600/20 backdrop-blur-sm p-4 rounded-xl border border-blue-500/30">
							<div className="text-3xl font-bold text-blue-400">{gameStats.currentStreak}</div>
							<div className="text-sm text-blue-300">Current Streak</div>
						</div>
						<div className="bg-gradient-to-r from-purple-500/20 to-purple-600/20 backdrop-blur-sm p-4 rounded-xl border border-purple-500/30">
							<div className="text-2xl font-bold text-purple-400">{gameStats.highScore}</div>
							<div className="text-sm text-purple-300">High Score</div>
						</div>
						<div className="bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 backdrop-blur-sm p-4 rounded-xl border border-yellow-500/30">
							<div className="text-2xl font-bold text-yellow-400">{gameStats.bestStreak}</div>
							<div className="text-sm text-yellow-300">Best Streak</div>
						</div>
					</div>
				)}

				{/* Loading Progress */}
				{loading && (
					<div className="bg-black/50 backdrop-blur-sm p-6 rounded-xl border border-gray-700 mb-8">
						<div className="text-center text-gray-300 mb-4">
							{getLoadingMessage()} {loadingProgress.loaded}/{loadingProgress.total || '?'}
						</div>
						<div className="w-full bg-gray-700 rounded-full h-3">
							<div 
								className="bg-gradient-to-r from-green-400 to-blue-500 h-3 rounded-full transition-all duration-300"
								style={{ width: `${loadingProgress.total ? (loadingProgress.loaded / loadingProgress.total) * 100 : 0}%` }}
							></div>
						</div>
					</div>
				)}

				{/* Game Controls */}
				{gameState === "waiting" && (
					<div className="text-center space-y-6 max-w-2xl mx-auto w-full min-h-[360px]">
						{!currentRound ? (
							<div className="space-y-4">
								<button 
									className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-8 rounded-xl text-xl w-64 h-16 shadow-lg hover:shadow-green-500/25 transition-all duration-300 transform hover:scale-105"
									onClick={startNewRound}
									disabled={loading}
								>
									{loading ? 'Loading...' : 'Start Round'}
								</button>
								
								{/* Show track count and refresh option */}
								<div className="text-sm text-gray-400 space-y-2">
									<div>{tracks.length > 0 ? `${tracks.length} tracks loaded` : 'No tracks available'}</div>
									{tracks.length > 0 && (
										<button 
											onClick={() => {
												void loadAll();
											}}
											className="text-blue-400 hover:text-blue-300 underline text-xs"
										>
											Refresh Track List
										</button>
									)}
								</div>
							</div>
						) : (
							<div className="space-y-4">
								{/* CRITICAL FIX: Show level info above button */}
								<div className="text-lg text-gray-300">
									Level: <span className="text-white font-semibold">{getCurrentLevel()?.name}</span> 
									({formatTime(getCurrentLevel()?.duration || 0)})
								</div>
								{/* CRITICAL FIX: Simplified button text */}
								<button 
									className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-8 rounded-xl text-xl w-64 h-16 shadow-lg hover:shadow-green-500/25 transition-all duration-300 transform hover:scale-105"
									onClick={playCurrentLevel}
									disabled={isPreloading || isPlayingRef.current}
								>
									{isPreloading ? 'Preloading...' : isPlayingRef.current ? 'Playing...' : 'Play'}
								</button>
							</div>
						)}
						<div className="text-gray-400">
							{!currentRound ? "Start a new round with a random song!" : "Ready to play!"}
						</div>
					</div>
				)}

				{/* Progress Bar - Always visible when playing */}
				{isPlayingRef.current && progressTotalRef.current > 0 && (
					<div className="text-center space-y-4 max-w-2xl mx-auto w-full">
						<div className="text-lg text-gray-300">
							🎵 Playing {getCurrentLevel()?.name} Level - {formatTime(getCurrentLevel()?.duration || 0)} clip
						</div>
						<div className="mx-auto max-w-xl">
							<div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
								<div className="h-2 bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${Math.min(100, (progressMs / (progressTotalRef.current || 1)) * 100)}%` }}></div>
							</div>
							<div className="mt-2 text-sm text-gray-300">{((progressTotalRef.current - progressMs) / 1000).toFixed(2)}s remaining</div>
						</div>
					</div>
				)}

				{/* Game State Display - REMOVED - no more separate playing screen */}
				{/* The buttons below will always be visible */}

				{/* Guess Input */}
				{gameState === "guessing" && currentRound && (
					<div className="space-y-6">
						<div className="text-center">
							<div className="text-2xl font-semibold text-white mb-1">🎯 What song was that?</div>
							<div className="text-lg text-gray-300 mb-2">
								{getCurrentLevel()?.name} Level - {formatTime(getCurrentLevel()?.duration || 0)} clip
							</div>
							{progressTotalRef.current > 0 && (
								<div className="mx-auto max-w-xl">
									<div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
										<div className="h-2 bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${Math.min(100, (progressMs / (progressTotalRef.current || 1)) * 100)}%` }}></div>
									</div>
									<div className="mt-2 text-sm text-gray-300">{((progressTotalRef.current - progressMs) / 1000).toFixed(2)}s remaining</div>
								</div>
							)}
						</div>
						
						<div className="space-y-4">
							<SearchAutocomplete
								onSelect={handleSearchSelect}
								placeholder="Search for a song..."
								className="w-full"
							/>
							
							{selectedSearchResult && (
								<div className="bg-green-500/20 backdrop-blur-sm p-4 rounded-xl border border-green-500/30">
									<div className="text-sm text-green-300">
										<strong>Selected:</strong> "{selectedSearchResult.name}" by {selectedSearchResult.artist}
									</div>
								</div>
							)}
							
							<div className="grid grid-cols-2 gap-3">
								<button
									onClick={submitGuess}
									disabled={!selectedSearchResult}
									className={`bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white px-6 py-3 rounded-xl font-semibold h-14 w-full shadow-lg hover:shadow-blue-500/25 transition-all duration-300 transform hover:scale-105 ${buttonAnimation === "correct" ? "animate-pulse bg-green-500" : ""} ${buttonAnimation === "incorrect" ? "animate-pulse bg-red-500" : ""}`}
								>
									Submit Guess
								</button>
								<button
									onClick={() => {
										const lvl = getCurrentLevel();
										if (lvl) {
											// Pass level to override any playing guard and replay same duration
											void (async () => {
												await playCurrentLevelWithLevel(lvl);
											})();
										}
									}}
									className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-6 py-3 rounded-xl font-semibold h-14 w-full shadow-lg hover:shadow-green-500/25 transition-all duration-300 transform hover:scale-105"
								>
									🔁 Replay
								</button>
								<button
									onClick={nextLevel}
									disabled={currentRound.currentLevelIndex >= GAME_LEVELS.length - 1}
									className="bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 disabled:from-gray-600 disabled:to-gray-700 text-white px-6 py-3 rounded-xl font-semibold h-14 w-full shadow-lg hover:shadow-orange-500/25 transition-all duration-300 transform hover:scale-105"
								>
									⏰ More Time
								</button>
								<button
									onClick={giveUp}
									className="bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white px-6 py-3 rounded-xl font-semibold h-14 w-full shadow-lg hover:shadow-red-500/25 transition-all duration-300 transform hover:scale-105"
								>
									🏳️ Give Up
								</button>
							</div>
						</div>
						
						<div className="text-center text-gray-400">
							Attempts: {currentRound.attempts + 1} | Level: {getCurrentLevel()?.name} ({formatTime(getCurrentLevel()?.duration || 0)})
						</div>
					</div>
				)}

				{/* End Screen */}
				{gameState === "gameOver" && endScreenData && (
					<div className="text-center space-y-6">
						<div className="text-4xl font-bold text-purple-400">🏁 Round Complete!</div>
						
						<div className="bg-black/50 backdrop-blur-sm p-6 rounded-xl border border-gray-700">
							<div className="text-2xl text-white mb-4">
								{endScreenData.wasCorrect ? "🎉 Correct!" : "❌ Game Over"}
							</div>
							
							{/* CRITICAL FIX: Enhanced artist display with profile picture and cool UI */}
							<div className="flex flex-col items-center justify-center space-y-4 mb-6">
								{/* Artist Profile Picture - Large and centered */}
								<div className="relative">
									{/* Glowing background effect */}
									<div className="absolute inset-0 bg-gradient-to-r from-green-500/30 to-blue-500/30 rounded-full blur-xl scale-150"></div>
									
									{/* CRITICAL FIX: Handle missing album images properly with debugging */}
									{(() => {
										// Debug logging for artist picture loading
										const track = endScreenData.track;
										const albumImages = track.album?.images;
										const firstImageUrl = albumImages?.[0]?.url;
										const artistName = track.artist;
										
										console.log("🎨 Artist Picture Debug:", {
											trackName: track.name,
											artistName: artistName,
											hasAlbum: !!track.album,
											albumImages: albumImages,
											firstImageUrl: firstImageUrl,
											imageCount: albumImages?.length || 0,
											fetchedImage: fetchedArtistImages[artistName]
										});
										
										// Try album image first, then fetched artist image, then fallback
										if (firstImageUrl) {
											return (
												<img 
													src={firstImageUrl} 
													alt="Artist/Album Art"
													className="relative w-24 h-24 rounded-full ring-4 ring-white/20 shadow-2xl transform transition-all duration-500 hover:scale-110 object-cover"
													onLoad={() => {
														console.log("✅ Album image loaded successfully:", firstImageUrl);
														setAudioDebug("Album image loaded successfully!");
													}}
													onError={(e) => {
														console.error("❌ Album image failed to load:", firstImageUrl, e);
														setAudioDebug("Album image failed, trying artist image...");
														// Try to fetch artist image as fallback
														void fetchArtistImage(track);
													}}
												/>
											);
										} else if (fetchedArtistImages[artistName]) {
											// Use fetched artist image
											return (
												<img 
													src={fetchedArtistImages[artistName]} 
													alt="Artist Image"
													className="relative w-24 h-24 rounded-full ring-4 ring-white/20 shadow-2xl transform transition-all duration-500 hover:scale-110 object-cover"
													onLoad={() => {
														console.log("✅ Fetched artist image loaded successfully:", fetchedArtistImages[artistName]);
														setAudioDebug("Artist image loaded successfully!");
													}}
													onError={(e) => {
														console.error("❌ Fetched artist image failed to load:", fetchedArtistImages[artistName], e);
														setAudioDebug("Artist image failed, showing fallback");
													}}
												/>
											);
										} else {
											// No images available - try to fetch artist image
											console.log("⚠️ No album images available for track:", track.name);
											console.log("🎨 Attempting to fetch artist image for:", artistName);
											
											// Fetch artist image in background
											fetchArtistImage(track).then(imageUrl => {
												if (imageUrl) {
													setFetchedArtistImages(prev => ({
														...prev,
														[artistName]: imageUrl
													}));
													console.log("✅ Artist image fetched and stored:", imageUrl);
												}
											});
											
											return null;
										}
									})()}
									
									{/* Fallback for tracks without album images or failed loads */}
									<div className="relative w-24 h-24 rounded-full ring-4 ring-white/20 shadow-2xl bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center" style={{ 
										display: (endScreenData.track.album?.images?.[0]?.url || fetchedArtistImages[endScreenData.track.artist]) ? 'none' : 'flex' 
									}}>
										<span className="text-white text-4xl">🎵</span>
									</div>
									
									{/* Success checkmark overlay for correct guesses */}
									{endScreenData.wasCorrect && (
										<div className="absolute -top-2 -right-2 w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shadow-lg animate-pulse">
											<span className="text-white text-lg">✓</span>
										</div>
									)}
								</div>
								
								{/* Track and Artist Info */}
								<div className="text-center">
									<div className="text-xl font-bold text-white mb-2">
										"{endScreenData.track.name}"
									</div>
									<div className="text-lg text-gray-300">
										by <span className="text-blue-400 font-semibold">{endScreenData.track.artist}</span>
									</div>
								</div>
							</div>
							
							{/* Score Display */}
							<div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 backdrop-blur-sm p-4 rounded-xl border border-green-500/30">
								<div className="text-gray-300 text-lg">
									{/* CRITICAL FIX: Say "Current" for correct guesses, "Final" for game over */}
									{endScreenData.wasCorrect ? (
										<>Current Score: <span className="text-white font-bold text-xl">{endScreenData.finalScore}</span> | Current Streak: <span className="text-white font-bold text-xl">{endScreenData.finalStreak}</span></>
									) : (
										<>Final Score: <span className="text-white font-bold text-xl">{endScreenData.finalScore}</span> | Final Streak: <span className="text-white font-bold text-xl">{endScreenData.finalStreak}</span></>
									)}
								</div>
							</div>
						</div>
						
						<div className="flex gap-4 justify-center">
							{/* CRITICAL FIX: Only show New Game for incorrect guesses, Next Round for correct */}
							{!endScreenData.wasCorrect ? (
								<button
									onClick={startNewGame}
									className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-8 py-3 rounded-xl font-semibold w-40 h-14 shadow-lg hover:shadow-green-500/25 transition-all duration-300 transform hover:scale-105"
								>
									New Game
								</button>
							) : (
								<button
									onClick={startNewRound}
									className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-8 py-3 rounded-xl font-semibold w-40 h-14 shadow-lg hover:shadow-blue-500/25 transition-all duration-300 transform hover:scale-105"
								>
									Next Round
								</button>
							)}
						</div>
					</div>
				)}

				{/* Debug Info - Only show non-spoiler info */}
				{debugInfo && (
					<div className="text-sm text-gray-400 bg-black/30 backdrop-blur-sm p-4 rounded-xl border border-gray-700 mt-8">
						{debugInfo}
					</div>
				)}
				
				{audioDebug && (
					<></>
				)}
				
				{/* Time Bar */}
				{(gameState === 'playing' || gameState === 'guessing') && currentRound && progressTotalRef.current > 0 && (
					<div className="mb-6">
						<div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
							<div
								className="h-2 bg-gradient-to-r from-emerald-400 to-sky-400"
								style={{ width: `${Math.min(100, (progressMs / (progressTotalRef.current || 1)) * 100)}%` }}
							></div>
						</div>
						<div className="mt-2 text-sm text-gray-300">
							{((progressTotalRef.current - progressMs) / 1000).toFixed(2)}s remaining
						</div>
					</div>
				)}
				
				<div className="text-xs text-gray-500 text-center mt-8">
					Developed by Christopher Castaneda
				</div>
			</div>
		</div>
	);
}



