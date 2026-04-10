'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmailDetail as EmailDetailType } from '@/lib/api'

interface EmailDetailProps {
  email: EmailDetailType | null
  loading: boolean
}

export function EmailDetail({ email, loading }: EmailDetailProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
        <div className="text-center text-zinc-500 dark:text-zinc-400 py-8">
          加载中...
        </div>
      </div>
    )
  }

  if (!email) {
    return (
      <div className="bg-white dark:bg-zinc-800 rounded-xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-700">
        <div className="text-center text-zinc-500 dark:text-zinc-400 py-8">
          <div className="text-4xl mb-2">📧</div>
          <p>选择一封邮件查看详情</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          邮件详情
        </h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Meta info */}
        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-zinc-500 dark:text-zinc-400 shrink-0">发件人:</span>
            <span className="text-zinc-900 dark:text-zinc-100 break-all">{email.from}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 dark:text-zinc-400 shrink-0">主题:</span>
            <span className="text-zinc-900 dark:text-zinc-100 break-all">{email.subject}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-zinc-500 dark:text-zinc-400 shrink-0">时间:</span>
            <span className="text-zinc-900 dark:text-zinc-100">{email.date}</span>
          </div>
        </div>

        {/* Verification codes */}
        {email.codes.length > 0 && (
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
            <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-2">
              检测到验证码
            </p>
            <div className="flex flex-wrap gap-2">
              {email.codes.map((code) => (
                <div key={code} className="flex items-center gap-1">
                  <span className="bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 px-3 py-1 rounded font-mono font-bold text-lg">
                    {code}
                  </span>
                  <Button
                    onClick={() => copyCode(code)}
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                  >
                    {copiedCode === code ? '已复制' : '复制'}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Email body */}
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">
            邮件内容
          </h3>
          <div
            className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: email.body }}
          />
        </div>
      </div>
    </div>
  )
}
