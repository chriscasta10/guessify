"use client";
import { useEffect, useState } from "react";

export function AuthButton() {
	const [isAuthed, setIsAuthed] = useState<boolean>(false);
	useEffect(() => {
		(async () => {
			try {
				const res = await fetch("/api/me", { cache: "no-store" });
				setIsAuthed(res.ok);
			} catch {
				setIsAuthed(false);
			}
		})();
	}, []);

	const onLogin = () => {
		window.location.href = "/api/auth/login";
	};
	const onLogout = async () => {
		await fetch("/api/auth/logout", { method: "POST" });
		window.location.href = "/";
	};

	if (isAuthed) {
		return (
			<button
				onClick={onLogout}
				className="rounded-full px-4 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 shadow-xl backdrop-blur-md transition-colors"
			>
				Logout
			</button>
		);
	}

	return (
		<div className="flex justify-center">
			<button onClick={onLogin} className="rounded-full bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 shadow-lg transition-colors">
				Login with Spotify
			</button>
		</div>
	);
}


