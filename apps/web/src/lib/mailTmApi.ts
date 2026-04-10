const API_BASE = 'http://localhost:3001'

export interface MailTmAddress {
  email: string
  password?: string
}

export interface MailTmEmail {
  id: string
  from: string
  fromName?: string
  subject: string
  excerpt: string
  timestamp: string
  date: string
  read: boolean
}

export interface MailTmEmailDetail extends MailTmEmail {
  body: string
  text?: string
  codes: string[]
}

export interface EmailHistoryItem {
  id: string
  email: string
  provider: string
  createdAt: string
  expiresAt: string
  messageCount: number
  messages: {
    id: string
    messageId: string
    from: string
    fromName?: string
    subject: string
    codes: string[]
    receivedAt: string
  }[]
}

export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function getMailTmAddress(): Promise<ApiResult<MailTmAddress>> {
  const res = await fetch(`${API_BASE}/api/mailtm/address`)
  return res.json()
}

export async function getMailTmList(): Promise<ApiResult<{ emails: MailTmEmail[]; count: number }>> {
  const res = await fetch(`${API_BASE}/api/mailtm/list`)
  return res.json()
}

export async function getMailTmEmail(id: string): Promise<ApiResult<MailTmEmailDetail>> {
  const res = await fetch(`${API_BASE}/api/mailtm/${id}`)
  return res.json()
}

export async function deleteMailTmSession(): Promise<ApiResult<{ deleted: boolean }>> {
  const res = await fetch(`${API_BASE}/api/mailtm/session`, { method: 'DELETE' })
  return res.json()
}

export async function getEmailHistory(): Promise<ApiResult<EmailHistoryItem[]>> {
  const res = await fetch(`${API_BASE}/api/mailtm/history`)
  return res.json()
}

export async function getEmailHistoryDetail(email: string): Promise<ApiResult<EmailHistoryItem>> {
  const res = await fetch(`${API_BASE}/api/mailtm/history/${encodeURIComponent(email)}`)
  return res.json()
}
