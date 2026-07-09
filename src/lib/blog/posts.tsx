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
  {
    slug: 'what-actually-makes-people-happy-where-they-live',
    title: 'What Actually Makes People Happy Where They Live',
    description:
      "Square footage and granite countertops barely move the needle on happiness. Commute time, light, noise control, and proximity to people you love do. Here's what the research actually shows.",
    publishedAt: '2026-07-09',
    author: 'Jordan',
    content: (
      <>
        <p>
          Quick answer: it&rsquo;s rarely the thing on the listing. Square footage, granite countertops, and a fancy
          lobby barely move the needle on how happy you actually are at home. What does move it: your commute, how
          much control you have over your daily routine, how much natural light you get, and whether the people you
          care about are close enough to actually see.
        </p>
        <p>
          Most apartment listings sell you the wrong things because the wrong things are easy to photograph. A
          kitchen island photographs well. A twelve-minute commute does not. But researchers who study daily
          wellbeing consistently find that commute time is one of the strongest predictors of how good or bad a
          person&rsquo;s day feels, and it&rsquo;s one of the few things people reliably regret after they move
          somewhere for other reasons.
        </p>

        <h2>The stuff that actually matters, based on what tends to hold up</h2>
        <p>
          <strong>Commute time, more than commute distance,</strong> if you commute at all. Fifteen minutes on a quiet
          train and fifteen minutes in stop-and-go traffic are not the same fifteen minutes. It&rsquo;s not really
          about miles, it&rsquo;s about how much of your day gets swallowed by getting somewhere, and how much stress
          is baked into that time. If you work remotely and don&rsquo;t commute, this factor mostly disappears, but
          something else tends to take its place: the quality of your home workspace, and whether you have an easy
          walk to a coffee shop or a park that breaks up the day. Remote workers who never leave the apartment tend
          to report lower satisfaction than remote workers who have somewhere easy to go.
        </p>
        <p>
          <strong>Greenspace and walkability.</strong> Living near a real park, not just a patch of grass, and being
          able to walk to daily errands without needing a car, both show up again and again as high-impact factors.
          It&rsquo;s not just exercise or convenience, it&rsquo;s the difference between a day that feels boxed in
          and one that doesn&rsquo;t.
        </p>
        <p>
          <strong>Light.</strong> Not a &ldquo;nice to have,&rdquo; a real factor. Apartments with real daylight
          consistently score better on how people feel day to day than apartments without it, even when everything
          else is equal. If a unit feels dim in the listing photos, it will feel dim every single morning you live
          there.
        </p>
        <p>
          <strong>Noise, and whether you control it.</strong> A loud street outside your window is very different
          from a loud street you chose because you wanted to be near the action. The noise itself matters less than
          whether it was your call.
        </p>
        <p>
          <strong>Proximity to people you actually like.</strong> Not just &ldquo;is there a social scene
          nearby,&rdquo; but specifically: are the people you&rsquo;d want to see on a random Tuesday close enough
          that seeing them is easy? Distance quietly kills more friendships than any falling out does.
        </p>
        <p>
          <strong>A routine you can actually keep.</strong> If your gym, your coffee spot, your errands, or your
          commute all require real effort, that effort adds up and starts feeling like friction against your own
          life. The best living situations make the boring parts of your day easier, not harder.
        </p>

        <h2>The stuff that matters less than people think</h2>
        <p>
          A big kitchen if you don&rsquo;t really cook. A rooftop deck you&rsquo;ll use four times a year. A trendy
          neighborhood if you&rsquo;re not actually going to go out much. None of these are bad, they&rsquo;re just
          often mistaken for the thing that will make you happy, when the thing that actually does is quieter and
          less photogenic.
        </p>

        <h2>There&rsquo;s no universal answer here, and that&rsquo;s the point</h2>
        <p>
          Someone who works from home and rarely leaves the neighborhood should weight light and quiet heavily and
          barely think about nightlife. Someone whose whole life happens outside the apartment should weight
          location and walkability over the apartment itself. Neither is wrong. The mistake is picking a place based
          on what&rsquo;s supposed to make people happy instead of what actually makes you happy.
        </p>
        <p>
          Before you start searching, it&rsquo;s worth spending ten honest minutes on this: think about a time you
          felt genuinely good about where you lived, and a time you didn&rsquo;t. What was actually different?
          Usually it&rsquo;s not the finishes. It&rsquo;s the commute, the light, the noise, or how close you were to
          the people who mattered.
        </p>
        <p>
          This is exactly what we ask you about before we start scoring listings. Not because we&rsquo;re being
          nosy, but because the things that predict whether you&rsquo;ll actually be happy somewhere are rarely the
          things listing sites let you filter by.
        </p>
        <p>
          <a href="/#chat">Tell us what actually matters to you →</a>
        </p>

        <h2>FAQ</h2>
        <h3>What factors actually predict happiness in a living situation?</h3>
        <p>
          Commute time, access to natural light, control over noise levels, and proximity to people you care about
          tend to matter more than apartment size or finishes. These factors show up consistently in daily wellbeing
          research, even though they&rsquo;re rarely what listings highlight.
        </p>

        <h3>Does apartment size affect happiness?</h3>
        <p>
          Less than most people expect. Once a space is large enough to comfortably live in, additional square
          footage has a much smaller effect on daily satisfaction than factors like commute time or noise control.
        </p>

        <h3>Why does commute time matter so much for happiness?</h3>
        <p>
          Commute time eats directly into the hours you&rsquo;d otherwise spend on things you enjoy, and stressful
          commutes add a daily dose of frustration that compounds over time. Short, low-stress commutes are one of
          the most consistent predictors of a better day-to-day mood. For remote workers without a commute, the
          quality of the home workspace and easy access to a walkable third space, like a coffee shop or park, tend
          to matter more instead.
        </p>

        <h3>Do greenspace and walkability actually affect happiness?</h3>
        <p>
          Yes, consistently. Living near real greenspace and being able to walk to daily errands without a car are
          two of the higher-impact factors in how people feel about where they live, on top of anything related to
          the apartment itself.
        </p>

        <h3>Is there a single best type of apartment or neighborhood for happiness?</h3>
        <p>
          No. What makes someone happy depends on how they actually live, whether their life happens mostly inside
          the apartment or mostly outside it, how social they are, and what their daily routine looks like. The
          right fit is personal, not universal.
        </p>
      </>
    ),
  },
  {
    slug: 'moving-somewhere-youve-never-been-how-to-prepare',
    title: "Moving Somewhere You've Never Been: How to Actually Prepare",
    description:
      "Preparing for a city you've never lived in comes down to one split: gather the facts that translate from a screen, and get the rest from people who actually live there.",
    publishedAt: '2026-07-09',
    author: 'Jordan',
    content: (
      <>
        <p>
          Preparing for a city you&rsquo;ve never lived in comes down to one split: gather the facts that translate
          from a screen, and get the rest from people who actually live there. Price per square foot, commute times,
          walk scores, you can pull those from a laptop. What a block feels like at 9pm on a Tuesday, you can&rsquo;t.
        </p>
        <p>
          This is different from picking a neighborhood in a city you already know. You&rsquo;re not choosing
          between two places you can picture. You&rsquo;re choosing based on photos, forum posts, and a map
          you&rsquo;ve stared at more than you&rsquo;d like to admit. That&rsquo;s a harder problem, and it deserves
          a different process than &ldquo;just look around.&rdquo;
        </p>

        <h2>Separate What You Can Research From What You Can&rsquo;t</h2>
        <p>
          Some things translate fine from a screen. Commute times, price per square foot, crime stats, walk scores.
          Pull these first because they&rsquo;re hard to get wrong. A 40-minute commute reads the same on paper
          whether you&rsquo;re in Denver or Detroit.
        </p>
        <p>
          Other things don&rsquo;t translate at all. What a neighborhood feels like at 9pm on a Tuesday. Whether the
          &ldquo;up and coming&rdquo; label in a listing means five years out or fifty. Whether the noise from the
          bar downstairs is charming or exhausting after the third week. These are the things people usually get
          wrong when they move somewhere new, not because they didn&rsquo;t research, but because some information
          only exists in person.
        </p>
        <p>
          Know which bucket you&rsquo;re in before you make a decision. If you&rsquo;re treating a feel-based unknown
          like a fact you already have, that&rsquo;s where the bad surprises come from.
        </p>

        <h2>Use People Who Live There, Not Just Listings</h2>
        <p>
          Local subreddits, city-specific Facebook groups, and even a few cold DMs to people who post about the city
          will tell you things no listing will. Ask specific questions, not &ldquo;is this a good area.&rdquo; Ask
          what people specifically complain about. Ask where they&rsquo;d tell a friend not to live, and why. The
          &ldquo;why&rdquo; is where the useful information lives.
        </p>
        <p>
          If you have any real connection to the city, even a former coworker who moved there two years ago, use it.
          One 15-minute call from someone with no reason to sell you on the place is worth more than an hour of
          scrolling listing photos.
        </p>

        <h2>Decide What You&rsquo;re Actually Optimizing For</h2>
        <p>
          Some people are optimizing for speed because speed is genuinely what matters most right now, whether
          it&rsquo;s a job start date, a lease end date, or a school semester. If that&rsquo;s you, don&rsquo;t
          punish yourself for not doing the six-week deep dive. Pick a reasonable, safe-enough option and plan to
          move again in a year if it&rsquo;s wrong. That&rsquo;s a real strategy, not a consolation prize, the same
          logic that applies to picking speed over specificity in any apartment search.
        </p>
        <p>
          With more runway, the calculation changes. You can afford to wait for the right listing instead of the
          available one. The people with the most regret are usually the ones who had time to be picky and
          didn&rsquo;t use it, not the ones who had no choice.
        </p>

        <h2>Know Your Own Non-Negotiables Before You Land</h2>
        <p>
          This matters more when you&rsquo;re new to a city, not less. When you already know a place, you can
          course-correct on the fly because you have context. When you don&rsquo;t, you&rsquo;re making decisions
          blind, and vague preferences turn into bad ones fast. &ldquo;I want somewhere nice&rdquo; doesn&rsquo;t
          help you when you can&rsquo;t picture what nice means in a city you&rsquo;ve never lived in. &ldquo;I want
          a grocery store within a 10-minute walk&rdquo; and &ldquo;I need parking, not just street permits&rdquo;
          are decisions you can actually act on, because they don&rsquo;t require you to know the city, just
          yourself.
        </p>
        <p>
          Write these down before you start looking. It&rsquo;s tempting to build your list of priorities from what
          you&rsquo;re seeing in listings, but that means the listings are choosing your preferences for you instead
          of the other way around.
        </p>

        <h2>A Rough Order of Operations</h2>
        <ol>
          <li>Nail down the hard constraints first: budget ceiling, commute limits, must-have building features.</li>
          <li>Research the facts that translate from a screen: price per square foot, transit access, general safety data.</li>
          <li>Talk to actual residents about the things that don&rsquo;t translate: noise, vibe, day-to-day annoyances.</li>
          <li>Decide whether you&rsquo;re optimizing for speed or fit, and let that decide how long you spend on step 3.</li>
          <li>Lock in your non-negotiables in writing before you start seriously looking at units.</li>
        </ol>

        <h2>FAQ</h2>
        <h3>How do I find a good neighborhood in a city I&rsquo;ve never visited?</h3>
        <p>
          Split your research into facts that translate from a screen, like commute times and price per square foot,
          and things that only make sense in person, like noise and neighborhood feel. Get the facts online, then
          ask people who actually live there about the rest.
        </p>

        <h3>Is it a bad idea to move somewhere sight unseen?</h3>
        <p>
          Not necessarily. It&rsquo;s a real constraint for a lot of relocations, especially on a tight timeline. The
          risk isn&rsquo;t moving sight unseen, it&rsquo;s moving without doing the research that doesn&rsquo;t
          require seeing it in person.
        </p>

        <h3>How far in advance should I start researching a new city before moving?</h3>
        <p>
          As early as your timeline allows. Facts and data take almost no lead time to gather. Talking to real
          residents and getting honest answers takes longer, so start that part first if you can.
        </p>

        <h3>What should I ask people who already live in the city I&rsquo;m moving to?</h3>
        <p>
          Ask what they&rsquo;d tell a friend not to do, not just what they&rsquo;d recommend. Specific complaints
          are more useful than general praise because they tell you what to watch for.
        </p>

        <h3>Should I pick a neighborhood or just pick any apartment and figure it out later?</h3>
        <p>
          That depends on what you&rsquo;re optimizing for. If you&rsquo;re on a tight deadline, picking a
          safe-enough option and reassessing after a year is a legitimate approach. If you have more time,
          it&rsquo;s usually worth waiting for the right fit.
        </p>

        <p>
          You&rsquo;ve only got so much time before you land, and most of it should go to the stuff you can&rsquo;t
          get from a screen. ApartmentBuddy handles the part that does translate, pulling price, commute, and walk
          data into ranked results, so the hours you do have go toward finding out what the neighborhood actually
          feels like.
        </p>
        <p>
          <a href="/#chat">Tell us what you&rsquo;re looking for →</a>
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
