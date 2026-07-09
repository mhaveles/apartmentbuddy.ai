import type { ReactNode } from 'react'

export interface BlogPost {
  slug: string
  title: string
  description: string
  publishedAt: string
  author?: string
  content: ReactNode
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'ill-take-anything-worst-apartment-search-strategy',
    title: 'Why "I\'ll Take Anything" Is the Worst Apartment Search Strategy',
    description:
      'Vague preferences don\'t get you more apartment options, they get you worse ones. Here\'s why naming your real non-negotiables is what actually speeds up your search.',
    publishedAt: '2026-07-09',
    author: 'Jordan',
    content: (
      <>
        <p>
          Somewhere along the way, &ldquo;I&rsquo;m easy, I&rsquo;ll take whatever&rdquo; became the polite thing to
          say when you&rsquo;re apartment hunting. It sounds low-maintenance. It sounds flexible. Often it just means
          your search drags on for weeks and ends with an apartment you don&rsquo;t actually like.
        </p>
        <p>
          Here&rsquo;s the thing nobody tells you: vague preferences don&rsquo;t get you more options. They get you
          worse ones. &ldquo;Somewhere nice, not too expensive&rdquo; isn&rsquo;t a filter. It&rsquo;s the absence of
          one. Without a filter, you end up scrolling the same fifty listings over and over, unable to tell which
          ones are actually good, because you never decided what &ldquo;good&rdquo; means for you.
        </p>

        <h2>There&rsquo;s no such thing as the best apartment</h2>
        <p>
          Just the one that&rsquo;s right for you, right now. A great apartment for someone who works from home and
          wants total quiet is a bad apartment for someone who wants to be three blocks from the bars. A great
          apartment for someone with a dog is a bad one for someone allergic to dander from four floors of previous
          tenants. Neither person is wrong. They just need different things, and pretending otherwise is how you end
          up somewhere that technically works and never quite feels like home.
        </p>
        <p>
          The people who find apartments they actually love are the ones who can finish this sentence without
          hedging: &ldquo;I need ___, and I will not compromise on it.&rdquo; Maybe it&rsquo;s natural light. Maybe
          it&rsquo;s a short commute. Maybe it&rsquo;s genuinely just laundry in the unit, because you&rsquo;re done
          hauling quarters to a basement. Whatever it is, name it.
        </p>

        <h2>Flexible isn&rsquo;t always wrong, it&rsquo;s just usually a different goal</h2>
        <p>
          To be fair, being flexible is a real strategy, not a mistake. If your only priority is speed, saying yes to
          the first decent place can get you signed in two days instead of five weeks. There&rsquo;s nothing wrong
          with that when speed is genuinely what you need.
        </p>
        <p>
          But most people saying &ldquo;I&rsquo;ll take anything&rdquo; aren&rsquo;t actually optimizing for speed.
          They&rsquo;re avoiding the work of figuring out what they want. And that&rsquo;s the false choice worth
          catching: fast versus picky. What if you didn&rsquo;t have to choose? If you know your real preferences
          going in, you can see the best matches in your price range immediately, not after five weeks of scrolling.
          Speed and having standards aren&rsquo;t actually opposites. Vague preferences are just slow no matter which
          one you were hoping for.
        </p>

        <h2>Why &ldquo;I&rsquo;ll take anything&rdquo; backfires</h2>
        <p>
          Being open-minded about a city, a budget range, or a neighborhood you don&rsquo;t know yet is smart. Being
          vague about what you actually need day to day is not flexibility, it&rsquo;s just not having done the work
          yet.
        </p>
        <p>
          The paradox is that specific people search faster. If you know you need in-unit laundry, no ground floor,
          and a kitchen you can actually cook in, you can eliminate most listings in five minutes and spend your
          energy on the ones that matter. If you&rsquo;re &ldquo;open to anything,&rdquo; you have to fully evaluate
          every single listing, because you haven&rsquo;t told yourself, or anyone helping you, what to rule out.
        </p>

        <h2>How to actually find your non-negotiables</h2>
        <p>You probably already know them. You&rsquo;re just not used to saying them out loud. Try this:</p>
        <ol>
          <li>
            Think about the last place you lived that you didn&rsquo;t like. What specifically bugged you? Not
            enough light? Too far from everything? Noisy walls? That&rsquo;s a non-negotiable, now named.
          </li>
          <li>
            Think about the best living situation you&rsquo;ve ever had, even a college dorm, even a friend&rsquo;s
            guest room. What made it good? Steal that.
          </li>
          <li>
            Separate &ldquo;nice to have&rdquo; from &ldquo;actually matters.&rdquo; A rooftop deck is nice. A
            kitchen you can cook a real meal in might actually matter, if cooking is part of your life. Be honest
            about which is which.
          </li>
          <li>
            Say the budget number out loud, and mean it. Not the number you hope you&rsquo;ll find something under,
            the number you&rsquo;re actually willing to pay. Vague budgets produce vague searches.
          </li>
        </ol>

        <h2>The upside of having opinions</h2>
        <p>
          Once you know what you actually want, apartment hunting stops being exhausting. You&rsquo;re not evaluating
          everything, you&rsquo;re scanning for the handful of things you decided matter, and ignoring the noise.
          It&rsquo;s faster, it&rsquo;s less draining, and you end up somewhere that fits instead of somewhere that
          was merely available.
        </p>
        <p>
          This is also exactly how we built ApartmentBuddy to work. Tell us your real preferences, not &ldquo;somewhere
          nice&rdquo; but the specific stuff that actually matters to you, and we&rsquo;ll score every listing against
          it and tell you why. The clearer you are with us, the better we can do our job. Vague in, vague out.
          Specific in, a place you actually love out.
        </p>
        <p>
          <a href="/#chat">Tell us what you actually want →</a>
        </p>

        <h2>FAQ</h2>
        <h3>Is it better to be flexible or picky when apartment hunting?</h3>
        <p>
          It depends on your goal. Flexibility can get you into a place faster, sometimes in a couple of days instead
          of a couple of months. Being specific about your preferences gets you a place you actually like, and with
          the right tool, doesn&rsquo;t have to cost you speed either.
        </p>

        <h3>What should I do if I don&rsquo;t know what I want in an apartment?</h3>
        <p>
          Look backward instead of forward. Think about the last place you lived that bothered you, and name exactly
          what it was. Then think about the best living situation you&rsquo;ve ever had, even briefly, and name what
          made it good. That&rsquo;s usually your real preference list.
        </p>

        <h3>What&rsquo;s the difference between a &ldquo;nice to have&rdquo; and a real preference?</h3>
        <p>
          A nice to have is something you&rsquo;d enjoy but could live without, like a rooftop deck. A real
          preference is something that affects your daily life if it&rsquo;s missing, like natural light, commute
          length, or in-unit laundry. Sort your list into those two buckets before you start searching.
        </p>

        <h3>Why do vague apartment preferences lead to a worse search?</h3>
        <p>
          Without specific criteria, every listing has to be fully evaluated instead of quickly ruled in or out. That
          means more time spent, more decision fatigue, and a higher chance of settling on something that was simply
          available rather than something that fits.
        </p>

        <h3>Does having strong apartment preferences slow down my search?</h3>
        <p>
          No, usually the opposite. Knowing exactly what you want lets you filter out most listings immediately and
          focus only on the ones worth real consideration.
        </p>
      </>
    ),
  },
]

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug)
}

export function getSortedBlogPosts(): BlogPost[] {
  return [...blogPosts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
