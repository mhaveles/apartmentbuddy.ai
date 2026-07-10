import Link from 'next/link'

export function CtaButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="my-8">
      <Link
        href={href}
        className="inline-block bg-indigo-600 !text-white !no-underline px-6 py-3 rounded-lg font-semibold hover:bg-indigo-700 hover:!text-white transition-colors"
      >
        {children}
      </Link>
    </p>
  )
}
