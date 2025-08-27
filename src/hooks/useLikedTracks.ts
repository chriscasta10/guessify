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
		console.log("useLikedTracks: fetchPage called", { offset, limit });
		const url = new URL("/api/liked-tracks", window.location.origin);
		url.searchParams.set("limit", String(limit));
		url.searchParams.set("offset", String(offset));
		console.log("useLikedTracks: fetching from", url.toString());
		
		const res = await fetch(url);
		console.log("useLikedTracks: response status", res.status, res.ok);
		
		if (!res.ok) {
			const errorText = await res.text();
			console.error("useLikedTracks: API error", { status: res.status, error: errorText });
			throw new Error(`Failed to fetch: ${res.status} - ${errorText}`);
		}
		
		const data = await res.json();
		console.log("useLikedTracks: received data", { itemCount: data.items?.length, hasNext: !!data.next });
		return data as SpotifySavedTracksResponse;
	}, [limit]);

	const loadAll = useCallback(async () => {
		console.log("useLikedTracks: loadAll called");
		setLoading(true);
		setError(null);
		try {
			let offset = 0;
			let all: LikedTrack[] = [];
			while (true) {
				console.log("useLikedTracks: fetching page at offset", offset);
				const page = await fetchPage(offset);
				const normalized = normalize(page);
				console.log("useLikedTracks: normalized", normalized.length, "tracks");
				all = all.concat(normalized);
				if (!page.next) break;
				offset += limit;
			}
			console.log("useLikedTracks: total tracks loaded", all.length);
			setTracks(all);
		} catch (e) {
			console.error("useLikedTracks: error in loadAll", e);
			setError(e instanceof Error ? e.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, [fetchPage, limit, normalize]);

	// Remove the useEffect that was causing infinite API calls
	// useEffect(() => {
	// 	console.log("useLikedTracks: useEffect triggered, calling loadAll");
	// 	loadAll();
	// }, [loadAll]);

	return useMemo(
		() => ({ tracks, loading, error, loadAll }),
		[tracks, loading, error, loadAll],
	);
}


