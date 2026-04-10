const API_BASE = 'http://localhost:3001'

export interface EmailAddress {
  email: string
  sidToken: string
  timestamp?: number
  alias?: string
}

export interface Email {
  id: string
  from: string
  subject: string
  excerpt: string
  timestamp: string
  date: string
  read: boolean
}

export interface EmailDetail extends Email {
  body: string
  codes: string[]
}

export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function getEmailAddress(): Promise<ApiResult<EmailAddress>> {
  const res = await fetch(`${API_BASE}/api/mail/address`)
  return res.json()
}

export async function restoreSession(sidToken: string, email: string): Promise<ApiResult<EmailAddress>> {
  const res = await fetch(`${API_BASE}/api/mail/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sidToken, email }),
  })
  return res.json()
}

export async function getEmailList(offset = 0): Promise<ApiResult<{ emails: Email[]; count: number }>> {
  const res = await fetch(`${API_BASE}/api/mail/list?offset=${offset}`)
  return res.json()
}

export async function getEmail(id: string): Promise<ApiResult<EmailDetail>> {
  const res = await fetch(`${API_BASE}/api/mail/${id}`)
  return res.json()
}

export async function checkNewEmails(seq = 1): Promise<ApiResult<{ count: number; emails: Email[] }>> {
  const res = await fetch(`${API_BASE}/api/mail/check?seq=${seq}`)
  return res.json()
}

export async function deleteSession(): Promise<ApiResult<{ deleted: boolean }>> {
  const res = await fetch(`${API_BASE}/api/mail/session`, { method: 'DELETE' })
  return res.json()
}
