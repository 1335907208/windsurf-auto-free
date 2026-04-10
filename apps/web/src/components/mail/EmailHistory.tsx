'use client'

import { useState, useEffect } from 'react'
import { getEmailHistory, EmailHistoryItem } from '@/lib/mailTmApi'

interface Props {
  onSelect?: (email: string) => void
}

export function EmailHistory({ onSelect }: Props) {
  const [history, setHistory] = useState<EmailHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    setLoading(true)
    const result = await getEmailHistory()
    if (result.success && result.data) {
      setHistory(result.data)
    }
    setLoading(false)
  }

  const toggleExpand = (id: string) => {
    setExpanded(expanded === id ? null : id)
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
        <p className="text-zinc-500 text-center">加载中...</p>
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
        <p className="text-zinc-500 text-center">暂无历史记录</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-700">
        <h3 className="font-medium text-zinc-900 dark:text-zinc-100">邮箱历史</h3>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700 max-h-96 overflow-y-auto">
        {history.map((item) => (
          <div key={item.id}>
            <div
              className="p-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-700/50 flex items-center justify-between"
              onClick={() => toggleExpand(item.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                  {item.email}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatDate(item.createdAt)} · {item.messageCount} 封邮件
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {item.provider}
                </span>
                <svg
                  className={`w-4 h-4 text-zinc-400 transition-transform ${expanded === item.id ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            {expanded === item.id && item.messages.length > 0 && (
              <div className="bg-zinc-50 dark:bg-zinc-900/50 px-3 py-2 space-y-2">
                {item.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className="bg-white dark:bg-zinc-800 rounded p-2 border border-zinc-200 dark:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-zinc-500 truncate">{msg.from}</p>
                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {msg.subject || '(无主题)'}
                        </p>
                      </div>
                      {msg.codes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {msg.codes.map((code, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-mono"
                            >
                              {code}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">{formatDate(msg.receivedAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
