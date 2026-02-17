import Link from 'next/link'

import { Prose } from '@/components/Prose'
import { getRelatedPosts } from '@/lib/blog'

interface RelatedPostsProps {
  slug: string
}

export function RelatedPosts({ slug }: RelatedPostsProps) {
  const related = getRelatedPosts(slug)

  if (related.length === 0) {
    return null
  }

  return (
    <Prose>
      <hr />
      <h2>Related</h2>
      <ul>
        {related.map((post) => (
          <li key={post.slug}>
            <strong>
              <Link href={`/blog/${post.slug}`}>{post.title}</Link>
            </strong>
            {' '}&ndash; {post.description}
          </li>
        ))}
      </ul>
    </Prose>
  )
}
