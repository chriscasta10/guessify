import { useCallback, useEffect, useMemo, useState } from "react";
import type { LikedTrack } from "@/lib/spotify";

type SpotifySavedTracksResponse = {
	items: Array<{
		track: {
			id: string;
			uri: string;
			name: string;
			artists: Array<{ name: string }>;
			preview_url: string | null;
			duration_ms: number;
		};
	}>;
	next: string | null;
};

export function useLikedTracks(limit = 50) {
	const [tracks, setTracks] = useState<LikedTrack[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const normalize = useCallback((resp: SpotifySavedTracksResponse): LikedTrack[] => {
		return resp.items.map(({ track }) => ({
			id: track.id,
			uri: track.uri,
			name: track.name,
			artist: track.artists.map((a) => a.name).join(", "),
			hasPreview: Boolean(track.preview_url),
			previewUrl: track.preview_url ?? undefined,
			durationMs: track.duration_ms,
		}));
	}, []);

	const fetchPage = useCallback(async (offset: number) => {
		const url = new URL("/api/liked-tracks", window.location.origin);
		url.searchParams.set("limit", String(limit));
		url.searchParams.set("offset", String(offset));
		const res = await fetch(url);
		if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
		return (await res.json()) as SpotifySavedTracksResponse;
	}, [limit]);

	const loadAll = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			let offset = 0;
			let all: LikedTrack[] = [];
			while (true) {
				const page = await fetchPage(offset);
				all = all.concat(normalize(page));
				if (!page.next) break;
				offset += limit;
			}
			setTracks(all);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, [fetchPage, limit, normalize]);

	useEffect(() => {
		// Lazy: caller triggers via returned loadAll
	}, []);

	return useMemo(
		() => ({ tracks, loading, error, loadAll }),
		[tracks, loading, error, loadAll],
	);
}


