import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
        <span className="text-xl font-bold text-indigo-600">ApartmentBuddy.ai</span>
        <div className="flex gap-4">
          <Link href="/login" className="text-gray-600 hover:text-gray-900 px-4 py-2 text-sm font-medium">
            Log in
          </Link>
          <Link href="/signup" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            Get started free
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-8 pt-24 pb-16 text-center">
        <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-6">
          Find an apartment you'll<br />
          <span className="text-indigo-600">love for years</span>
        </h1>
        <p className="text-xl text-gray-500 mb-10 max-w-2xl mx-auto">
          Tell our AI what matters to you. We monitor Zillow, Apartments.com and more —
          scoring every new listing against your taste. You only see apartments worth seeing.
        </p>
        <Link href="/signup" className="inline-block bg-indigo-600 text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-indigo-700 shadow-lg shadow-indigo-200">
          Start your free search
        </Link>
        <p className="text-sm text-gray-400 mt-4">Free: 1 search · Pro: continuous monitoring</p>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-8 py-16">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">How it works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              step: '01',
              title: 'Tell us what you need',
              desc: 'Chat with our AI about your budget, must-haves, deal-breakers, and lifestyle. It remembers everything.'
            },
            {
              step: '02',
              title: 'We monitor listings for you',
              desc: 'Add neighborhoods to watch. We scrape new listings as they appear and score each one against your preferences.'
            },
            {
              step: '03',
              title: 'Only see the good ones',
              desc: 'Your feed shows listings ranked by match score. Save the best, dismiss the rest, and apply with confidence.'
            }
          ].map(item => (
            <div key={item.step} className="bg-gray-50 rounded-2xl p-6">
              <div className="text-4xl font-black text-indigo-100 mb-3">{item.step}</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-4xl mx-auto px-8 py-16">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">Pricing</h2>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="border border-gray-200 rounded-2xl p-8">
            <h3 className="text-xl font-bold text-gray-900 mb-1">Free</h3>
            <p className="text-4xl font-black text-gray-900 mb-4">$0</p>
            <ul className="space-y-3 text-sm text-gray-600 mb-8">
              <li>✓ AI preference conversation</li>
              <li>✓ 1 one-time search + scoring</li>
              <li>✓ Up to 50 listings analyzed</li>
            </ul>
            <Link href="/signup" className="block text-center border border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:border-gray-400">
              Get started
            </Link>
          </div>
          <div className="bg-indigo-600 rounded-2xl p-8 text-white">
            <h3 className="text-xl font-bold mb-1">Pro</h3>
            <p className="text-4xl font-black mb-4">$29<span className="text-lg font-normal opacity-70">/mo</span></p>
            <ul className="space-y-3 text-sm opacity-90 mb-8">
              <li>✓ Everything in Free</li>
              <li>✓ Continuous monitoring (checks every 6h)</li>
              <li>✓ Email alerts for top matches</li>
              <li>✓ Unlimited neighborhoods</li>
              <li>✓ Saved listing history</li>
            </ul>
            <Link href="/signup?plan=pro" className="block text-center bg-white text-indigo-600 px-6 py-3 rounded-lg font-medium hover:bg-indigo-50">
              Start Pro
            </Link>
          </div>
        </div>
      </section>

      <footer className="text-center text-sm text-gray-400 py-8 border-t border-gray-100">
        © {new Date().getFullYear()} ApartmentBuddy.ai
      </footer>
    </div>
  )
}
