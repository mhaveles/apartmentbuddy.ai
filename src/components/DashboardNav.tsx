'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface Props {
  plan: string
  email: string
}

export default function DashboardNav({ plan, email }: Props) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/chat', label: 'My Preferences' },
    { href: '/neighborhoods', label: 'Neighborhoods' },
    { href: '/listings', label: 'Listings' },
  ]

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-bold text-indigo-600">
            ApartmentBuddy.ai
          </Link>
          <div className="flex gap-1">
            {links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${
                  pathname === link.href
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {plan === 'free' && (
            <Link
              href="/upgrade"
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-md text-xs font-medium hover:bg-indigo-700"
            >
              Upgrade to Pro
            </Link>
          )}
          {plan === 'pro' && (
            <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-semibold">PRO</span>
          )}
          <span className="text-sm text-gray-500 hidden md:block">{email}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  )
}
