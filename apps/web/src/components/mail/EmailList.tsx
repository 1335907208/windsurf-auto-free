'use client'

import { Email } from '@/lib/api'

interface EmailListProps {
  emails: Email[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
}

export function EmailList({ emails, selectedId, onSelect, loading }: EmailListProps) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
        <div className="text-center text-zinc-500 dark:text-zinc-400 py-8">
          加载中...
        </div>
      </div>
    )
  }

  if (emails.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
        <div className="text-center text-zinc-500 dark:text-zinc-400 py-8">
          <div className="text-4xl mb-2">📭</div>
          <p>暂无邮件</p>
          <p className="text-sm mt-1">等待接收验证码邮件...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          收件箱 ({emails.length})
        </h2>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
        {emails.map((email) => (
          <button
            key={email.id}
            onClick={() => onSelect(email.id)}
            className={`w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors ${
              selectedId === email.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${email.read ? 'text-zinc-500' : 'font-semibold text-zinc-900 dark:text-zinc-100'}`}>
                    {email.from}
                  </span>
                  {!email.read && (
                    <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                  )}
                </div>
                <p className={`text-sm truncate ${email.read ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-900 dark:text-zinc-100'}`}>
                  {email.subject}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 truncate mt-1">
                  {email.excerpt}
                </p>
              </div>
              <span className="text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
                {email.date}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
