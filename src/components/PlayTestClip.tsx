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
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		console.log("PlayTestClip: useEffect triggered");
		loadAll();
		void initPlayer();
	}, [initPlayer, loadAll]);

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

		if (tracks.length === 0) {
			setDebugInfo("No tracks loaded yet");
			console.log("No tracks available");
			return;
		}

		const track = tracks.find((t) => t.hasPreview) ?? tracks[0];
		console.log("Selected track:", track);
		
		const levelMs = LEVELS[levelIndex];
		const randomStart = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (levelMs + 3000))));

		setDebugInfo(`Playing ${track.name} by ${track.artist} at ${randomStart}ms for ${levelMs}ms`);
		setIsPlaying(true);

		try {
			if (isSdkAvailable) {
				console.log("Using Spotify SDK");
				const connected = await connect();
				if (!connected) {
					setDebugInfo("Failed to connect to Spotify SDK");
					setIsPlaying(false);
					return;
				}
				
				await seek(randomStart);
				await play(track.uri, randomStart);
				setTimeout(() => {
					void pause();
					setIsPlaying(false);
				}, levelMs);
				return;
			}

			if (track.previewUrl) {
				console.log("Using preview URL fallback");
				if (!audioRef.current) {
					audioRef.current = new Audio(track.previewUrl);
				}
				
				// Reset audio and set position
				audioRef.current.currentTime = randomStart / 1000;
				audioRef.current.volume = 0.8;
				
				// Play the audio
				try {
					await audioRef.current.play();
					console.log("Audio started playing");
					
					// Stop after the specified duration
					setTimeout(() => {
						if (audioRef.current) {
							audioRef.current.pause();
							console.log("Audio stopped");
						}
						setIsPlaying(false);
					}, levelMs);
				} catch (playError) {
					console.error("Error playing audio:", playError);
					setDebugInfo(`Audio playback error: ${playError instanceof Error ? playError.message : 'Unknown error'}`);
					setIsPlaying(false);
				}
			} else {
				setDebugInfo("No preview URL available for this track");
				setIsPlaying(false);
			}
		} catch (err) {
			console.error("Error playing clip:", err);
			setDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
			setIsPlaying(false);
		}
	}, [connect, isSdkAvailable, levelIndex, pause, play, seek, tracks, loading, error]);

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
			<div className="text-xs text-gray-500">
				Debug: {tracks.length} tracks, SDK: {isSdkAvailable ? 'Yes' : 'No'}, Loading: {loading ? 'Yes' : 'No'}
				{error && `, Error: ${error}`}
				{tracks.length > 0 && `, First track: ${tracks[0]?.name}`}
			</div>
		</div>
	);
}


