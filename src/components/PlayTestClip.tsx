"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLikedTracks } from "@/hooks/useLikedTracks";
import { usePlayer } from "@/providers/PlayerProvider";

const LEVELS = [100, 500, 1000, 2000, 4000, 8000];

export function PlayTestClip() {
	const { initPlayer, connect, play, pause, seek, isSdkAvailable } = usePlayer();
	const { tracks, loadAll } = useLikedTracks(20);
	const [levelIndex, setLevelIndex] = useState(0);
	const audioRef = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		loadAll();
		void initPlayer();
	}, [initPlayer, loadAll]);

	const playClip = useCallback(async () => {
		if (tracks.length === 0) return;
		const track = tracks.find((t) => t.hasPreview) ?? tracks[0];
		const levelMs = LEVELS[levelIndex];
		const randomStart = Math.max(0, Math.floor(Math.random() * Math.max(0, track.durationMs - (levelMs + 3000))));

		if (isSdkAvailable) {
			await connect();
			await seek(randomStart);
			await play(track.uri, randomStart);
			setTimeout(() => {
				void pause();
			}, levelMs);
			return;
		}

		if (track.previewUrl) {
			if (!audioRef.current) {
				audioRef.current = new Audio(track.previewUrl);
			}
			audioRef.current.currentTime = randomStart / 1000;
			audioRef.current.play();
			setTimeout(() => {
				audioRef.current?.pause();
			}, levelMs);
		}
	}, [connect, isSdkAvailable, levelIndex, pause, play, seek, tracks]);

	return (
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
	);
}


