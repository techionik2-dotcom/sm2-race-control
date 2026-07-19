'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './context/AuthContext'

export default function Home() {
  const router = useRouter()
  const { user, loading, isOwner } = useAuth()

  useEffect(() => {
    // Wait for auth to finish loading
    if (loading) return

    if (user) {
      // Redirect to appropriate dashboard
      if (isOwner()) {
        router.push('/admin/users')
      } else {
        router.push('/events')
      }
    } else {
      router.push('/login')
    }
  }, [user, loading, isOwner, router])

  return null
}
