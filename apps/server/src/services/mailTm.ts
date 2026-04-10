const API_BASE = 'https://api.mail.tm'

export interface Domain {
  id: string
  domain: string
  isActive: boolean
  isPrivate: boolean
  createdAt: string
  updatedAt: string
}

export interface DomainsResponse {
  'hydra:member': Domain[]
  'hydra:totalItems': number
}

export interface Account {
  id: string
  address: string
  quota: number
  used: number
  isDisabled: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface Token {
  id: string
  token: string
}

export interface Message {
  id: string
  accountId: string
  msgid: string
  from: {
    address: string
    name: string
  }
  to: {
    address: string
    name: string
  }[]
  subject: string
  intro: string
  seen: boolean
  isDeleted: boolean
  hasAttachments: boolean
  size: number
  downloadUrl: string
  createdAt: string
  updatedAt: string
}

export interface MessageDetail extends Message {
  html: string[]
  text: string
  attachments: {
    id: string
    filename: string
    contentType: string
    disposition: string
    transferEncoding: string
    related: boolean
    size: number
    downloadUrl: string
  }[]
}

class MailTmService {
  private token: string | null = null
  private account: Account | null = null
  private password: string | null = null

  async getDomains(): Promise<Domain[]> {
    const res = await fetch(`${API_BASE}/domains`)
    const data = (await res.json()) as DomainsResponse
    return data['hydra:member'].filter((d) => d.isActive && !d.isPrivate)
  }

  async createAccount(): Promise<{ address: string; password: string }> {
    // Get available domain
    const domains = await this.getDomains()
    if (domains.length === 0) {
      throw new Error('No available domains')
    }

    const domain = domains[Math.floor(Math.random() * domains.length)].domain

    // Generate random username
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let username = ''
    for (let i = 0; i < 10; i++) {
      username += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    // Generate password
    const password = this.generatePassword()
    const address = `${username}@${domain}`

    // Create account
    const res = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password }),
    })

    if (!res.ok) {
      const error = await res.json() as { 'hydra:description'?: string }
      throw new Error(error['hydra:description'] || 'Failed to create account')
    }

    this.account = (await res.json()) as Account
    this.password = password

    // Get token
    await this.getToken(address, password)

    return { address, password }
  }

  private generatePassword(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%'
    let password = ''
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
  }

  private async getToken(address: string, password: string): Promise<string> {
    const res = await fetch(`${API_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, password }),
    })

    if (!res.ok) {
      throw new Error('Failed to get token')
    }

    const data = (await res.json()) as Token
    this.token = data.token
    return data.token
  }

  async getMessages(): Promise<Message[]> {
    if (!this.token) {
      throw new Error('No token. Call createAccount first.')
    }

    const res = await fetch(`${API_BASE}/messages`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })

    if (!res.ok) {
      throw new Error('Failed to get messages')
    }

    const data = (await res.json()) as { 'hydra:member': Message[] }
    return data['hydra:member'] || []
  }

  async getMessage(id: string): Promise<MessageDetail> {
    if (!this.token) {
      throw new Error('No token. Call createAccount first.')
    }

    const res = await fetch(`${API_BASE}/messages/${id}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    })

    if (!res.ok) {
      throw new Error('Failed to get message')
    }

    return res.json() as Promise<MessageDetail>
  }

  async deleteAccount(): Promise<void> {
    if (!this.token || !this.account) {
      return
    }

    await fetch(`${API_BASE}/accounts/${this.account.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.token}` },
    })

    this.token = null
    this.account = null
    this.password = null
  }

  setSession(token: string, address: string, password: string) {
    this.token = token
    this.password = password
    this.account = {
      id: '',
      address,
      quota: 0,
      used: 0,
      isDisabled: false,
      isDeleted: false,
      createdAt: '',
      updatedAt: '',
    }
  }

  getSession() {
    return {
      token: this.token,
      address: this.account?.address,
      password: this.password,
    }
  }
}

export const mailTmService = new MailTmService()
