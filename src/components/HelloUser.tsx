"use client";
import { useEffect, useState } from "react";

export function HelloUser() {
	const [name, setName] = useState<string | null>(null);
	useEffect(() => {
		(async () => {
			const res = await fetch("/api/me");
			if (res.ok) {
				const json = await res.json();
				setName(json.display_name ?? json.id ?? "");
			}
		})();
	}, []);
	if (!name) return null;
	return (
		<div className="fixed top-4 right-4 z-50 bg-white/10 text-white border border-white/20 rounded-full px-4 py-2 backdrop-blur-md shadow-xl">
			Hello, {name}
		</div>
	);
}


