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
	return <p className="text-xl">Hello, {name}</p>;
}


