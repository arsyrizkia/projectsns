import Link from "next/link";
import { LEGAL_ENTITY, PRODUCT_NAME } from "./_meta";

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-1 flex-col px-6 py-12">
      <header className="mb-8 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← {PRODUCT_NAME}
        </Link>
      </header>

      <article
        className="
          flex-1
          [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold
          [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold
          [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-medium
          [&_p]:my-3 [&_p]:text-sm [&_p]:leading-6 [&_p]:text-zinc-700 dark:[&_p]:text-zinc-300
          [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6 [&_ul]:text-sm [&_ul]:leading-6 [&_ul]:text-zinc-700 dark:[&_ul]:text-zinc-300
          [&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400
          [&_strong]:font-semibold [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100
        "
      >
        {children}
      </article>

      <footer className="mt-12 flex items-center gap-4 border-t border-zinc-200 pt-4 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <Link href="/privacy" className="hover:text-zinc-800 dark:hover:text-zinc-200">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-zinc-800 dark:hover:text-zinc-200">
          Terms of Service
        </Link>
        <span className="ml-auto text-xs">© 2026 {LEGAL_ENTITY}</span>
      </footer>
    </div>
  );
}
