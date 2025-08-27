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

export function GuessifyGame() {
	const { initPlayer, connect, play, pause, seek, isSdkAvailable } = usePlayer();
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
	const [debugInfo, setDebugInfo] = useState<string>("");
	const [audioDebug, setAudioDebug] = useState<string>("");
	const [endScreenData, setEndScreenData] = useState<{
		finalScore: number;
		finalStreak: number;
		track: any;
		wasCorrect: boolean;
	} | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isPlayingRef = useRef(false);
	const hasPlayedRef = useRef(false);

	useEffect(() => {
		console.log("PlayTestClip: useEffect triggered");
		void initPlayer();
	}, [initPlayer]);

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
			if (playbackTimeoutRef.current) {
				clearTimeout(playbackTimeoutRef.current);
			}
		};
	}, []);

	const startNewRound = useCallback(async () => {
		console.log("PlayTestClip: startNewRound called", { 
			tracksLength: tracks.length, 
			isSdkAvailable, 
			loading,
			error 
		});

		// Clear any existing timeout and reset state
		if (playbackTimeoutRef.current) {
			clearTimeout(playbackTimeoutRef.current);
		}
		isPlayingRef.current = false;
		hasPlayedRef.current = false;

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
		setDebugInfo("New round started! Click 'Play' to begin.");
	}, [tracks, loading, error, loadAll]);

	const playCurrentLevel = useCallback(async () => {
		if (!currentRound) return;

		// Prevent multiple simultaneous plays
		if (isPlayingRef.current) {
			console.log("Already playing, ignoring play request");
			return;
		}

		// Clear any existing timeout
		if (playbackTimeoutRef.current) {
			clearTimeout(playbackTimeoutRef.current);
		}

		const currentLevel = GAME_LEVELS[currentRound.currentLevelIndex];
		const track = currentRound.track;
		const randomStart = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (currentLevel.duration + 3000))));

		setDebugInfo(`Playing ${currentLevel.name} level clip...`);
		setGameState("playing");
		setAudioDebug(`Playing ${formatTime(currentLevel.duration)} snippet (${currentLevel.name} level)...`);
		isPlayingRef.current = true;
		hasPlayedRef.current = true;

		// CRITICAL FIX: Set a guaranteed timeout to stop playback
		console.log(`Setting timeout for ${currentLevel.duration}ms`);
		playbackTimeoutRef.current = setTimeout(async () => {
			console.log("🚨 TIMEOUT TRIGGERED - FORCING AUDIO STOP");
			isPlayingRef.current = false;
			setGameState("guessing");
			setAudioDebug("🚨 TIMEOUT: Time's up - time to guess!");
			
			// Force stop any playing audio - MULTIPLE METHODS
			try {
				// Method 1: Stop preview audio if playing
				if (audioRef.current) {
					console.log("Stopping preview audio");
					audioRef.current.pause();
					audioRef.current.currentTime = 0;
				}
				
				// Method 2: Try to pause via SDK
				console.log("Attempting SDK pause");
				await pause();
				console.log("SDK pause successful");
			} catch (e) {
				console.log("SDK pause failed during timeout, but that's okay:", e);
			}
			
			// Method 3: Force state change regardless
			console.log("Forcing game state to guessing");
			setGameState("guessing");
		}, currentLevel.duration);

		try {
			// Always try Spotify SDK first (works for all tracks)
			if (isSdkAvailable) {
				console.log("Using Spotify SDK");
				setAudioDebug("Connecting to Spotify SDK...");
				
				setAudioDebug("Step 1: Checking SDK availability...");
				console.log("SDK available:", isSdkAvailable);
				console.log("Window.Spotify exists:", typeof window !== 'undefined' && !!window.Spotify);
				
				setAudioDebug("Step 2: Attempting to connect...");
				const connected = await connect();
				console.log("SDK connection result:", connected);
				
				if (!connected) {
					setDebugInfo("Failed to connect to Spotify SDK, trying preview URL fallback");
					setAudioDebug("SDK connection failed, falling back to preview");
				} else {
					setAudioDebug("SDK connected successfully! Seeking and playing...");
					console.log("SDK connected, attempting to seek and play");
					
					try {
						await seek(randomStart);
						setAudioDebug("Seek successful, now playing...");
						await play(track.uri, randomStart);
						
						setAudioDebug(`Playing via SDK, will stop in ${formatTime(currentLevel.duration)}`);
						console.log(`SDK playback started, timeout set for ${currentLevel.duration}ms`);
						console.log("⏰ TIMEOUT ACTIVE - Audio should stop automatically");
						return; // Success - timeout will handle stopping
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
				audioRef.current.currentTime = randomStart / 1000;
				audioRef.current.volume = 0.8;
				
				// Add event listeners for debugging
				audioRef.current.onloadstart = () => setAudioDebug("Audio loading started");
				audioRef.current.oncanplay = () => setAudioDebug("Audio can play");
				audioRef.current.onplay = () => setAudioDebug("Audio play event fired");
				audioRef.current.onended = () => setAudioDebug("Audio ended");
				audioRef.current.onerror = (e) => setAudioDebug("Audio error: " + e);
				
				// Play the audio
				try {
					setAudioDebug("Attempting to play audio...");
					await audioRef.current.play();
					console.log("Audio started playing");
					setAudioDebug(`Audio play() succeeded, will stop in ${formatTime(currentLevel.duration)}`);
					console.log(`Preview playback started, timeout set for ${currentLevel.duration}ms`);
					console.log("⏰ TIMEOUT ACTIVE - Audio should stop automatically");
					return; // Success - timeout will handle stopping
				} catch (playError) {
					console.error("Error playing audio:", playError);
					setDebugInfo(`Audio playback error: ${playError instanceof Error ? playError.message : 'Unknown error'}`);
					setAudioDebug("Play error: " + (playError instanceof Error ? playError.message : 'Unknown'));
					setGameState("waiting");
					isPlayingRef.current = false;
					
					// Clear timeout since we failed
					if (playbackTimeoutRef.current) {
						clearTimeout(playbackTimeoutRef.current);
						playbackTimeoutRef.current = null;
					}
				}
			} else {
				setDebugInfo("No preview URL available for this track");
				setAudioDebug("No preview URL - can't play this track");
				setGameState("waiting");
				isPlayingRef.current = false;
				
				// Clear timeout since we can't play
				if (playbackTimeoutRef.current) {
					clearTimeout(playbackTimeoutRef.current);
					playbackTimeoutRef.current = null;
				}
			}
		} catch (err) {
			console.error("Error playing clip:", err);
			setDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			setAudioDebug("General error: " + (err instanceof Error ? err.message : 'Unknown'));
			setGameState("waiting");
			isPlayingRef.current = false;
			
			// Clear timeout since we failed
			if (playbackTimeoutRef.current) {
				clearTimeout(playbackTimeoutRef.current);
				playbackTimeoutRef.current = null;
			}
		}
	}, [currentRound, connect, isSdkAvailable, pause, play, seek]);

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
		// Reset for new game
		setGameStats(prev => ({
			...prev,
			currentScore: 0,
			currentStreak: 0,
		}));
		setCurrentRound(null);
		setSelectedSearchResult(null);
		setEndScreenData(null);
		setGameState("waiting");
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
		<div className="flex flex-col gap-4 max-w-2xl mx-auto">
			{/* Game Header */}
			<div className="text-center">
				<h2 className="text-2xl font-bold text-gray-800 mb-2">🎵 Guessify</h2>
				<p className="text-gray-600">Test your music memory with your Spotify likes!</p>
			</div>

			{/* Game Stats HUD */}
			<div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
				<div className="text-center">
					<div className="text-2xl font-bold text-blue-600">{gameStats.currentScore}</div>
					<div className="text-sm text-gray-600">Current Score</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold text-green-600">{gameStats.currentStreak}</div>
					<div className="text-sm text-gray-600">Current Streak</div>
				</div>
			</div>

			{/* High Score Display */}
			<div className="grid grid-cols-2 gap-4 bg-purple-50 p-3 rounded-lg">
				<div className="text-center">
					<div className="text-lg font-bold text-purple-600">{gameStats.highScore}</div>
					<div className="text-xs text-gray-600">High Score</div>
				</div>
				<div className="text-center">
					<div className="text-lg font-bold text-purple-600">{gameStats.bestStreak}</div>
					<div className="text-xs text-gray-600">Best Streak</div>
				</div>
			</div>

			{/* Loading Progress */}
			{loading && (
				<div className="bg-blue-50 p-4 rounded-lg">
					<div className="text-center text-blue-800 mb-2">
						{getLoadingMessage()} {loadingProgress.loaded}/{loadingProgress.total || '?'}
					</div>
					<div className="w-full bg-blue-200 rounded-full h-2">
						<div 
							className="bg-blue-600 h-2 rounded-full transition-all duration-300"
							style={{ width: `${loadingProgress.total ? (loadingProgress.loaded / loadingProgress.total) * 100 : 0}%` }}
						></div>
					</div>
				</div>
			)}

			{/* Game Controls */}
			{gameState === "waiting" && (
				<div className="text-center space-y-3">
					{!currentRound ? (
						<button 
							className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg text-lg w-48"
							onClick={startNewRound}
							disabled={loading}
						>
							{loading ? 'Loading...' : 'Start Round'}
						</button>
					) : (
						<button 
							className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg text-lg w-48"
							onClick={playCurrentLevel}
						>
							Play {getCurrentLevel()?.name} Level ({formatTime(getCurrentLevel()?.duration || 0)})
						</button>
					)}
					<div className="text-sm text-gray-600">
						{!currentRound ? "Start a new round with a random song!" : "Ready to play!"}
					</div>
				</div>
			)}

			{/* Game State Display */}
			{gameState === "playing" && currentRound && (
				<div className="text-center space-y-3">
					<div className="text-lg font-semibold text-gray-800 mb-2">🎵 Playing...</div>
					<div className="text-sm text-gray-600">
						{getCurrentLevel()?.name} Level - {formatTime(getCurrentLevel()?.duration || 0)} clip
					</div>
					<button
						onClick={() => {
							console.log("Manual stop button clicked");
							if (playbackTimeoutRef.current) {
								clearTimeout(playbackTimeoutRef.current);
								playbackTimeoutRef.current = null;
							}
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
						}}
						className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold"
					>
						🛑 Force Stop (Debug)
					</button>
				</div>
			)}

			{/* Guess Input */}
			{gameState === "guessing" && currentRound && (
				<div className="space-y-4">
					<div className="text-center">
						<div className="text-lg font-semibold text-gray-800 mb-2">🎯 What song was that?</div>
						<div className="text-sm text-gray-600">
							{getCurrentLevel()?.name} Level - {formatTime(getCurrentLevel()?.duration || 0)} clip
						</div>
					</div>
					
					<div className="space-y-3">
						<SearchAutocomplete
							onSelect={handleSearchSelect}
							placeholder="Search for a song..."
							className="w-full"
						/>
						
						{selectedSearchResult && (
							<div className="bg-green-50 p-3 rounded-lg border border-green-200">
								<div className="text-sm text-green-800">
									<strong>Selected:</strong> "{selectedSearchResult.name}" by {selectedSearchResult.artist}
								</div>
							</div>
						)}
						
						<div className="grid grid-cols-2 gap-2">
							<button
								onClick={submitGuess}
								disabled={!selectedSearchResult}
								className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-semibold h-12"
							>
								Submit Guess
							</button>
							<button
								onClick={playCurrentLevel}
								className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-semibold h-12"
							>
								🔁 Replay
							</button>
							<button
								onClick={nextLevel}
								disabled={currentRound.currentLevelIndex >= GAME_LEVELS.length - 1}
								className="bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg font-semibold h-12"
							>
								⏰ More Time
							</button>
							<button
								onClick={giveUp}
								className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-semibold h-12"
							>
								🏳️ Give Up
							</button>
						</div>
					</div>
					
					<div className="text-sm text-gray-500 text-center">
						Attempts: {currentRound.attempts + 1} | Level: {getCurrentLevel()?.name} ({formatTime(getCurrentLevel()?.duration || 0)})
					</div>
				</div>
			)}

			{/* End Screen */}
			{gameState === "gameOver" && endScreenData && (
				<div className="text-center space-y-4">
					<div className="text-3xl font-bold text-purple-600">🏁 Round Complete!</div>
					
					<div className="bg-gray-50 p-4 rounded-lg">
						<div className="text-xl text-gray-800 mb-2">
							{endScreenData.wasCorrect ? "🎉 Correct!" : "❌ Game Over"}
						</div>
						<div className="text-lg text-gray-700 mb-2">
							"{endScreenData.track.name}" by {endScreenData.track.artist}
						</div>
						<div className="text-sm text-gray-600">
							Final Score: {endScreenData.finalScore} | Final Streak: {endScreenData.finalStreak}
						</div>
					</div>
					
					<div className="flex gap-2 justify-center">
						<button
							onClick={startNewGame}
							className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-semibold w-32"
						>
							New Game
						</button>
						<button
							onClick={startNewRound}
							className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-semibold w-32"
						>
							Next Round
						</button>
					</div>
				</div>
			)}

			{/* Debug Info - Only show non-spoiler info */}
			{debugInfo && (
				<div className="text-sm text-gray-600 bg-gray-100 p-3 rounded-lg">
					{debugInfo}
				</div>
			)}
			
			{audioDebug && (
				<div className="text-sm text-blue-600 bg-blue-100 p-3 rounded-lg">
					Audio Debug: {audioDebug}
				</div>
			)}
			
			<div className="text-xs text-gray-500 text-center">
				Debug: {tracks.length} tracks, SDK: {isSdkAvailable ? 'Yes' : 'No'}, Loading: {loading ? 'Yes' : 'No'}
				{error && `, Error: ${error}`}
			</div>
		</div>
	);
}



