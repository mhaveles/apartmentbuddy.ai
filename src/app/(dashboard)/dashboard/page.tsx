import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: profile }, { data: preferences }, { data: neighborhoods }, { data: recentListings }, { data: searchRuns }] =
    await Promise.all([
      supabase.from('profiles').select('*').eq('id', user!.id).single(),
      supabase.from('preferences').select('summary').eq('user_id', user!.id).single(),
      supabase.from('monitored_neighborhoods').select('*').eq('user_id', user!.id).eq('active', true),
      supabase
        .from('user_listings')
        .select('*, listing:listings(*)')
        .eq('user_id', user!.id)
        .eq('is_dismissed', false)
        .order('score', { ascending: false })
        .limit(3),
      supabase
        .from('search_runs')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(1),
    ])

  const lastRun = searchRuns?.[0]
  const hasPreferences = !!preferences?.summary
  const hasNeighborhoods = (neighborhoods?.length || 0) > 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Your apartment search at a glance.</p>
      </div>

      {/* Setup checklist */}
      {(!hasPreferences || !hasNeighborhoods) && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5">
          <h2 className="font-semibold text-indigo-900 mb-3">Get started</h2>
          <div className="space-y-2">
            <SetupStep
              done={hasPreferences}
              label="Tell us your preferences"
              action={{ href: '/chat', text: 'Start chat' }}
            />
            <SetupStep
              done={hasNeighborhoods}
              label="Add neighborhoods to monitor"
              action={{ href: '/neighborhoods', text: 'Add neighborhoods' }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Neighborhoods" value={neighborhoods?.length || 0} />
        <StatCard label="Listings found" value={recentListings?.length || 0} />
        <StatCard
          label="Plan"
          value={profile?.plan === 'pro' ? 'Pro' : 'Free'}
          sub={profile?.plan === 'free' ? `${profile.searches_used}/1 searches used` : 'Continuous monitoring'}
        />
      </div>

      {/* Preferences summary */}
      {preferences?.summary && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex justify-between items-start">
            <h2 className="font-semibold text-gray-900 mb-2">Your preferences</h2>
            <Link href="/chat" className="text-xs text-indigo-600 hover:underline">Edit</Link>
          </div>
          <p className="text-sm text-gray-600 leading-relaxed">{preferences.summary}</p>
        </div>
      )}

      {/* Last search run */}
      {lastRun && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-semibold text-gray-900 mb-2">Last search</h2>
          <div className="flex items-center gap-3">
            <StatusBadge status={lastRun.status} />
            <span className="text-sm text-gray-500">
              {lastRun.listings_scored} listings scored · {new Date(lastRun.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {/* Top listings preview */}
      {(recentListings?.length || 0) > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-900">Top matches</h2>
            <Link href="/listings" className="text-xs text-indigo-600 hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {recentListings!.map((ul: Record<string, unknown>) => {
              const listing = ul.listing as Record<string, unknown>
              return (
                <div key={String(ul.id)} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{String(listing?.address || listing?.title || 'Listing')}</p>
                    <p className="text-xs text-gray-500">
                      ${((Number(listing?.rent) || 0) / 100).toLocaleString()}/mo · {String(listing?.bedrooms ?? '')}bd {String(listing?.bathrooms ?? '')}ba
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={Number(ul.score)} />
                    <a href={String(listing?.url || '#')} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:underline">View</a>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Run search CTA */}
      {hasPreferences && hasNeighborhoods && (
        <RunSearchButton plan={profile?.plan || 'free'} searchesUsed={profile?.searches_used || 0} />
      )}
    </div>
  )
}

function SetupStep({ done, label, action }: { done: boolean; label: string; action: { href: string; text: string } }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${done ? 'bg-green-500 text-white' : 'bg-white border-2 border-indigo-300 text-indigo-400'}`}>
        {done ? '✓' : ''}
      </span>
      <span className={`text-sm ${done ? 'text-gray-400 line-through' : 'text-indigo-800'}`}>{label}</span>
      {!done && (
        <Link href={action.href} className="text-xs text-indigo-600 font-medium hover:underline ml-auto">{action.text} →</Link>
      )}
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-yellow-100 text-yellow-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] || colors.pending}`}>
      {status}
    </span>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-100 text-green-700' : score >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${color}`}>{score}</span>
  )
}

function RunSearchButton({ plan, searchesUsed }: { plan: string; searchesUsed: number }) {
  const canSearch = plan === 'pro' || searchesUsed < 1
  if (!canSearch) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between">
      <div>
        <p className="font-semibold text-amber-900">Free search used</p>
        <p className="text-sm text-amber-700">Upgrade to Pro for continuous monitoring</p>
      </div>
      <Link href="/upgrade" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
        Upgrade
      </Link>
    </div>
  )
  return (
    <Link href="/listings" className="block">
      <div className="bg-indigo-600 text-white rounded-xl p-5 flex items-center justify-between cursor-pointer hover:bg-indigo-700">
        <div>
          <p className="font-semibold">Run a search</p>
          <p className="text-sm opacity-75">Scrape and score new listings now</p>
        </div>
        <span className="text-2xl">→</span>
      </div>
    </Link>
  )
}
