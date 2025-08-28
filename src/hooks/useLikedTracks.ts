import { useCallback, useEffect, useMemo, useState } from "react";
import type { LikedTrack } from "@/lib/spotify";

type SpotifySavedTracksResponse = {
	items: Array<{
		track: {
			id: string;
			uri: string;
			name: string;
			artists: Array<{ id: string; name: string }>; // ✅ FIXED: Include artist IDs
			preview_url: string | null;
			duration_ms: number;
			album: { // ✅ FIXED: Include album data
				name: string;
				images: Array<{ url: string; width: number; height: number }>;
			};
		};
	}>;
	next: string | null;
	total?: number; // Added for total count
};

export function useLikedTracks(limit = 50) { // Spotify API max limit is 50
	const [tracks, setTracks] = useState<LikedTrack[]>(() => {
		// Load from localStorage on init if available
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('guessify-tracks');
			if (saved) {
				try {
					return JSON.parse(saved);
				} catch (e) {
					console.error('Failed to parse saved tracks:', e);
				}
			}
		}
		return [];
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [loadingProgress, setLoadingProgress] = useState<{ loaded: number; total: number | null }>({ loaded: 0, total: null });

	// Save tracks to localStorage whenever they change
	useEffect(() => {
		if (typeof window !== 'undefined' && tracks.length > 0) {
			localStorage.setItem('guessify-tracks', JSON.stringify(tracks));
		}
	}, [tracks]);

	const normalize = useCallback((resp: SpotifySavedTracksResponse): LikedTrack[] => {
		console.log("🔍 Raw Spotify API response structure:", {
			hasItems: !!resp.items,
			itemCount: resp.items?.length,
			sampleItem: resp.items?.[0],
			sampleTrack: resp.items?.[0]?.track,
			sampleArtists: resp.items?.[0]?.track?.artists,
			sampleAlbum: resp.items?.[0]?.track?.album
		});
		
		const normalized = resp.items.map(({ track }) => ({
			id: track.id,
			uri: track.uri,
			name: track.name,
			artist: track.artists.map((a) => a.name).join(", "), // Keep for backward compatibility
			// ✅ FIXED: Preserve full artist data
			artists: track.artists, // Full artists array with IDs
			// ✅ FIXED: Preserve album data
			album: track.album,
			hasPreview: Boolean(track.preview_url),
			previewUrl: track.preview_url ?? undefined,
			durationMs: track.duration_ms,
		}));
		
		console.log("🔍 Normalized track structure:", {
			sampleNormalized: normalized[0],
			hasArtistsArray: !!normalized[0]?.artists,
			hasAlbumData: !!normalized[0]?.album,
			artistsSample: normalized[0]?.artists,
			albumSample: normalized[0]?.album
		});
		
		return normalized;
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
			
			// Try to parse the error for better debugging
			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error && errorJson.error.includes("Spotify API error: 400")) {
					throw new Error("Spotify API limit exceeded - reducing batch size");
				}
			} catch (parseError) {
				// Continue with original error
			}
			
			throw new Error(`Failed to fetch: ${res.status} - ${errorText}`);
		}
		
		const data = await res.json();
		console.log("useLikedTracks: received data", { itemCount: data.items?.length, hasNext: !!data.next });
		return data as SpotifySavedTracksResponse;
	}, [limit]);

	const loadAll = useCallback(async () => {
		// If we already have tracks loaded, don't reload
		if (tracks.length > 0) {
			console.log("useLikedTracks: tracks already loaded, skipping reload");
			return;
		}

		console.log("useLikedTracks: loadAll called");
		setLoading(true);
		setError(null);
		setLoadingProgress({ loaded: 0, total: null });
		
		try {
			let offset = 0;
			let all: LikedTrack[] = [];
			
			// First, get the total count
			const firstPage = await fetchPage(0);
			const totalCount = firstPage.total || 0;
			setLoadingProgress({ loaded: 0, total: totalCount });
			
			// Load all pages
			while (true) {
				console.log("useLikedTracks: fetching page at offset", offset);
				const page = await fetchPage(offset);
				const normalized = normalize(page);
				console.log("useLikedTracks: normalized", normalized.length, "tracks");
				all = all.concat(normalized);
				
				// Update progress
				setLoadingProgress({ loaded: all.length, total: totalCount });
				
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
	}, [fetchPage, limit, normalize, tracks.length]);

	// Remove the useEffect that was causing infinite API calls
	// useEffect(() => {
	// 	console.log("useLikedTracks: useEffect triggered, calling loadAll");
	// 	loadAll();
	// }, [loadAll]);

	return useMemo(
		() => ({ tracks, loading, error, loadAll, loadingProgress }),
		[tracks, loading, error, loadAll, loadingProgress],
	);
}


