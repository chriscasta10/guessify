"use client";
import { useCallback, useEffect, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";

interface SearchResult {
	id: string;
	name: string;
	artist: string;
	album: string;
	uri: string;
}

interface SearchAutocompleteProps {
	onSelect: (result: SearchResult) => void;
	placeholder?: string;
	className?: string;
}

export function SearchAutocomplete({ onSelect, placeholder = "Search for a song...", className = "" }: SearchAutocompleteProps) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isOpen, setIsOpen] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(-1);

	const debouncedQuery = useDebounce(query, 300);

	const searchTracks = useCallback(async (searchQuery: string) => {
		if (searchQuery.trim().length < 2) {
			setResults([]);
			return;
		}

		setIsLoading(true);
		try {
			const response = await fetch(`/api/spotify-search?q=${encodeURIComponent(searchQuery)}`);
			if (response.ok) {
				const data = await response.json();
				setResults(data.tracks || []);
			} else {
				setResults([]);
			}
		} catch (error) {
			console.error("Search error:", error);
			setResults([]);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (debouncedQuery) {
			searchTracks(debouncedQuery);
		} else {
			setResults([]);
		}
	}, [debouncedQuery, searchTracks]);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setQuery(value);
		setIsOpen(true);
		setSelectedIndex(-1);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!isOpen || results.length === 0) return;

		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setSelectedIndex(prev => (prev + 1) % results.length);
				break;
			case "ArrowUp":
				e.preventDefault();
				setSelectedIndex(prev => prev <= 0 ? results.length - 1 : prev - 1);
				break;
			case "Enter":
				e.preventDefault();
				if (selectedIndex >= 0 && selectedIndex < results.length) {
					handleSelect(results[selectedIndex]);
				}
				break;
			case "Escape":
				setIsOpen(false);
				setSelectedIndex(-1);
				break;
		}
	};

	const handleSelect = (result: SearchResult) => {
		onSelect(result);
		setQuery(result.name);
		setIsOpen(false);
		setSelectedIndex(-1);
		setResults([]);
	};

	const handleInputFocus = () => {
		if (results.length > 0) {
			setIsOpen(true);
		}
	};

	const handleInputBlur = () => {
		// Delay closing to allow clicking on results
		setTimeout(() => setIsOpen(false), 200);
	};

	return (
		<div className={`relative ${className}`}>
			<input
				type="text"
				value={query}
				onChange={handleInputChange}
				onKeyDown={handleKeyDown}
				onFocus={handleInputFocus}
				onBlur={handleInputBlur}
				placeholder={placeholder}
				className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
			/>
			
			{isLoading && (
				<div className="absolute right-3 top-1/2 transform -translate-y-1/2">
					<div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
				</div>
			)}

			{isOpen && results.length > 0 && (
				<div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
					{results.map((result, index) => (
						<div
							key={result.id}
							onClick={() => handleSelect(result)}
							className={`px-4 py-2 cursor-pointer hover:bg-gray-100 ${
								index === selectedIndex ? "bg-blue-100" : ""
							}`}
						>
							<div className="font-medium text-gray-900">{result.name}</div>
							<div className="text-sm text-gray-600">{result.artist}</div>
							<div className="text-xs text-gray-500">{result.album}</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
