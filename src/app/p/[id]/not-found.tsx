export default function PasteNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <p className="max-w-md text-center text-sm text-[var(--fg-muted)]">
        This paste does not exist, or it expired and was deleted.
      </p>
    </main>
  );
}
