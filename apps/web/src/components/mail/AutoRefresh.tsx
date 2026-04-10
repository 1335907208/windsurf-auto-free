'use client'

interface AutoRefreshProps {
  enabled: boolean
  interval: number
  onToggle: () => void
  onIntervalChange: (interval: number) => void
}

export function AutoRefresh({ enabled, interval, onToggle, onIntervalChange }: AutoRefreshProps) {
  return (
    <div className="flex items-center gap-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-zinc-700 dark:text-zinc-300">自动刷新</span>
      </label>

      {enabled && (
        <select
          value={interval}
          onChange={(e) => onIntervalChange(parseInt(e.target.value))}
          className="text-sm border border-zinc-300 dark:border-zinc-600 rounded px-2 py-1 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
        >
          <option value={5000}>5秒</option>
          <option value={10000}>10秒</option>
          <option value={30000}>30秒</option>
          <option value={60000}>1分钟</option>
        </select>
      )}
    </div>
  )
}
