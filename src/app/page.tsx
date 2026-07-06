import Link from 'next/link'
import LandingChat from '@/components/landing/LandingChat'
import ScrollToChatLink from '@/components/landing/ScrollToChatLink'

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
          <a href="#chat" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            Get started free
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-8 pt-24 pb-16 text-center">
        <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-6">
          The best apartments go to people who refresh Zillow{' '}
          <span className="text-indigo-600">50 times a day.</span>
        </h1>
        <p className="text-xl text-gray-700 mb-6 max-w-2xl mx-auto font-medium">
          Now you have a buddy that will do that for you.
        </p>
        <p className="text-lg text-gray-500 mb-10 max-w-2xl mx-auto">
          ApartmentBuddy watches every new listing across Zillow, Craigslist, Trulia, and more — then scores each one
          against what actually matters to you. You only see apartments worth your time.
        </p>
        <ScrollToChatLink className="inline-block bg-indigo-600 text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-indigo-700 shadow-lg shadow-indigo-200">
          Tell us what you want
        </ScrollToChatLink>
        <p className="text-sm text-gray-400 mt-4">3 free searches. No credit card required.</p>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-8 py-16">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">How it works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              step: '01',
              title: 'Tell us what you want',
              desc: 'Chat with our AI for 2 minutes. Budget, location, must-haves, deal-breakers. That’s it.'
            },
            {
              step: '02',
              title: 'We scan everything',
              desc: 'We search Zillow, Craigslist, Trulia, and more — then score every one against your taste.'
            },
            {
              step: '03',
              title: 'You only see the good ones',
              desc: 'Ranked results with match scores. Save the best, skip the rest, apply with confidence.'
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

      {/* Chat widget */}
      <section id="chat" className="max-w-5xl mx-auto px-8 py-16 scroll-mt-8">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-4">Tell us what you want</h2>
        <p className="text-gray-500 text-center mb-10">No login required to get started.</p>
        <LandingChat />
      </section>

      <footer className="text-center text-sm text-gray-400 py-8 border-t border-gray-100">
        © {new Date().getFullYear()} ApartmentBuddy.ai
      </footer>
    </div>
  )
}
