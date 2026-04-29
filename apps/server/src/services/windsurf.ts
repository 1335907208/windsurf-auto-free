import { spawn, exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'

export interface RegisterResult {
  success: boolean
  email: string
  password?: string
  apiKey?: string
  error?: string
}

export interface RegisterProgress {
  email: string
  status: 'pending' | 'creating_email' | 'opening_page' | 'filling_email' | 'verifying_human' | 'setting_password' | 'waiting_code' | 'filling_code' | 'success' | 'failed'
  message: string
}

class WindsurfRegisterService {
  private progressCallback: ((progress: RegisterProgress) => void) | null = null
  private running = false
  private logCallbacks: ((log: string) => void)[] = []
  private currentProcesses: Set<ReturnType<typeof spawn>> = new Set()

  setProgressCallback(callback: (progress: RegisterProgress) => void) {
    this.progressCallback = callback
  }

  addLogCallback(callback: (log: string) => void) {
    this.logCallbacks.push(callback)
  }

  removeLogCallback(callback: (log: string) => void) {
    this.logCallbacks = this.logCallbacks.filter(cb => cb !== callback)
  }

  private emitLog(log: string) {
    this.logCallbacks.forEach(cb => cb(log))
  }

  private emitComplete() {
    this.logCallbacks.forEach(cb => cb('__COMPLETE__'))
  }

  private async reportProgress(email: string, status: RegisterProgress['status'], message: string) {
    if (this.progressCallback) {
      this.progressCallback({ email, status, message })
    }
    // Update database only if email exists and record exists
    if (email) {
      try {
        await prisma.windsurfAccount.upsert({
          where: { email },
          create: { email, status: status === 'success' ? 'success' : status === 'failed' ? 'failed' : 'registering' },
          update: { status: status === 'success' ? 'success' : status === 'failed' ? 'failed' : 'registering' },
        })
      } catch (e) {
        // Ignore database errors during progress updates
      }
    }
  }

  /**
   * Run Python DrissionPage script for registration
   */
  async registerSingle(headless: boolean = false): Promise<RegisterResult> {
    const scriptPath = path.join(__dirname, '../../windsurf_register.py')
    const args = [scriptPath]
    if (headless) {
      args.push('--headless')
    }
    
    return new Promise((resolve) => {
      let email = ''
      let password = ''
      let apiKey = ''
      let output = ''
      
      const pythonProcess = spawn('python', args, {
        cwd: path.join(__dirname, '../../'),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })
      
      // Track process for stop functionality
      this.currentProcesses.add(pythonProcess)
      
      pythonProcess.stdout.on('data', (data) => {
        const text = data.toString()
        output += text
        console.log(text)
        this.emitLog(text)
        
        // Parse email from output
        const emailMatch = text.match(/Email created: (\S+)/)
        if (emailMatch) {
          email = emailMatch[1]
          // Create database record when email is created
          prisma.windsurfAccount.create({
            data: { email, status: 'registering' }
          }).catch(() => {})
        }
        
        // Parse password from output
        const passwordMatch = text.match(/Filled password: (\S+)/)
        if (passwordMatch) {
          password = passwordMatch[1]
        }
        
        // Parse apiKey from output
        const apiKeyMatch = text.match(/API key obtained! \(length: (\d+)\)/)
        if (apiKeyMatch) {
          console.log(`API key detected, length: ${apiKeyMatch[1]}`)
        }
        
        // Parse apiKey from explicit log: api_key: <value>
        const apiKeyValueMatch = text.match(/^api_key: (\S+)$/m)
        if (apiKeyValueMatch) {
          apiKey = apiKeyValueMatch[1]
          console.log(`API key extracted from log, length: ${apiKey.length}`)
        }
        
        // Parse verification code from output
        const codeMatch = text.match(/Verification code: (\d+)/)
        if (codeMatch) {
          console.log(`Verification code extracted: ${codeMatch[1]}`)
        }
        
        // Parse progress from output
        if (text.includes('Creating temporary email')) {
          this.reportProgress(email, 'creating_email', 'Creating temporary email...')
        } else if (text.includes('Opening Windsurf registration page')) {
          this.reportProgress(email, 'opening_page', 'Opening registration page...')
        } else if (text.includes('Filling registration form')) {
          this.reportProgress(email, 'filling_email', 'Filling registration form...')
        } else if (text.includes('Setting password')) {
          this.reportProgress(email, 'setting_password', 'Setting password...')
        } else if (text.includes('Cloudflare Turnstile detected')) {
          this.reportProgress(email, 'verifying_human', 'Waiting for Cloudflare verification...')
        } else if (text.includes('Fetching verification code')) {
          this.reportProgress(email, 'waiting_code', 'Fetching verification code...')
        } else if (text.includes('Filled verification code')) {
          this.reportProgress(email, 'filling_code', 'Filled verification code...')
        } else if (text.includes('Registration successful')) {
          this.reportProgress(email, 'success', 'Registration successful!')
        }
      })
      
      pythonProcess.stderr.on('data', (data) => {
        console.error(`Python error: ${data}`)
      })
      
      pythonProcess.on('close', async (code) => {
        console.log(`Python script exited with code ${code}`)
        
        // Remove from tracked processes
        this.currentProcesses.delete(pythonProcess)
        
        // Check if registration was successful
        const success = output.includes('Registration successful') || 
                       (output.includes('Filled verification code') && code === 0)
        
        if (success && email) {
          // Parse apiKey from JSON result in output
          const resultMatch = output.match(/"api_key":\s*"([^"]+)"/)
          if (resultMatch) {
            apiKey = resultMatch[1]
            console.log(`Extracted apiKey from result, length: ${apiKey.length}`)
          }
          
          // Save password and apiKey to database
          if (password || apiKey) {
            try {
              await prisma.windsurfAccount.update({
                where: { email },
                data: { 
                  ...(password && { password }),
                  ...(apiKey && { apiKey })
                },
              })
              console.log(`Saved password and apiKey for ${email}`)
            } catch (e) {
              console.error('Failed to save password/apiKey:', e)
            }
          }
          await this.reportProgress(email, 'success', 'Registration successful!')
          resolve({ success: true, email, password, apiKey })
        } else {
          // Extract error message from output
          let errorMsg = 'Registration failed'
          
          // Check for TIMEOUT message
          if (output.includes('TIMEOUT:')) {
            const timeoutMatch = output.match(/TIMEOUT: (.+)/)
            errorMsg = timeoutMatch ? timeoutMatch[1] : 'Timeout'
          } else if (output.includes('ERROR:')) {
            const errorMatch = output.match(/ERROR: (.+)/)
            errorMsg = errorMatch ? errorMatch[1] : 'Unknown error'
          } else if (output.includes('Error at step')) {
            const errorMatch = output.match(/Error at step '([^']+)': (.+)/)
            errorMsg = errorMatch ? `Step '${errorMatch[1]}': ${errorMatch[2]}` : 'Unknown error'
          }
          
          // Save error to database
          if (email) {
            try {
              await prisma.windsurfAccount.update({
                where: { email },
                data: { status: 'failed', errorMsg }
              })
            } catch (e) {
              console.error('Failed to save error:', e)
            }
          }
          resolve({ success: false, email, error: errorMsg })
        }
      })
      
      pythonProcess.on('error', (err) => {
        console.error('Failed to start Python process:', err)
        resolve({ success: false, email: '', error: `Failed to start Python: ${err.message}` })
      })
    })
  }

  async startBatchRegister(count: number, concurrency: number = 1, headless: boolean = false): Promise<void> {
    if (this.running) {
      throw new Error('Batch registration already running')
    }

    this.running = true
    this.emitLog(`Starting batch registration: count=${count}, concurrency=${concurrency}`)

    // Progress tracking
    let started = 0
    let completed = 0
    let successCount = 0
    let failedCount = 0
    const activeTasks: { promise: Promise<RegisterResult>; taskIndex: number }[] = []
    
    const emitProgress = () => {
      const progress = {
        total: count,
        completed,
        success: successCount,
        failed: failedCount,
        running: activeTasks.length
      }
      this.emitLog(`PROGRESS:${JSON.stringify(progress)}`)
    }
    
    const startTask = (taskIndex: number) => {
      this.emitLog(`Starting task ${taskIndex + 1}/${count}...`)
      const promise = this.registerSingle(headless)
      activeTasks.push({ promise, taskIndex })
      started++
      emitProgress()
    }
    
    // Start initial batch
    for (let i = 0; i < Math.min(concurrency, count); i++) {
      startTask(i)
    }
    
    while (activeTasks.length > 0 && this.running) {
      // Wait for any task to complete
      const promises = activeTasks.map(t => t.promise.then(r => ({ ...r, taskIndex: t.taskIndex })))
      const result = await Promise.race(promises) as RegisterResult & { taskIndex: number }
      
      // Remove completed task
      const idx = activeTasks.findIndex(t => t.taskIndex === result.taskIndex)
      if (idx >= 0) activeTasks.splice(idx, 1)
      
      // Update counts
      completed++
      if (result.success) {
        successCount++
      } else {
        failedCount++
      }
      
      this.emitLog(`Task ${result.taskIndex + 1} ${result.success ? 'SUCCESS' : 'FAILED: ' + result.error}`)
      emitProgress()
      
      // Start next task if there are more
      if (started < count && this.running) {
        startTask(started)
      }
    }
    
    this.running = false
    this.emitComplete()
  }

  stopBatchRegister() {
    this.running = false
    
    // Kill all running Python processes
    for (const proc of this.currentProcesses) {
      try {
        proc.kill('SIGTERM')
      } catch (e) {
        // Ignore kill errors
      }
    }
    this.currentProcesses.clear()
    
    // Kill Chrome processes by PID from temp files
    const tempDir = process.env.TEMP || '/tmp'
    const files = fs.readdirSync(tempDir).filter((f) => f.startsWith('windsurf_reg_') && f.endsWith('.pid'))
    for (const file of files) {
      try {
        const pid = fs.readFileSync(path.join(tempDir, file), 'utf-8').trim()
        if (pid && /^\d+$/.test(pid)) {
          exec(`taskkill /F /PID ${pid}`, () => {})
          fs.unlinkSync(path.join(tempDir, file))
        }
      } catch {}
    }
    
    this.emitLog('Batch registration stopped')
    this.emitComplete()
  }

  reset() {
    this.running = false
    this.logCallbacks = []
  }

  isRunning() {
    return this.running
  }

  async getAccounts(status?: string) {
    return prisma.windsurfAccount.findMany({
      where: {
        ...(status && { status }),
        OR: [
          { password: { not: null } },
          { apiKey: { not: null } },
        ],
      },
      orderBy: { registerAt: 'desc' },
      take: 100,
    })
  }
}

export const windsurfRegisterService = new WindsurfRegisterService()
