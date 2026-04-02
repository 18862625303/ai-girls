import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import mammoth from 'mammoth'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load environment variables from .env file
config({ path: path.join(__dirname, '..', '.env') })

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let activeChatController: AbortController | null = null

const DEFAULT_CHAT_MODEL = process.env.ARK_CHAT_MODEL || process.env.ARK_MODEL || 'ep-20260402105011-f9jh7'
const DEFAULT_ASR_MODEL = process.env.ARK_ASR_MODEL || 'doubao-voice-asr'
const DEFAULT_TTS_MODEL = process.env.ARK_TTS_MODEL || 'doubao-voice-tts'
const DEFAULT_TTS_VOICE = process.env.ARK_TTS_VOICE || 'zh_female_meilinvyou_moon_bigtts'
const ARK_CHAT_URL = process.env.ARK_CHAT_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ARK_ASR_URL = process.env.ARK_ASR_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/audio/transcriptions'
const ARK_TTS_URL = process.env.ARK_TTS_ENDPOINT || 'https://ark.cn-beijing.volces.com/api/v3/audio/speech'

type SpeechToTextInput = {
  audioBase64: string
  mimeType?: string
  fileName?: string
  language?: string
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function requireArkApiKey() {
  const apiKey = process.env.ARK_API_KEY
  if (!apiKey) {
    throw new Error('未检测到 ARK_API_KEY，请在 .env 中配置后重启应用。')
  }
  return apiKey
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function askDoubao(message: string): Promise<string> {
  const apiKey = process.env.ARK_API_KEY
  const model = DEFAULT_CHAT_MODEL

  if (!apiKey) {
    return '未检测到 ARK_API_KEY，暂时返回本地占位回复：\n\n我已收到你的问题，当前可继续扩展为接入豆包正式回答。'
  }

  const response = await fetch(ARK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是一个简洁、友好的学习助手。回答时优先给出清晰结论。' },
        { role: 'user', content: message },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`豆包接口请求失败：${response.status} ${text}`)
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content?.trim() || '模型未返回有效内容。'
}

async function streamDoubaoReply(
  message: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const apiKey = requireArkApiKey()

  const response = await fetch(ARK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_CHAT_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: '你是一个简洁、友好的学习助手。回答时优先给出清晰结论。' },
        { role: 'user', content: message },
      ],
    }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`流式请求失败：${response.status} ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const fallbackText = await askDoubao(message)
    const parts = fallbackText.match(/.{1,10}/g) || [fallbackText]
    for (const part of parts) {
      onChunk(part)
      await sleep(40)
    }
    return
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    if (signal?.aborted) {
      throw new Error('用户已中断生成')
    }

    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue

      const dataText = line.slice(5).trim()
      if (!dataText || dataText === '[DONE]') continue

      try {
        const json = JSON.parse(dataText) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>
        }
        const chunk = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || ''
        if (chunk) onChunk(chunk)
      } catch {
        // ignore non-json heartbeat lines
      }
    }
  }
}

async function speechToText(input: SpeechToTextInput): Promise<string> {
  const apiKey = requireArkApiKey()
  const buffer = Buffer.from(input.audioBase64, 'base64')
  const ext = input.fileName?.split('.').pop() || (input.mimeType?.includes('webm') ? 'webm' : 'wav')
  const fileName = input.fileName || `recording.${ext}`

  const candidateModels = Array.from(new Set([DEFAULT_ASR_MODEL, 'whisper-1']))
  let lastError = ''

  for (const model of candidateModels) {
    const form = new FormData()
    form.append('model', model)
    if (input.language) form.append('language', input.language)
    form.append('file', new Blob([buffer], { type: input.mimeType || 'audio/webm' }), fileName)

    const response = await fetch(ARK_ASR_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    })

    if (!response.ok) {
      const text = await response.text()
      lastError = `ASR 请求失败：${response.status} ${text}`

      if (response.status === 404) {
        continue
      }

      throw new Error(lastError)
    }

    const data = (await response.json()) as {
      text?: string
      result?: { text?: string }
      choices?: Array<{ text?: string; message?: { content?: string } }>
    }

    const text = data.text || data.result?.text || data.choices?.[0]?.text || data.choices?.[0]?.message?.content || ''
    if (!text.trim()) {
      throw new Error('ASR 未返回有效文本，请检查模型和音频格式配置。')
    }

    return text.trim()
  }

  throw new Error(`${lastError}\n请检查 ARK_ASR_MODEL / ARK_ASR_ENDPOINT 配置，或在 .env 中指定可用 ASR 模型。`)
}

async function textToSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
  const apiKey = requireArkApiKey()
  const response = await fetch(ARK_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_TTS_MODEL,
      input: text,
      voice: DEFAULT_TTS_VOICE,
      response_format: 'mp3',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`TTS 请求失败：${response.status} ${errorText}`)
  }

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const data = (await response.json()) as { audio?: string; data?: string }
    const base64 = data.audio || data.data || ''
    if (!base64) throw new Error('TTS 返回 JSON，但未包含音频字段。')
    return { audioBase64: base64, mimeType: 'audio/mpeg' }
  }

  const arrayBuffer = await response.arrayBuffer()
  return {
    audioBase64: Buffer.from(arrayBuffer).toString('base64'),
    mimeType: contentType || 'audio/mpeg',
  }
}

ipcMain.handle('app:open-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'txt', 'md'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
      { name: 'Media', extensions: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'mp4', 'webm', 'mov', 'mkv'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })

  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('app:read-file', async (_event, filePath: string) => {
  const data = await fs.readFile(filePath)
  return data.toString('base64')
})

ipcMain.handle('app:read-docx-html', async (_event, filePath: string) => {
  const result = await mammoth.convertToHtml({ path: filePath })
  return result.value
})

ipcMain.handle('app:ask-ai', async (_event, message: string) => {
  try {
    const reply = await askDoubao(message)
    return { ok: true, reply }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    return { ok: false, reply: `请求失败：${msg}` }
  }
})

ipcMain.handle('app:ask-ai-with-files', async (_event, message: string, filePaths: string[]) => {
  try {
    let fileContents: string[] = []
    
    for (const filePath of filePaths) {
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      
      if (['txt', 'md'].includes(ext)) {
        const data = await fs.readFile(filePath, 'utf-8')
        fileContents.push(`\n--- 文件: ${filePath} ---\n${data}`)
      } else if (ext === 'docx') {
        const result = await mammoth.convertToHtml({ path: filePath })
        fileContents.push(`\n--- 文件: ${filePath} ---\n${result.value}`)
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
        // 对于图片，读取base64并添加到提示中
        const data = await fs.readFile(filePath)
        const base64 = data.toString('base64')
        fileContents.push(`\n--- 图片: ${filePath} ---\n[图片数据: ${ext}格式, base64长度: ${base64.length}]`)
      } else {
        return { ok: false, reply: `不支持的文件类型: ${ext}，请使用TXT、MD、DOCX或图片文件` }
      }
    }
    
    const prompt = `请分析以下文件内容并回答我的问题：

文件内容：
${fileContents.join('\n')}

我的问题：${message}

请基于所有文件内容进行详细分析和回答。如果有图片，请描述你看到的内容。`
    
    const reply = await askDoubao(prompt)
    return { ok: true, reply }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    return { ok: false, reply: `请求失败：${msg}` }
  }
})

ipcMain.on('app:ask-ai-stream', async (event, message: string) => {
  activeChatController?.abort()
  activeChatController = new AbortController()

  try {
    event.sender.send('app:ai-stream-start')

    await streamDoubaoReply(
      message,
      (chunk) => {
        event.sender.send('app:ai-stream-chunk', chunk)
      },
      activeChatController.signal,
    )

    event.sender.send('app:ai-stream-end')
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    event.sender.send('app:ai-stream-error', `流式请求失败：${msg}`)
  } finally {
    activeChatController = null
  }
})

ipcMain.on('app:ask-ai-stream-with-files', async (event, message: string, filePaths: string[]) => {
  activeChatController?.abort()
  activeChatController = new AbortController()

  try {
    event.sender.send('app:ai-stream-start')
    
    let fileContents: string[] = []
    
    for (const filePath of filePaths) {
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      
      if (['txt', 'md'].includes(ext)) {
        const data = await fs.readFile(filePath, 'utf-8')
        fileContents.push(`\n--- 文件: ${filePath} ---\n${data}`)
      } else if (ext === 'docx') {
        const result = await mammoth.convertToHtml({ path: filePath })
        fileContents.push(`\n--- 文件: ${filePath} ---\n${result.value}`)
      } else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
        // 对于图片，读取base64并添加到提示中
        const data = await fs.readFile(filePath)
        const base64 = data.toString('base64')
        fileContents.push(`\n--- 图片: ${filePath} ---\n[图片数据: ${ext}格式, base64长度: ${base64.length}]`)
      } else {
        event.sender.send('app:ai-stream-error', `不支持的文件类型: ${ext}，请使用TXT、MD、DOCX或图片文件`)
        return
      }
    }
    
    const prompt = `请分析以下文件内容并回答我的问题：

文件内容：
${fileContents.join('\n')}

我的问题：${message}

请基于所有文件内容进行详细分析和回答。如果有图片，请描述你看到的内容。`

    await streamDoubaoReply(
      prompt,
      (chunk) => {
        event.sender.send('app:ai-stream-chunk', chunk)
      },
      activeChatController.signal
    )

    event.sender.send('app:ai-stream-end')
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    event.sender.send('app:ai-stream-error', `流式请求失败：${msg}`)
  } finally {
    activeChatController = null
  }
})

ipcMain.on('app:stop-ai-stream', () => {
  activeChatController?.abort()
  activeChatController = null
})

ipcMain.handle('app:speech-to-text', async (_event, payload: SpeechToTextInput) => {
  try {
    const text = await speechToText(payload)
    return { ok: true, text }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    return { ok: false, text: '', error: msg }
  }
})

ipcMain.handle('app:text-to-speech', async (_event, text: string) => {
  try {
    const result = await textToSpeech(text)
    return { ok: true, ...result }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '未知错误'
    return { ok: false, audioBase64: '', mimeType: 'audio/mpeg', error: msg }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(createWindow)
