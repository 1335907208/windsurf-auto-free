'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface EmailCardProps {
  email: string
  onRefresh: () => void
  onNewEmail: () => void
  loading: boolean
  expiresIn?: number
}

export function EmailCard({ email, onRefresh, onNewEmail, loading, expiresIn }: EmailCardProps) {
  const [copied, setCopied] = useState(false)

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          临时邮箱
        </h2>
        {expiresIn !== undefined && expiresIn > 0 && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            有效期: {formatTime(expiresIn)}
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex-1 bg-zinc-100 dark:bg-zinc-700 rounded-lg px-4 py-3 font-mono text-sm text-zinc-900 dark:text-zinc-100 break-all">
          {email || '加载中...'}
        </div>
        <Button
          onClick={copyEmail}
          disabled={!email}
          variant="outline"
          className="shrink-0"
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>

      <div className="flex gap-2 mt-4">
        <Button
          onClick={onRefresh}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          刷新邮件
        </Button>
        <Button
          onClick={onNewEmail}
          disabled={loading}
          variant="outline"
          size="sm"
        >
          获取新邮箱
        </Button>
      </div>
    </div>
  )
}
