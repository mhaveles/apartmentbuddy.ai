import Link from 'next/link'
import type { Metadata } from 'next'
import { getSortedBlogPosts } from '@/lib/blog/posts'

export const metadata: Metadata = {
  title: 'Blog — ApartmentBuddy.ai',
  description: 'Guides and insights on apartment hunting, rental markets, and finding your next home faster.',
  alternates: { canonical: '/blog' },
}

export default function BlogIndexPage() {
  const posts = getSortedBlogPosts()

  return (
    <main className="max-w-3xl mx-auto px-8 py-16">
      <h1 className="text-4xl font-bold text-gray-900 mb-10">Blog</h1>

      {posts.length === 0 ? (
        <p className="text-gray-500">No posts yet — check back soon.</p>
      ) : (
        <ul className="space-y-8">
          {posts.map((post) => (
            <li key={post.slug} className="border-b border-gray-100 pb-8">
              <Link href={`/blog/${post.slug}`} className="group">
                <h2 className="text-2xl font-semibold text-gray-900 group-hover:text-indigo-600">
                  {post.title}
                </h2>
              </Link>
              <p className="text-sm text-gray-400 mt-1 mb-2">{post.publishedAt}</p>
              <p className="text-gray-600">{post.description}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
