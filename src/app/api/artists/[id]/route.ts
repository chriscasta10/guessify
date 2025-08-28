import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/spotify';

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id: artistId } = await params;
		
		if (!artistId) {
			return NextResponse.json({ error: 'Artist ID is required' }, { status: 400 });
		}

		// Get access token
		const accessToken = await getAccessToken();
		if (!accessToken) {
			return NextResponse.json({ error: 'Failed to get access token' }, { status: 401 });
		}

		// Fetch artist data from Spotify
		const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
			headers: {
				'Authorization': `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			console.error('Spotify API error:', response.status, errorData);
			return NextResponse.json(
				{ error: `Spotify API error: ${response.status}` },
				{ status: response.status }
			);
		}

		const artistData = await response.json();
		
		// Return the artist data
		return NextResponse.json(artistData);
	} catch (error) {
		console.error('Error fetching artist data:', error);
		return NextResponse.json(
			{ error: 'Internal server error' },
			{ status: 500 }
		);
	}
}
