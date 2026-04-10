const API_BASE = 'https://www.guerrillamail.com/ajax.php'

export interface EmailAddress {
  email_addr: string
  email_timestamp: number
  alias: string
  sid_token: string
  site_id?: number
  site?: string
  alias_error?: string
  auth?: { success: boolean; error_codes: string[] }
}

export interface Email {
  mail_id: string | number
  mail_from: string
  mail_subject: string
  mail_excerpt: string
  mail_timestamp: string | number
  mail_read: string | number
  mail_date: string
  mail_body?: string
  att?: string | number
  att_size?: string
  content_type?: string
  source_id?: number
  source_mail_id?: number
  mail_recipient?: string
  reply_to?: string
  mail_size?: string
}

export interface EmailList {
  list?: Email[]
  count?: string | number
  email?: string
  alias?: string
  ts?: number
  sid_token?: string
  error?: string
  code?: string
  auth?: { success: boolean; error_codes: string[] }
  stats?: Record<string, string>
}

export interface EmailDetail extends Email {
  mail_body: string
}

class GuerrillaMailService {
  private sidToken: string | null = null
  private emailAddress: string | null = null
  private emailInbox: string | null = null

  async getEmailAddress(): Promise<EmailAddress> {
    // 生成随机邮箱用户名
    const chars = 'abcdefghijklmnopqrstuvwxyz'
    let emailUser = ''
    for (let i = 0; i < 8; i++) {
      emailUser += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    // 使用 POST 请求设置邮箱
    const body = new URLSearchParams({
      email_user: emailUser,
      lang: 'en',
      site: 'guerrillamail.com',
      in: ' Set cancel',
    })

    const res = await fetch(`${API_BASE}?f=set_email_user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })

    const data = (await res.json()) as EmailAddress

    if (data.sid_token) {
      this.sidToken = data.sid_token
      this.emailAddress = data.email_addr
      this.emailInbox = emailUser
    }

    return data
  }

  async getEmailList(offset = 0): Promise<EmailList> {
    if (!this.sidToken || !this.emailInbox) {
      throw new Error('No session token. Call getEmailAddress first.')
    }

    const timestamp = Date.now()
    const url = `${API_BASE}?f=get_email_list&offset=${offset}&site=guerrillamail.com&in=${this.emailInbox}&_=${timestamp}`

    const res = await fetch(url, {
      headers: {
        Cookie: `PHPSESSID=${this.sidToken}`,
      },
    })
    const data = (await res.json()) as EmailList

    if (data.sid_token) {
      this.sidToken = data.sid_token
    }

    return data
  }

  async fetchEmail(emailId: string): Promise<EmailDetail> {
    if (!this.sidToken || !this.emailInbox) {
      throw new Error('No session token. Call getEmailAddress first.')
    }

    // Add mr_ prefix if not present
    const fullId = emailId.startsWith('mr_') ? emailId : `mr_${emailId}`
    const timestamp = Date.now()
    const url = `${API_BASE}?f=fetch_email&email_id=${fullId}&site=guerrillamail.com&in=${this.emailInbox}&_=${timestamp}`

    const res = await fetch(url, {
      headers: {
        Cookie: `PHPSESSID=${this.sidToken}`,
      },
    })
    const data = (await res.json()) as EmailDetail & { error?: string }

    if (data.error) {
      throw new Error(`API Error: ${data.error}`)
    }

    return data
  }

  async checkEmail(seq: number = 0): Promise<{ count: number; list: Email[] }> {
    if (!this.sidToken || !this.emailInbox) {
      throw new Error('No session token. Call getEmailAddress first.')
    }

    const timestamp = Date.now()
    const url = `${API_BASE}?f=check_email&seq=${seq}&site=guerrillamail.com&in=${this.emailInbox}&_=${timestamp}`

    const res = await fetch(url, {
      headers: {
        Cookie: `PHPSESSID=${this.sidToken}`,
      },
    })
    const data = (await res.json()) as { count?: string | number; list?: Email[]; error?: string; sid_token?: string }

    if (data.error) {
      throw new Error(`API Error: ${data.error}`)
    }

    if (data.sid_token) {
      this.sidToken = data.sid_token
    }

    return {
      count: typeof data.count === 'string' ? parseInt(data.count) : (data.count || 0),
      list: data.list || [],
    }
  }

  async forgetMe(): Promise<{ deleted: boolean }> {
    if (!this.sidToken) {
      return { deleted: false }
    }

    const url = `${API_BASE}?f=forget_me&site=guerrillamail.com`
    const res = await fetch(url, {
      headers: {
        Cookie: `PHPSESSID=${this.sidToken}`,
      },
    })
    return res.json() as Promise<{ deleted: boolean }>
  }

  setSession(sidToken: string, emailAddress: string) {
    this.sidToken = sidToken
    this.emailAddress = emailAddress
    this.emailInbox = emailAddress.split('@')[0]
  }

  getSession() {
    return {
      sidToken: this.sidToken,
      emailAddress: this.emailAddress,
      emailInbox: this.emailInbox,
    }
  }
}

export const guerrillaMailService = new GuerrillaMailService()
