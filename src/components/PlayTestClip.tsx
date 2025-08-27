"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { usePlayer } from "@/providers/PlayerProvider";
import { SearchAutocomplete } from "@/components/SearchAutocomplete";

// Progressive difficulty: starts hard (short clips), gets easier (longer clips)
// This creates a better user experience - challenging at first, then more manageable
const LEVELS = [500, 1000, 2000, 3000, 5000, 8000]; // 0.5s → 1s → 2s → 3s → 5s → 8s

type GameState = "waiting" | "playing" | "guessing" | "correct" | "incorrect" | "gameOver";

interface GameStats {
	score: number;
	level: number;
	attempts: number;
	correctGuesses: number;
	totalGuesses: number;
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
	const { tracks, loadAll, loading, error, loadingProgress } = useLikedTracks(50); // Spotify API max limit
	const [levelIndex, setLevelIndex] = useState(0);
	const [gameState, setGameState] = useState<GameState>("waiting");
	const [currentTrack, setCurrentTrack] = useState<any>(null);
	const [selectedSearchResult, setSelectedSearchResult] = useState<SearchResult | null>(null);
	const [gameStats, setGameStats] = useState<GameStats>({
		score: 0,
		level: 0,
		attempts: 0,
		correctGuesses: 0,
		totalGuesses: 0,
	});
	const [debugInfo, setDebugInfo] = useState<string>("");
	const [audioDebug, setAudioDebug] = useState<string>("");
	const audioRef = useRef<HTMLAudioElement | null>(null);

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

	const startNewRound = useCallback(async () => {
		console.log("PlayTestClip: startNewRound called", { 
			tracksLength: tracks.length, 
			isSdkAvailable, 
			levelIndex,
			loading,
			error 
		});

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
		
		setCurrentTrack(track);
		const levelMs = LEVELS[levelIndex];
		const randomStart = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (levelMs + 3000))));

		setDebugInfo(`Playing ${track.name} by ${track.artist} at ${randomStart}ms for ${levelMs}ms`);
		setGameState("playing");
		setAudioDebug("Starting playback...");

		try {
			// Always try Spotify SDK first (works for all tracks)
			if (isSdkAvailable) {
				console.log("Using Spotify SDK");
				setAudioDebug("Connecting to Spotify SDK...");
				
				// Debug the connection process step by step
				setAudioDebug("Step 1: Checking SDK availability...");
				console.log("SDK available:", isSdkAvailable);
				console.log("Window.Spotify exists:", typeof window !== 'undefined' && !!window.Spotify);
				
				setAudioDebug("Step 2: Attempting to connect...");
				const connected = await connect();
				console.log("SDK connection result:", connected);
				
				if (!connected) {
					setDebugInfo("Failed to connect to Spotify SDK, trying preview URL fallback");
					setAudioDebug("SDK connection failed, falling back to preview");
					console.log("SDK connection failed - this usually means:");
					console.log("1. User doesn't have Spotify Premium");
					console.log("2. No active Spotify app/devices");
					console.log("3. Token issues");
				} else {
					setAudioDebug("SDK connected successfully! Seeking and playing...");
					console.log("SDK connected, attempting to seek and play");
					
					try {
						await seek(randomStart);
						setAudioDebug("Seek successful, now playing...");
						await play(track.uri, randomStart);
						
						setAudioDebug("Playing via SDK, will stop in " + (levelMs/1000) + "s");
						setTimeout(() => {
							void pause();
							setGameState("guessing");
							setAudioDebug("SDK playback stopped - time to guess!");
						}, levelMs);
						return;
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
					setAudioDebug("Audio play() succeeded, should hear sound now");
					
					// Stop after the specified duration
					setTimeout(() => {
						if (audioRef.current) {
							audioRef.current.pause();
							console.log("Audio stopped");
							setAudioDebug("Audio manually stopped");
						}
						setGameState("guessing");
						setAudioDebug("Preview playback stopped - time to guess!");
					}, levelMs);
				} catch (playError) {
					console.error("Error playing audio:", playError);
					setDebugInfo(`Audio playback error: ${playError instanceof Error ? playError.message : 'Unknown error'}`);
					setAudioDebug("Play error: " + (playError instanceof Error ? playError.message : 'Unknown'));
					setGameState("waiting");
				}
			} else {
				setDebugInfo("No preview URL available for this track");
				setAudioDebug("No preview URL - can't play this track");
				setGameState("waiting");
			}
		} catch (err) {
			console.error("Error playing clip:", err);
			setDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			setAudioDebug("General error: " + (err instanceof Error ? err.message : 'Unknown'));
			setGameState("waiting");
		}
	}, [connect, isSdkAvailable, levelIndex, pause, play, seek, tracks, loading, error, loadAll]);

	const submitGuess = useCallback(() => {
		if (!currentTrack || !selectedSearchResult) return;

		// Stricter guessing: only correct if the song title matches exactly
		const isCorrect = selectedSearchResult.id === currentTrack.id;

		setGameStats(prev => ({
			...prev,
			attempts: prev.attempts + 1,
			totalGuesses: prev.totalGuesses + 1,
			correctGuesses: isCorrect ? prev.correctGuesses + 1 : prev.correctGuesses,
		}));

		if (isCorrect) {
			// Calculate score based on level and attempts
			const baseScore = (LEVELS.length - levelIndex) * 100; // Higher levels = more points
			const attemptPenalty = Math.max(0, (gameStats.attempts - 1) * 50); // Penalty for multiple attempts
			const roundScore = Math.max(10, baseScore - attemptPenalty);
			
			setGameStats(prev => ({
				...prev,
				score: prev.score + roundScore,
			}));
			
			setGameState("correct");
			setDebugInfo(`Correct! +${roundScore} points. It was "${currentTrack.name}" by ${currentTrack.artist}`);
		} else {
			setGameStats(prev => ({
				...prev,
				attempts: prev.attempts + 1,
			}));
			
			setGameState("incorrect");
			setDebugInfo(`Incorrect! Try again. You've made ${gameStats.attempts + 1} attempts.`);
		}
	}, [currentTrack, selectedSearchResult, gameStats.attempts, levelIndex]);

	const handleSearchSelect = useCallback((result: SearchResult) => {
		setSelectedSearchResult(result);
	}, []);

	const nextLevel = useCallback(() => {
		if (levelIndex < LEVELS.length - 1) {
			setLevelIndex(prev => prev + 1);
			setGameStats(prev => ({ ...prev, level: prev.level + 1, attempts: 0 }));
			setGameState("waiting");
			setSelectedSearchResult(null);
			setDebugInfo(`Level ${levelIndex + 2}: ${LEVELS[levelIndex + 1]}ms clips (easier!)`);
		} else {
			setGameState("gameOver");
			setDebugInfo(`Game Complete! Final Score: ${gameStats.score}`);
		}
	}, [levelIndex, gameStats.score]);

	const skipLevel = useCallback(() => {
		// Skip to next level without penalty
		nextLevel();
	}, [nextLevel]);

	const resetGame = useCallback(() => {
		setLevelIndex(0);
		setGameStats({
			score: 0,
			level: 0,
			attempts: 0,
			correctGuesses: 0,
			totalGuesses: 0,
		});
		setGameState("waiting");
		setSelectedSearchResult(null);
		setDebugInfo("Game reset! Start with challenging 0.5 second clips.");
	}, []);

	const formatTime = (ms: number) => {
		if (ms < 1000) return `${ms}ms`;
		return `${ms / 1000}s`;
	};

	return (
		<div className="flex flex-col gap-4 max-w-2xl mx-auto">
			{/* Game Header */}
			<div className="text-center">
				<h2 className="text-2xl font-bold text-gray-800 mb-2">Guessify</h2>
				<p className="text-gray-600">Test your music memory with your Spotify likes!</p>
			</div>

			{/* Game Stats */}
			<div className="grid grid-cols-3 gap-4 bg-gray-50 p-4 rounded-lg">
				<div className="text-center">
					<div className="text-2xl font-bold text-blue-600">{gameStats.score}</div>
					<div className="text-sm text-gray-600">Score</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold text-green-600">{levelIndex + 1}</div>
					<div className="text-sm text-gray-600">Level</div>
				</div>
				<div className="text-center">
					<div className="text-2xl font-bold text-purple-600">{gameStats.correctGuesses}</div>
					<div className="text-sm text-gray-600">Correct</div>
				</div>
			</div>

			{/* Loading Progress */}
			{loading && (
				<div className="bg-blue-50 p-4 rounded-lg">
					<div className="text-center text-blue-800 mb-2">
						Loading your liked tracks... {loadingProgress.loaded}/{loadingProgress.total || '?'}
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
					<button 
						className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-lg text-lg"
						onClick={startNewRound}
						disabled={loading}
					>
						{loading ? 'Loading...' : `Start Level ${levelIndex + 1} (${formatTime(LEVELS[levelIndex])})`}
					</button>
					<div className="text-sm text-gray-600">
						{levelIndex === 0 ? "Start with challenging short clips!" : "Clips get longer and easier as you advance"}
					</div>
				</div>
			)}

			{/* Game State Display */}
			{gameState === "playing" && (
				<div className="text-center">
					<div className="text-lg font-semibold text-gray-800 mb-2">🎵 Playing...</div>
					<div className="text-sm text-gray-600">Listen carefully!</div>
				</div>
			)}

			{/* Guess Input */}
			{gameState === "guessing" && (
				<div className="space-y-4">
					<div className="text-center">
						<div className="text-lg font-semibold text-gray-800 mb-2">🎯 What song was that?</div>
						<div className="text-sm text-gray-600">Search and select the exact song</div>
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
						
						<div className="flex gap-2">
							<button
								onClick={submitGuess}
								disabled={!selectedSearchResult}
								className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-6 py-2 rounded-lg font-semibold"
							>
								Guess
							</button>
							<button
								onClick={startNewRound}
								className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-semibold"
							>
								🔁 Replay
							</button>
							<button
								onClick={skipLevel}
								className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-semibold"
							>
								⏭️ Next
							</button>
						</div>
					</div>
					
					<div className="text-sm text-gray-500 text-center">
						Attempts: {gameStats.attempts + 1}
					</div>
				</div>
			)}

			{/* Result Display */}
			{gameState === "correct" && (
				<div className="text-center space-y-4">
					<div className="text-2xl font-bold text-green-600">🎉 Correct!</div>
					<div className="text-gray-800">
						"{currentTrack?.name}" by {currentTrack?.artist}
					</div>
					<button
						onClick={nextLevel}
						className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-semibold"
					>
						Next Level →
					</button>
				</div>
			)}

			{gameState === "incorrect" && (
				<div className="text-center space-y-4">
					<div className="text-xl font-semibold text-red-600">❌ Try Again</div>
					<button
						onClick={startNewRound}
						className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg font-semibold"
					>
						🔁 Replay Clip
					</button>
				</div>
			)}

			{gameState === "gameOver" && (
				<div className="text-center space-y-4">
					<div className="text-3xl font-bold text-purple-600">🏆 Game Complete!</div>
					<div className="text-xl text-gray-800">Final Score: {gameStats.score}</div>
					<div className="text-gray-600">
						Correct: {gameStats.correctGuesses}/{gameStats.totalGuesses}
					</div>
					<button
						onClick={resetGame}
						className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-semibold"
					>
						Play Again
					</button>
				</div>
			)}

			{/* Debug Info */}
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
				{tracks.length > 0 && `, First track: ${tracks[0]?.name}`}
				{tracks.length > 0 && `, Tracks with preview: ${tracks.filter(t => t.hasPreview).length}`}
			</div>
		</div>
	);
}


