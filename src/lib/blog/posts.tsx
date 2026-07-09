import type { ReactNode } from 'react'

export interface BlogPost {
  slug: string
  title: string
  description: string
  publishedAt: string
  content: ReactNode
}

export const blogPosts: BlogPost[] = []

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug)
}

export function getSortedBlogPosts(): BlogPost[] {
  return [...blogPosts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}
