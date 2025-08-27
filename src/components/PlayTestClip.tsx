"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { usePlayer } from "@/providers/PlayerProvider";

const LEVELS = [100, 500, 1000, 2000, 4000, 8000];

export function PlayTestClip() {
	const { initPlayer, connect, play, pause, seek, isSdkAvailable } = usePlayer();
	const { tracks, loadAll, loading, error } = useLikedTracks(20);
	const [levelIndex, setLevelIndex] = useState(0);
	const [debugInfo, setDebugInfo] = useState<string>("");
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

		try {
			if (isSdkAvailable) {
				console.log("Using Spotify SDK");
				await connect();
				await seek(randomStart);
				await play(track.uri, randomStart);
				setTimeout(() => {
					void pause();
				}, levelMs);
				return;
			}

			if (track.previewUrl) {
				console.log("Using preview URL fallback");
				if (!audioRef.current) {
					audioRef.current = new Audio(track.previewUrl);
				}
				audioRef.current.currentTime = randomStart / 1000;
				await audioRef.current.play();
				setTimeout(() => {
					audioRef.current?.pause();
				}, levelMs);
			} else {
				setDebugInfo("No preview URL available for this track");
			}
		} catch (err) {
			console.error("Error playing clip:", err);
			setDebugInfo(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
		}
	}, [connect, isSdkAvailable, levelIndex, pause, play, seek, tracks, loading, error]);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<button className="rounded bg-emerald-600 text-white px-3 py-2" onClick={playClip}>
					Play Test Clip ({LEVELS[levelIndex]}ms)
				</button>
				<button
					className="rounded border px-3 py-2"
					onClick={() => setLevelIndex((i) => Math.min(i + 1, LEVELS.length - 1))}
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


