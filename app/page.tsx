import { RunForm } from "@/components/run-form";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_transparent_28%),linear-gradient(180deg,_#0b0d12_0%,_#0b0d12_100%)] px-6 py-10">
      <div className="mx-auto max-w-7xl">
        <RunForm />
      </div>
    </main>
  );
}
