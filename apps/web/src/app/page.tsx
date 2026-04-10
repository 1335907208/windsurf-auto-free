'use client'

import { useState, useEffect, useRef } from 'react'
import {
  startBatchRegister,
  stopBatchRegister,
  getRegisterStatus,
  getWindsurfAccounts,
  deleteWindsurfAccount,
  WindsurfAccount,
} from '@/lib/windsurfApi'

export default function WindsurfPage() {
  const [count, setCount] = useState(1)
  const [concurrency, setConcurrency] = useState(5)
  // Headless mode disabled - Cloudflare blocks headless browsers
  // const [headless, setHeadless] = useState(false)
  const [running, setRunning] = useState(false)
  const [accounts, setAccounts] = useState<WindsurfAccount[]>([])
  const [filter, setFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all')
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [eventSource, setEventSource] = useState<EventSource | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const MAX_LOG_LINES = 300
  
  // Progress tracking
  const [progress, setProgress] = useState({
    total: 0,
    completed: 0,
    success: 0,
    failed: 0,
    running: 0
  })
  const progressRef = useRef({ total: 0, completed: 0, success: 0, failed: 0, running: 0 })
  
  // Completion summary
  const [showSummary, setShowSummary] = useState(false)
  const [summary, setSummary] = useState({
    total: 0,
    success: 0,
    failed: 0
  })

  useEffect(() => {
    loadAccounts()
    // Connect to SSE for real-time logs (separate port)
    const es = new EventSource('http://localhost:3002/api/windsurf/logs')
    
    es.onopen = () => {
      console.log('SSE connected')
    }
    
    es.onmessage = (e) => {
      if (e.data === '__COMPLETE__') {
        setRunning(false)
        loadAccounts()
        // Show summary - use ref to get latest progress
        setSummary({
          total: progressRef.current.total,
          success: progressRef.current.success,
          failed: progressRef.current.failed
        })
        setShowSummary(true)
      } else {
        // Check for progress update
        if (e.data.startsWith('PROGRESS:')) {
          try {
            const progressData = JSON.parse(e.data.substring(9))
            progressRef.current = progressData
            setProgress(progressData)
          } catch {}
        }
        setLogs((prev) => {
          const newLogs = [...prev, e.data]
          // Limit log lines to prevent browser lag
          if (newLogs.length > MAX_LOG_LINES) {
            return newLogs.slice(-MAX_LOG_LINES)
          }
          return newLogs
        })
      }
    }
    
    es.onerror = (e) => {
      console.error('SSE error:', e)
    }
    
    setEventSource(es)
    
    return () => {
      es.close()
    }
  }, [])

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [logs])

  const checkStatus = async () => {
    const result = await getRegisterStatus()
    if (result.success && result.data) {
      setRunning(result.data.running)
    }
  }

  const loadAccounts = async () => {
    const result = await getWindsurfAccounts()
    if (result.success && result.data) {
      setAccounts(result.data)
    }
  }

  const handleStart = async () => {
    setLoading(true)
    // Reset progress and hide summary
    setProgress({ total: 0, completed: 0, success: 0, failed: 0, running: 0 })
    setShowSummary(false)
    const result = await startBatchRegister(count, concurrency, false) // headless disabled
    if (result.success) {
      setRunning(true)
    } else {
      alert(result.error)
    }
    setLoading(false)
  }

  const handleStop = async () => {
    setLoading(true)
    await stopBatchRegister()
    setRunning(false)
    setLoading(false)
  }

  const handleDelete = async (id: string) => {
    if (confirm('确定删除此账号？')) {
      await deleteWindsurfAccount(id)
      loadAccounts()
    }
  }

  const handleExport = () => {
    const successAccounts = accounts.filter((a) => a.status === 'success')
    const text = successAccounts.map((a) => `${a.email}:${a.password || ''}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `windsurf_accounts_${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN')
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
      registering: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    }
    const labels: Record<string, string> = {
      pending: '等待中',
      registering: '注册中',
      success: '成功',
      failed: '失败',
    }
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${styles[status] || styles.pending}`}>
        {labels[status] || status}
      </span>
    )
  }

  const stats = {
    total: accounts.length,
    success: accounts.filter((a) => a.status === 'success').length,
    failed: accounts.filter((a) => a.status === 'failed').length,
    pending: accounts.filter((a) => a.status === 'pending' || a.status === 'registering').length,
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <header className="bg-white dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                Windsurf 自动注册
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                批量自动注册 Windsurf 账号
              </p>
            </div>
            <a href="/" className="text-sm text-blue-600 hover:underline">
              返回首页
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats.total}</p>
            <p className="text-sm text-zinc-500">总数</p>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <p className="text-2xl font-bold text-green-600">{stats.success}</p>
            <p className="text-sm text-zinc-500">成功</p>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-sm text-zinc-500">失败</p>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
            <p className="text-sm text-zinc-500">进行中</p>
          </div>
        </div>

        {/* Register Settings */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 border border-zinc-200 dark:border-zinc-700 mb-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">批量注册设置</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm text-zinc-600 dark:text-zinc-400 mb-1">注册数量</label>
              <input
                type="number"
                value={count}
                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                min={1}
                max={100}
                disabled={running}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-600 dark:text-zinc-400 mb-1">最大并发数</label>
              <input
                type="number"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value) || 1)}
                min={1}
                max={5}
                disabled={running}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {running ? (
              <button
                onClick={handleStop}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                停止注册
              </button>
            ) : (
              <button
                onClick={handleStart}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                开始注册
              </button>
            )}
          </div>
          {/* Progress in settings box */}
          {running && progress.total > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">注册中</span>
                </div>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {progress.completed}/{progress.total}
                </span>
              </div>
              <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-1.5 mb-3">
                <div 
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" 
                  style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-green-600">成功 {progress.success}</span>
                <span className="text-red-600">失败 {progress.failed}</span>
                <span className="text-yellow-600">执行中 {progress.running}</span>
                <span className="text-zinc-500">剩余 {progress.total - progress.completed}</span>
              </div>
            </div>
          )}
          
        </div>

        {/* Completion Summary */}
        {showSummary && !running && (
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-green-600">任务完成</span>
              <button 
                onClick={() => setShowSummary(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-green-600">成功 {summary.success}</span>
              <span className="text-red-600">失败 {summary.failed}</span>
              <span className="text-zinc-500">总计 {summary.total}</span>
            </div>
          </div>
        )}

        {/* Real-time Logs */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 mb-6">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Logs</h2>
            <button
              onClick={() => setLogs([])}
              className="px-3 py-1 text-sm bg-zinc-600 text-white rounded hover:bg-zinc-700"
            >
              Clear
            </button>
          </div>
          <div ref={logsContainerRef} className="p-4 h-64 overflow-y-auto font-mono text-sm bg-zinc-900 text-zinc-100">
            {logs.length === 0 ? (
              <div className="text-zinc-500">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="whitespace-pre-wrap">{log}</div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* Accounts List */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">账号列表</h2>
            <button
              onClick={handleExport}
              disabled={stats.success === 0}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              导出成功账号
            </button>
          </div>
          
          {/* Tabs */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-700">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${filter === 'all' ? 'text-blue-600 border-blue-600' : 'text-zinc-600 dark:text-zinc-400 border-transparent'}`}
            >
              全部 ({stats.total})
            </button>
            <button
              onClick={() => setFilter('success')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${filter === 'success' ? 'text-green-600 border-green-600' : 'text-zinc-600 border-transparent'}`}
            >
              成功 ({stats.success})
            </button>
            <button
              onClick={() => setFilter('failed')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${filter === 'failed' ? 'text-red-600 border-red-600' : 'text-zinc-600 border-transparent'}`}
            >
              失败 ({stats.failed})
            </button>
            <button
              onClick={() => setFilter('pending')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${filter === 'pending' ? 'text-yellow-600 border-yellow-600' : 'text-zinc-600 border-transparent'}`}
            >
              进行中 ({stats.pending})
            </button>
          </div>
          
          <div className="divide-y divide-zinc-200 dark:divide-zinc-700 max-h-96 overflow-y-auto">
            {(() => {
              const filtered = filter === 'all' ? accounts :
                filter === 'success' ? accounts.filter(a => a.status === 'success') :
                filter === 'failed' ? accounts.filter(a => a.status === 'failed') :
                accounts.filter(a => a.status === 'pending' || a.status === 'registering')
              return filtered.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">{filter === 'all' ? '暂无账号记录' : filter === 'success' ? '暂无成功账号' : filter === 'failed' ? '暂无失败账号' : '暂无进行中账号'}</div>
              ) : (
                filtered.map((account) => (
                <div
                  key={account.id}
                  className="p-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                        {account.email}
                      </p>
                      {getStatusBadge(account.status)}
                    </div>
                    {account.password && (
                      <p className="text-xs text-zinc-400 mt-1">密码: {account.password}</p>
                    )}
                    <p className="text-xs text-zinc-500 mt-1">{formatDate(account.registerAt)}</p>
                    {account.errorMsg && (
                      <p className="text-xs text-red-500 mt-1">{account.errorMsg}</p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                  >
                    删除
                  </button>
                </div>
              ))
            )
          })()}
          </div>
        </div>
      </main>
    </div>
  )
}
