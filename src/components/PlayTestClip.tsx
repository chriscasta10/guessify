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
	{ name: "Extreme", duration: 800, points: 1000 },   // 0.8s - more reasonable
	{ name: "Hard", duration: 1500, points: 500 },      // 1.5s
	{ name: "Medium", duration: 3000, points: 250 },    // 3.0s
	{ name: "Easy", duration: 5000, points: 125 },      // 5.0s
	{ name: "Chill", duration: 8000, points: 60 },      // 8.0s
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
	const { initPlayer, connect, play, pause, seek, isSdkAvailable, startPlaybackTimeout, clearPlaybackTimeout, onStateChange } = usePlayer();
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
	const fetchArtistImage = useCallback(async (track: any) => {
		try {
			// Get artist ID from track object (this is the correct way)
			const artistId = track.artists?.[0]?.id;
			const artistName = track.artists?.[0]?.name || track.artist;
			
			if (artistId) {
				// Use artist ID if available (preferred method)
				console.log("🎨 Fetching artist image by ID for:", artistName, "ID:", artistId);
				
				const response = await fetch(`/api/artists/${artistId}`);
				if (response.ok) {
					const artistData = await response.json();
					const artistImages = artistData.images;
					
					if (artistImages && artistImages.length > 0) {
						const imageUrl = artistImages[0].url;
						console.log("✅ Found artist image by ID:", imageUrl);
						return imageUrl;
					} else {
						console.log("⚠️ Artist has no images:", artistName);
						return null;
					}
				} else {
					console.error("❌ Failed to fetch artist data by ID:", response.status, response.statusText);
					// Fall through to search method
				}
			}
			
			// Fallback: Search for artist by name when ID is not available
			console.log("🎨 Falling back to artist search for:", artistName);
			
			const searchResponse = await fetch(`/api/spotify-search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`);
			if (searchResponse.ok) {
				const data = await searchResponse.json();
				const artists = data.artists?.items;
				
				if (artists && artists.length > 0 && artists[0].images && artists[0].images.length > 0) {
					const imageUrl = artists[0].images[0].url;
					console.log("✅ Found artist image by search:", imageUrl);
					return imageUrl;
				} else {
					console.log("⚠️ No artist images found by search for:", artistName);
					return null;
				}
			} else {
				console.error("❌ Failed to search for artist:", searchResponse.status, searchResponse.statusText);
				return null;
			}
		} catch (error) {
			console.error("❌ Error fetching artist image:", error);
			return null;
		}
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
				startPlaybackTimeout(currentLevelRef.current.duration, () => {
					console.log("🚨 SDK TIMEOUT TRIGGERED - STOPPING AUDIO");
					isPlayingRef.current = false;
					setGameState("guessing");
					setAudioDebug("🚨 SDK TIMEOUT: Time's up - time to guess!");
					
					// Force stop SDK playback
					try {
						pause();
					} catch (e) {
						console.log("SDK pause failed during timeout, but that's okay:", e);
					}
				});
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
	}, [onStateChange, startPlaybackTimeout, pause]);

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
			clearPlaybackTimeout();
		};
	}, [clearPlaybackTimeout]);

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
		clearPlaybackTimeout();
		isPlayingRef.current = false;
		hasPlayedRef.current = false;
		currentSnippetPositionRef.current = 0; // Reset snippet position

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
	}, [tracks, loading, error, loadAll, clearPlaybackTimeout, hasStartedGame, preloadAudio]);

	const playCurrentLevel = useCallback(async () => {
		if (!currentRound) return;

		// Prevent multiple simultaneous plays
		if (isPlayingRef.current) {
			console.log("Already playing, ignoring play request");
			return;
		}

		const currentLevel = GAME_LEVELS[currentRound.currentLevelIndex];
		const track = currentRound.track;
		
		// CRITICAL FIX: Use stored snippet position for replay, or generate new one
		let snippetPosition: number;
		if (hasPlayedRef.current && currentSnippetPositionRef.current > 0) {
			// Replay: use the same snippet position
			snippetPosition = currentSnippetPositionRef.current;
			console.log("Replaying same snippet at position:", snippetPosition);
		} else {
			// First play: generate new random position
			snippetPosition = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (currentLevel.duration + 3000))));
			currentSnippetPositionRef.current = snippetPosition; // Store for replay
			console.log("New snippet position:", snippetPosition);
		}

		// CRITICAL FIX: Don't change game state for replay - stay in guessing mode
		if (gameState === "guessing") {
			// This is a replay - just show playing message, don't change state
			setDebugInfo(`Playing ${currentLevel.name} level clip...`);
			setAudioDebug(`Replaying ${formatTime(currentLevel.duration)} snippet (${currentLevel.name} level)...`);
		} else {
			// This is first play - change to playing state
			setDebugInfo(`Playing ${currentLevel.name} level clip...`);
			setGameState("playing");
			setAudioDebug(`Starting ${formatTime(currentLevel.duration)} snippet (${currentLevel.name} level)...`);
		}
		
		isPlayingRef.current = true;
		hasPlayedRef.current = true;
		currentLevelRef.current = currentLevel; // Set current level for timeout listener

		try {
			// Always try Spotify SDK first (works for all tracks)
			if (isSdkAvailable) {
				console.log("Using Spotify SDK");
				
				// CRITICAL FIX: Only connect if we haven't already
				let connected = false;
				if (hasPlayedRef.current && currentSnippetPositionRef.current > 0) {
					// Replay: try to use existing connection
					console.log("Replay detected - attempting to use existing connection");
					try {
						// Try to seek and play directly without reconnecting
						await seek(snippetPosition);
						setAudioDebug("Seek successful with existing connection, now playing...");
						await play(track.uri, snippetPosition);
						
						setAudioDebug(`SDK replay initiated, waiting for playback to start...`);
						console.log(`SDK replay initiated, waiting for player_state_changed event`);
						return; // Success - PlayerProvider will handle the timeout
					} catch (replayError) {
						console.log("Replay with existing connection failed, will reconnect:", replayError);
						// Fall through to normal connection flow
					}
				}
				
				// First play or replay failed: establish new connection
				setAudioDebug("Connecting to Spotify SDK...");
				
				setAudioDebug("Step 1: Checking SDK availability...");
				console.log("SDK available:", isSdkAvailable);
				console.log("Window.Spotify exists:", typeof window !== 'undefined' && !!window.Spotify);
				
				setAudioDebug("Step 2: Attempting to connect...");
				connected = await connect();
				console.log("SDK connection result:", connected);
				
				if (!connected) {
					setDebugInfo("Failed to connect to Spotify SDK, trying preview URL fallback");
					setAudioDebug("SDK connection failed, falling back to preview");
				} else {
					setAudioDebug("SDK connected successfully! Waiting for device ID to be fully ready...");
					console.log("SDK connected, waiting for device ID to be fully ready...");
					
					// CRITICAL FIX: Wait for device ID to be fully available and stable
					// This should eliminate the double-click requirement
					let deviceIdReady = false;
					let attempts = 0;
					const maxAttempts = 20; // Wait up to 10 seconds
					
					while (!deviceIdReady && attempts < maxAttempts) {
						await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between checks
						attempts++;
						
						// Check if device ID is available in PlayerProvider
						try {
							// Try to get a simple response to check if device ID is ready
							const response = await fetch('/api/player/play', {
								method: 'PUT',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ uri: track.uri, position_ms: snippetPosition })
							});
							
							if (response.ok) {
								deviceIdReady = true;
								console.log(`Device ID ready after ${attempts * 500}ms`);
								setAudioDebug(`Device ID ready after ${attempts * 500}ms`);
							}
						} catch (e) {
							console.log(`Device ID check attempt ${attempts}:`, e);
						}
					}
					
					if (!deviceIdReady) {
						console.error("Device ID never became ready, falling back to preview URL");
						setAudioDebug("Device ID timeout, falling back to preview URL");
						// Fall through to preview URL
					} else {
						try {
							await seek(snippetPosition);
							setAudioDebug("Seek successful, now playing...");
							await play(track.uri, snippetPosition);
							
							setAudioDebug(`SDK play() called, waiting for playback to actually start...`);
							console.log(`SDK playback initiated, waiting for player_state_changed event`);
							
							// CRITICAL FIX: Don't set timeout immediately - wait for playback to actually start
							// The SDK will fire player_state_changed when playback begins
							// We'll handle the timeout in the PlayerProvider's event listener
							
							return; // Success - PlayerProvider will handle the timeout
						} catch (playError) {
							console.error("Error during SDK playback:", playError);
							setAudioDebug("SDK playback error: " + (playError instanceof Error ? playError.message : 'Unknown'));
							// Fall through to preview URL
						}
					}
				}
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
					startPlaybackTimeout(currentLevel.duration, () => {
						console.log("🚨 PREVIEW TIMEOUT TRIGGERED - STOPPING AUDIO");
						isPlayingRef.current = false;
						
						// CRITICAL FIX: Return to guessing state after timeout
						setGameState("guessing");
						setAudioDebug("🚨 PREVIEW TIMEOUT: Time's up - time to guess!");
						
						// Force stop preview audio
						if (audioRef.current) {
							audioRef.current.pause();
							audioRef.current.currentTime = 0;
						}
					});
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
	}, [currentRound, connect, isSdkAvailable, pause, play, seek, startPlaybackTimeout, preloadAudio, gameState]);

	const nextLevel = useCallback(() => {
		if (!currentRound) return;
		
		// Move to next level (longer clip)
		if (currentRound.currentLevelIndex < GAME_LEVELS.length - 1) {
			setCurrentRound(prev => prev ? {
				...prev,
				currentLevelIndex: prev.currentLevelIndex + 1,
				attempts: prev.attempts + 1,
			} : null);
			
			const nextLevel = GAME_LEVELS[currentRound.currentLevelIndex + 1];
			setDebugInfo(`Level increased to ${nextLevel.name} (${formatTime(nextLevel.duration)})`);
			
			// CRITICAL FIX: Reset snippet position for new level and auto-play immediately
			currentSnippetPositionRef.current = 0; // Reset for new level
			hasPlayedRef.current = false; // Reset play state
			
			// Auto-play the new level after a short delay
			setTimeout(() => {
				void playCurrentLevel();
			}, 300);
		}
	}, [currentRound, playCurrentLevel]);

	const submitGuess = useCallback(() => {
		if (!currentRound || !selectedSearchResult) return;

		// Check if guess is correct
		const isCorrect = selectedSearchResult.id === currentRound.track.id;

		if (isCorrect) {
			// Award points for current level
			const currentLevel = GAME_LEVELS[currentRound.currentLevelIndex];
			const pointsEarned = currentLevel.points;
			
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
			
			// End round and show end screen
			setEndScreenData({
				finalScore: gameStats.currentScore + pointsEarned,
				finalStreak: gameStats.currentStreak + 1,
				track: currentRound.track,
				wasCorrect: true,
			});
			setGameState("gameOver");
		} else {
			// Wrong guess - end run immediately
			setButtonAnimation("incorrect");
			setEndScreenData({
				finalScore: gameStats.currentScore,
				finalStreak: gameStats.currentStreak,
				track: currentRound.track,
				wasCorrect: false,
			});
			setGameState("gameOver");
		}
	}, [currentRound, selectedSearchResult, gameStats.currentScore, gameStats.currentStreak]);

	const giveUp = useCallback(() => {
		if (!currentRound) return;
		
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
		setGameState("gameOver");
	}, [currentRound, gameStats.currentScore]);

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

	return (
		<div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white relative overflow-hidden">
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
						alt={userProfile.display_name}
						className="w-8 h-8 rounded-full ring-2 ring-white/30"
					/>
					<span className="text-sm font-medium text-white">{userProfile.display_name}</span>
				</div>
			)}

			<div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
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
					<div className="text-center space-y-6">
						{!currentRound ? (
							<button 
								className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-4 px-8 rounded-xl text-xl w-64 h-16 shadow-lg hover:shadow-green-500/25 transition-all duration-300 transform hover:scale-105"
								onClick={startNewRound}
								disabled={loading}
							>
								{loading ? 'Loading...' : 'Start Round'}
							</button>
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
									disabled={isPreloading}
								>
									{isPreloading ? 'Preloading...' : 'Play'}
								</button>
							</div>
						)}
						<div className="text-gray-400">
							{!currentRound ? "Start a new round with a random song!" : "Ready to play!"}
						</div>
					</div>
				)}

				{/* Game State Display */}
				{gameState === "playing" && currentRound && (
					<div className="text-center space-y-6">
						<div className="text-2xl font-semibold text-white mb-4">🎵 Playing...</div>
						<div className="text-lg text-gray-300">
							{getCurrentLevel()?.name} Level - {formatTime(getCurrentLevel()?.duration || 0)} clip
						</div>
						<button
							onClick={() => {
								console.log("Manual stop button clicked");
								if (isPlayingRef.current) {
									clearPlaybackTimeout();
									isPlayingRef.current = false;
									setGameState("guessing");
									setAudioDebug("Manual stop - time to guess!");
									
									// Force stop audio
									if (audioRef.current) {
										audioRef.current.pause();
										audioRef.current.currentTime = 0;
									}
									try {
										pause();
									} catch (e) {
										console.log("Manual SDK pause failed:", e);
									}
								}
							}}
							className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl font-semibold w-40 h-14 shadow-lg hover:shadow-red-500/25 transition-all duration-300"
						>
							🛑 Force Stop
						</button>
					</div>
				)}

				{/* Guess Input */}
				{gameState === "guessing" && currentRound && (
					<div className="space-y-6">
						<div className="text-center">
							<div className="text-2xl font-semibold text-white mb-4">🎯 What song was that?</div>
							<div className="text-lg text-gray-300">
								{getCurrentLevel()?.name} Level - {formatTime(getCurrentLevel()?.duration || 0)} clip
							</div>
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
									onClick={playCurrentLevel}
									className="bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800 text-white px-6 py-3 rounded-xl font-semibold h-14 w-full shadow-lg hover:shadow-gray-500/25 transition-all duration-300 transform hover:scale-105"
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
							
							{/* Debug Info for Artist Picture */}
							<div className="mt-4 p-3 bg-gray-800/50 rounded-lg text-left">
								<div className="text-xs text-gray-400 mb-2">🎨 Artist Picture Debug:</div>
								<div className="text-xs text-gray-300 space-y-1">
									<div>Track: {endScreenData.track.name}</div>
									<div>Artist: {endScreenData.track.artist}</div>
									<div>Artist ID: {endScreenData.track.artists?.[0]?.id || 'Missing'}</div>
									<div>Has Album: {endScreenData.track.album ? 'Yes' : 'No'}</div>
									<div>Album Images: {endScreenData.track.album?.images?.length || 0}</div>
									<div>First Image URL: {endScreenData.track.album?.images?.[0]?.url ? 'Available' : 'Missing'}</div>
									<div>Fetched Artist Image: {fetchedArtistImages[endScreenData.track.artist] ? 'Available' : 'Missing'}</div>
									<div>Image Source: {endScreenData.track.album?.images?.[0]?.url ? 'Album' : fetchedArtistImages[endScreenData.track.artist] ? 'Artist API' : 'Fallback'}</div>
									<div>Track Object Keys: {Object.keys(endScreenData.track).join(', ')}</div>
									<div>Track Structure: {JSON.stringify(endScreenData.track, null, 2).substring(0, 200)}...</div>
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
					<div className="text-sm text-blue-400 bg-blue-500/10 backdrop-blur-sm p-4 rounded-xl border border-blue-500/30 mt-4">
						Audio Debug: {audioDebug}
					</div>
				)}
				
				<div className="text-xs text-gray-500 text-center mt-8">
					Debug: {tracks.length} tracks, SDK: {isSdkAvailable ? 'Yes' : 'No'}, Loading: {loading ? 'Yes' : 'No'}
					{error && `, Error: ${error}`}
				</div>
			</div>
		</div>
	);
}



