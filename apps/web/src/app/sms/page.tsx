'use client'

import { useState, useEffect, useCallback } from 'react'
import { EmailCard } from '@/components/mail/EmailCard'
import { EmailList } from '@/components/mail/EmailList'
import { EmailDetail } from '@/components/mail/EmailDetail'
import { AutoRefresh } from '@/components/mail/AutoRefresh'
import { EmailHistory } from '@/components/mail/EmailHistory'
import { getEmailAddress, getEmailList, getEmail, deleteSession, Email, EmailDetail as EmailDetailType } from '@/lib/api'
import { getMailTmAddress, getMailTmList, getMailTmEmail, deleteMailTmSession, MailTmEmail, MailTmEmailDetail } from '@/lib/mailTmApi'

type ServiceProvider = 'guerrilla' | 'mailtm'

export default function SmsPage() {
  const [provider, setProvider] = useState<ServiceProvider>('mailtm')
  const [emailAddress, setEmailAddress] = useState('')
  const [sidToken, setSidToken] = useState('')
  const [emails, setEmails] = useState<Email[]>([])
  const [selectedEmail, setSelectedEmail] = useState<EmailDetailType | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [listLoading, setListLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval, setRefreshInterval] = useState(10000)
  const [expiresIn, setExpiresIn] = useState(3600)

  // Initialize email address
  const initEmail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (provider === 'mailtm') {
        const result = await getMailTmAddress()
        if (result.success && result.data) {
          setEmailAddress(result.data.email)
          setExpiresIn(3600)
          await fetchMailTmList()
        } else {
          setError(result.error || 'Failed to get email address')
        }
      } else {
        const result = await getEmailAddress()
        if (result.success && result.data) {
          setEmailAddress(result.data.email)
          setSidToken(result.data.sidToken)
          setExpiresIn(3600)
          await fetchEmailList()
        } else {
          setError(result.error || 'Failed to get email address')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [provider])

  // Fetch Mail.tm email list
  const fetchMailTmList = async () => {
    setListLoading(true)
    try {
      const result = await getMailTmList()
      if (result.success && result.data) {
        setEmails(result.data.emails as Email[])
      }
    } catch (err) {
      console.error('Failed to fetch Mail.tm list:', err)
    } finally {
      setListLoading(false)
    }
  }

  // Fetch email list
  const fetchEmailList = async () => {
    if (provider === 'mailtm') {
      return fetchMailTmList()
    }
    setListLoading(true)
    try {
      const result = await getEmailList()
      if (result.success && result.data) {
        setEmails(result.data.emails)
      }
    } catch (err) {
      console.error('Failed to fetch email list:', err)
    } finally {
      setListLoading(false)
    }
  }

  // Fetch Mail.tm email detail
  const fetchMailTmDetail = async (id: string) => {
    setDetailLoading(true)
    try {
      const result = await getMailTmEmail(id)
      if (result.success && result.data) {
        setSelectedEmail(result.data as EmailDetailType)
      }
    } catch (err) {
      console.error('Failed to fetch Mail.tm email:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  // Fetch single email
  const fetchEmailDetail = async (id: string) => {
    if (provider === 'mailtm') {
      return fetchMailTmDetail(id)
    }
    setDetailLoading(true)
    try {
      const result = await getEmail(id)
      if (result.success && result.data) {
        setSelectedEmail(result.data)
      }
    } catch (err) {
      console.error('Failed to fetch email:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  // Get new email address
  const getNewEmail = async () => {
    setLoading(true)
    try {
      if (provider === 'mailtm') {
        await deleteMailTmSession()
      } else {
        await deleteSession()
      }
      setSelectedEmail(null)
      setSelectedId(null)
      setEmails([])
      await initEmail()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Handle email selection
  const handleSelectEmail = (id: string) => {
    setSelectedId(id)
    fetchEmailDetail(id)
  }

  // Initialize on mount
  useEffect(() => {
    initEmail()
  }, [initEmail])

  // Auto refresh
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      fetchEmailList()
    }, refreshInterval)

    return () => clearInterval(interval)
  }, [autoRefresh, refreshInterval, provider])

  // Switch provider
  const switchProvider = async (newProvider: ServiceProvider) => {
    setProvider(newProvider)
    setSelectedEmail(null)
    setSelectedId(null)
    setEmails([])
    setEmailAddress('')
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                Oh My SMS
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                 temporary email verification code tool
              </p>
            </div>
            <div className="flex items-center gap-4">
              {/* Provider Switch */}
              <select
                value={provider}
                onChange={(e) => switchProvider(e.target.value as ServiceProvider)}
                className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                <option value="mailtm">Mail.tm</option>
                <option value="guerrilla">Guerrilla Mail</option>
              </select>
              <AutoRefresh
                enabled={autoRefresh}
                interval={refreshInterval}
                onToggle={() => setAutoRefresh(!autoRefresh)}
                onIntervalChange={setRefreshInterval}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Email Address Card */}
        <div className="mb-6">
          <EmailCard
            email={emailAddress}
            onRefresh={fetchEmailList}
            onNewEmail={getNewEmail}
            loading={loading}
            expiresIn={expiresIn}
          />
        </div>

        {/* Email List and Detail */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EmailList
            emails={emails}
            selectedId={selectedId}
            onSelect={handleSelectEmail}
            loading={listLoading}
          />
          <EmailDetail
            email={selectedEmail}
            loading={detailLoading}
          />
        </div>

        {/* Email History */}
        <div className="mt-6">
          <EmailHistory />
        </div>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-800 border-t border-zinc-200 dark:border-zinc-700 py-2">
        <p className="text-xs text-zinc-400 text-center">
          Support Mail.tm / Guerrilla Mail · Email valid for 1 hour · Data stored locally only
        </p>
      </footer>
    </div>
  )
}
