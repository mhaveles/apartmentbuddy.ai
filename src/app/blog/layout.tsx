import Link from 'next/link'

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
        <Link href="/" className="text-xl font-bold text-indigo-600">
          ApartmentBuddy.ai
        </Link>
        <div className="flex gap-4">
          <Link href="/login" className="text-gray-600 hover:text-gray-900 px-4 py-2 text-sm font-medium">
            Log in
          </Link>
          <Link href="/#chat" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            Get started free
          </Link>
        </div>
      </nav>

      {children}

      <footer className="text-center text-sm text-gray-400 py-8 border-t border-gray-100">
        © {new Date().getFullYear()} ApartmentBuddy.ai
      </footer>
    </div>
  )
}
