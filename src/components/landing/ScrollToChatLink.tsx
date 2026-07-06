'use client'

export default function ScrollToChatLink({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    document.getElementById('chat-input')?.focus({ preventScroll: true })
  }

  return (
    <a href="#chat" onClick={handleClick} className={className}>
      {children}
    </a>
  )
}
