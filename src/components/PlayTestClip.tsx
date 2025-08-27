"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { usePlayer } from "@/providers/PlayerProvider";

// More human-friendly timer levels: 1s, 2s, 4s, 8s, 16s, 32s
const LEVELS = [1000, 2000, 4000, 8000, 16000, 32000];

export function PlayTestClip() {
	const { initPlayer, connect, play, pause, seek, isSdkAvailable } = usePlayer();
	const { tracks, loadAll, loading, error } = useLikedTracks(20);
	const [levelIndex, setLevelIndex] = useState(0);
	const [debugInfo, setDebugInfo] = useState<string>("");
	const [isPlaying, setIsPlaying] = useState(false);
	const [audioDebug, setAudioDebug] = useState<string>("");
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		console.log("PlayTestClip: useEffect triggered");
		// Don't load all tracks upfront - just initialize the player
		void initPlayer();
	}, [initPlayer]);

	// Monitor tracks changes
	useEffect(() => {
		console.log("PlayTestClip: tracks changed", { 
			tracksLength: tracks.length, 
			loading, 
			error,
			sampleTrack: tracks[0] 
		});
	}, [tracks, loading, error]);

	const playClip = useCallback(async () => {
		console.log("PlayTestClip: playClip called", { 
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

		const track = tracks.find((t) => t.hasPreview) ?? tracks[0];
		console.log("Selected track:", track);
		
		const levelMs = LEVELS[levelIndex];
		const randomStart = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (levelMs + 3000))));

		setDebugInfo(`Playing ${track.name} by ${track.artist} at ${randomStart}ms for ${levelMs}ms`);
		setIsPlaying(true);
		setAudioDebug("Starting playback...");

		try {
			if (isSdkAvailable) {
				console.log("Using Spotify SDK");
				setAudioDebug("Connecting to Spotify SDK...");
				
				const connected = await connect();
				if (!connected) {
					setDebugInfo("Failed to connect to Spotify SDK");
					setAudioDebug("SDK connection failed");
					setIsPlaying(false);
					return;
				}
				
				setAudioDebug("SDK connected, seeking and playing...");
				await seek(randomStart);
				await play(track.uri, randomStart);
				
				setAudioDebug("Playing via SDK, will stop in " + (levelMs/1000) + "s");
				setTimeout(() => {
					void pause();
					setIsPlaying(false);
					setAudioDebug("SDK playback stopped");
				}, levelMs);
				return;
			}

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
						setIsPlaying(false);
					}, levelMs);
				} catch (playError) {
					console.error("Error playing audio:", playError);
					setDebugInfo(`Audio playback error: ${playError instanceof Error ? playError.message : 'Unknown error'}`);
					setAudioDebug("Play error: " + (playError instanceof Error ? playError.message : 'Unknown'));
					setIsPlaying(false);
				}
			} else {
				setDebugInfo("No preview URL available for this track");
				setAudioDebug("No preview URL - can't play this track");
				setIsPlaying(false);
			}
		} catch (err) {
			console.error("Error playing clip:", err);
			setDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			setAudioDebug("General error: " + (err instanceof Error ? err.message : 'Unknown'));
			setIsPlaying(false);
		}
	}, [connect, isSdkAvailable, levelIndex, pause, play, seek, tracks, loading, error, loadAll]);

	const formatTime = (ms: number) => {
		if (ms < 1000) return `${ms}ms`;
		return `${ms / 1000}s`;
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<button 
					className={`rounded px-3 py-2 ${isPlaying ? 'bg-red-600' : 'bg-emerald-600'} text-white`}
					onClick={playClip}
					disabled={isPlaying}
				>
					{isPlaying ? 'Playing...' : `Play Test Clip (${formatTime(LEVELS[levelIndex])})`}
				</button>
				<button
					className="rounded border px-3 py-2"
					onClick={() => setLevelIndex((i) => Math.min(i + 1, LEVELS.length - 1))}
					disabled={isPlaying}
				>
					I don't know →
				</button>
			</div>
			{debugInfo && (
				<div className="text-sm text-gray-600 bg-gray-100 p-2 rounded">
					{debugInfo}
				</div>
			)}
			{audioDebug && (
				<div className="text-sm text-blue-600 bg-blue-100 p-2 rounded">
					Audio Debug: {audioDebug}
				</div>
			)}
			<div className="text-xs text-gray-500">
				Debug: {tracks.length} tracks, SDK: {isSdkAvailable ? 'Yes' : 'No'}, Loading: {loading ? 'Yes' : 'No'}
				{error && `, Error: ${error}`}
				{tracks.length > 0 && `, First track: ${tracks[0]?.name}`}
			</div>
		</div>
	);
}


