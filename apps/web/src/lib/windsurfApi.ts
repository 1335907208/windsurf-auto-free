const API_BASE = 'http://localhost:3001'

export interface WindsurfAccount {
  id: string
  email: string
  password?: string
  status: string
  registerAt: string
  errorMsg?: string
}

export interface ApiResult<T> {
  success: boolean
  data?: T
  error?: string
}

export async function startBatchRegister(count: number, concurrency: number = 1, headless: boolean = false): Promise<ApiResult<{ message: string; count: number; concurrency: number; headless: boolean }>> {
  const res = await fetch(`${API_BASE}/api/windsurf/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count, concurrency, headless }),
  })
  return res.json()
}

export async function stopBatchRegister(): Promise<ApiResult<{ message: string }>> {
  const res = await fetch(`${API_BASE}/api/windsurf/stop`, { method: 'POST' })
  return res.json()
}

export async function getRegisterStatus(): Promise<ApiResult<{ running: boolean }>> {
  const res = await fetch(`${API_BASE}/api/windsurf/status`)
  return res.json()
}

export async function getWindsurfAccounts(): Promise<ApiResult<WindsurfAccount[]>> {
  const res = await fetch(`${API_BASE}/api/windsurf/accounts`)
  return res.json()
}

export async function deleteWindsurfAccount(id: string): Promise<ApiResult<{ deleted: boolean }>> {
  const res = await fetch(`${API_BASE}/api/windsurf/accounts/${id}`, { method: 'DELETE' })
  return res.json()
}
