import { AuthButton } from "@/components/AuthButton";
import { HelloUser } from "@/components/HelloUser";
import { GuessifyGame } from "@/components/PlayTestClip";

export default function Home() {
  return (
    <div className="font-sans min-h-screen w-full bg-black">
      {/* Top bar */}
      <div className="fixed top-4 left-4 z-50">
        <AuthButton />
      </div>

      <main className="flex flex-col gap-8 items-center w-full">
        {/* Header */}
        <div className="w-full pt-16 text-center select-none">
          <h1 className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-emerald-400 via-sky-400 to-fuchsia-400 bg-clip-text text-transparent tracking-tight inline-block animate-pulse">
            Guessify
          </h1>
          <p className="mt-2 text-gray-300 text-lg">Test your music memory with your Spotify likes!</p>
        </div>

        {/* Game */}
        <div className="w-full">
          <div className="w-full">
            <HelloUser />
            <GuessifyGame />
          </div>
        </div>
      </main>
    </div>
  );
}
