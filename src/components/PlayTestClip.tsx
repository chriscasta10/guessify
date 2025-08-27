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
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const isPlayingRef = useRef(false);
	const hasPlayedRef = useRef(false);
	const currentLevelRef = useRef<GameLevel | null>(null);
	// CRITICAL FIX: Store the exact snippet position for replay
	const currentSnippetPositionRef = useRef<number>(0);

	useEffect(() => {
		console.log("PlayTestClip: useEffect triggered");
		void initPlayer();
		// Load user profile
		void loadUserProfile();
	}, [initPlayer]);

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
	}, [tracks, loading, error, loadAll, clearPlaybackTimeout]);

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

		setDebugInfo(`Playing ${currentLevel.name} level clip...`);
		setGameState("playing");
		setAudioDebug(`Starting ${formatTime(currentLevel.duration)} snippet (${currentLevel.name} level)...`);
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
					setAudioDebug("SDK connected successfully! Seeking and playing...");
					console.log("SDK connected, attempting to seek and play");
					
					try {
						// CRITICAL FIX: Add longer delay to ensure device ID is fully available
						await new Promise(resolve => setTimeout(resolve, 500));
						
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

			// Fallback to preview URL if SDK failed or not available
			if (track.previewUrl) {
				console.log("Using preview URL fallback");
				setAudioDebug("Using preview URL: " + track.previewUrl);
				
				if (!audioRef.current) {
					audioRef.current = new Audio(track.previewUrl);
					console.log("Created new Audio element");
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
					setAudioDebug("Attempting to play preview audio...");
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
	}, [currentRound, connect, isSdkAvailable, pause, play, seek, startPlaybackTimeout]);

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
		<div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white">
			{/* User Profile Header */}
			{userProfile && (
				<div className="absolute top-4 right-4 flex items-center space-x-3 bg-black/50 backdrop-blur-sm rounded-full px-4 py-2">
					<img 
						src={userProfile.images[0]?.url || '/default-avatar.png'} 
						alt={userProfile.display_name}
						className="w-8 h-8 rounded-full"
					/>
					<span className="text-sm font-medium text-white">{userProfile.display_name}</span>
				</div>
			)}

			<div className="container mx-auto px-4 py-8 max-w-4xl">
				{/* Game Header */}
				<div className="text-center mb-8">
					<h1 className="text-5xl font-bold bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent mb-4">
						🎵 Guessify
					</h1>
					<p className="text-gray-300 text-lg">Test your music memory with your Spotify likes!</p>
				</div>

				{/* Game Stats HUD */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
					{/* CRITICAL FIX: Only show current score/streak after game has started */}
					{hasStartedGame && (
						<>
							<div className="bg-gradient-to-r from-green-500/20 to-green-600/20 backdrop-blur-sm p-4 rounded-xl border border-green-500/30">
								<div className="text-3xl font-bold text-green-400">{gameStats.currentScore}</div>
								<div className="text-sm text-green-300">Current Score</div>
							</div>
							<div className="bg-gradient-to-r from-blue-500/20 to-blue-600/20 backdrop-blur-sm p-4 rounded-xl border border-blue-500/30">
								<div className="text-3xl font-bold text-blue-400">{gameStats.currentStreak}</div>
								<div className="text-sm text-blue-300">Current Streak</div>
							</div>
						</>
					)}
					<div className="bg-gradient-to-r from-purple-500/20 to-purple-600/20 backdrop-blur-sm p-4 rounded-xl border border-purple-500/30">
						<div className="text-2xl font-bold text-purple-400">{gameStats.highScore}</div>
						<div className="text-sm text-purple-300">High Score</div>
					</div>
					<div className="bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 backdrop-blur-sm p-4 rounded-xl border border-yellow-500/30">
						<div className="text-2xl font-bold text-yellow-400">{gameStats.bestStreak}</div>
						<div className="text-sm text-yellow-300">Best Streak</div>
					</div>
				</div>

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
								>
									Play
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
							
							{/* Artist Image and Track Info */}
							<div className="flex items-center justify-center space-x-4 mb-4">
								{endScreenData.track.album?.images?.[0]?.url && (
									<img 
										src={endScreenData.track.album.images[0].url} 
										alt="Album Art"
										className="w-16 h-16 rounded-lg shadow-lg"
									/>
								)}
								<div className="text-left">
									<div className="text-lg font-semibold text-white">
										"{endScreenData.track.name}"
									</div>
									<div className="text-gray-300">
										by {endScreenData.track.artist}
									</div>
								</div>
							</div>
							
							<div className="text-gray-300">
								Final Score: <span className="text-white font-semibold">{endScreenData.finalScore}</span> | 
								Final Streak: <span className="text-white font-semibold">{endScreenData.finalStreak}</span>
							</div>
						</div>
						
						<div className="flex gap-4 justify-center">
							{/* CRITICAL FIX: Only show New Game for incorrect guesses, Next Round for correct */}
							{!endScreenData.wasCorrect && (
								<button
									onClick={startNewGame}
									className="bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white px-8 py-3 rounded-xl font-semibold w-40 h-14 shadow-lg hover:shadow-green-500/25 transition-all duration-300 transform hover:scale-105"
								>
									New Game
								</button>
							)}
							<button
								onClick={startNewRound}
								className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-semibold w-40 h-14 shadow-lg hover:shadow-blue-500/25 transition-all duration-300 transform hover:scale-105"
							>
								{endScreenData.wasCorrect ? "Next Round" : "Try Again"}
							</button>
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



