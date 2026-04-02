import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type LocalFile = {
  id: string
  name: string
  path: string
  ext: string
}

type PreviewState = {
  file: LocalFile
  x: number
  y: number
  width: number
  height: number
} | null

type AgentMood = 'idle' | 'thinking' | 'speaking'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'aac', 'flac'])
const TEXT_EXTS = new Set(['txt', 'md'])

function getExt(name: string) {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : ''
}

function mimeFromExt(ext: string) {
  if (IMAGE_EXTS.has(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`
  if (VIDEO_EXTS.has(ext)) return `video/${ext === 'mkv' ? 'x-matroska' : ext}`
  if (AUDIO_EXTS.has(ext)) return `audio/${ext}`
  if (ext === 'pdf') return 'application/pdf'
  return 'application/octet-stream'
}

function decodeBase64Text(base64: string) {
  const binary = window.atob(base64)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function App() {
  const [files, setFiles] = useState<LocalFile[]>([])
  const [preview, setPreview] = useState<PreviewState>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [textPreview, setTextPreview] = useState('')
  const [docxHtml, setDocxHtml] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)

  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [streamReply, setStreamReply] = useState('')
  const [agentMood, setAgentMood] = useState<AgentMood>('idle')

  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; ow: number; oh: number } | null>(null)

  const supportedText = useMemo(() => new Set(['txt', 'md']), [])

  useEffect(() => {
    const offStart = window.appAPI.onAIStreamStart(() => {
      setStreamReply('')
      setAgentMood('speaking')
      setAsking(true)
    })

    const offChunk = window.appAPI.onAIStreamChunk((chunk) => {
      setStreamReply((prev) => prev + chunk)
      setAgentMood('speaking')
    })

    const offEnd = window.appAPI.onAIStreamEnd(() => {
      setAsking(false)
      setAgentMood('idle')
    })

    const offError = window.appAPI.onAIStreamError((errorText) => {
      setStreamReply(errorText)
      setAsking(false)
      setAgentMood('idle')
    })

    return () => {
      offStart()
      offChunk()
      offEnd()
      offError()
    }
  }, [])

  const importFiles = async () => {
    const paths = await window.appAPI.openFiles()
    if (!paths?.length) return

    const next = paths.map((p) => {
      const parts = p.split(/[/\\]/)
      const name = parts[parts.length - 1]
      return {
        id: `${p}-${Date.now()}-${Math.random()}`,
        name,
        path: p,
        ext: getExt(name),
      }
    })

    setFiles((prev) => [...next, ...prev])
  }

  const openPreview = async (file: LocalFile) => {
    setPreview({ file, x: 110, y: 90, width: 760, height: 520 })
    setLoadingPreview(true)
    setPreviewUrl('')
    setTextPreview('')
    setDocxHtml('')

    try {
      if (file.ext === 'docx') {
        const html = await window.appAPI.readDocxAsHtml(file.path)
        setDocxHtml(html)
        return
      }

      const base64 = await window.appAPI.readFileAsBase64(file.path)

      if (supportedText.has(file.ext)) {
        setTextPreview(decodeBase64Text(base64))
      } else {
        const mime = mimeFromExt(file.ext)
        setPreviewUrl(`data:${mime};base64,${base64}`)
      }
    } finally {
      setLoadingPreview(false)
    }
  }

  const onDragStart: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (!preview) return

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ox: preview.x,
      oy: preview.y,
    }

    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      const dy = ev.clientY - dragRef.current.startY
      setPreview((prev) => (prev ? { ...prev, x: dragRef.current!.ox + dx, y: dragRef.current!.oy + dy } : prev))
    }

    const up = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onResizeStart: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation()
    if (!preview) return

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      ow: preview.width,
      oh: preview.height,
    }

    const move = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const dx = ev.clientX - resizeRef.current.startX
      const dy = ev.clientY - resizeRef.current.startY
      setPreview((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          width: Math.max(420, resizeRef.current!.ow + dx),
          height: Math.max(280, resizeRef.current!.oh + dy),
        }
      })
    }

    const up = () => {
      resizeRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }

    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const sendMessage = () => {
    const value = input.trim()
    if (!value || asking) return

    setInput('')
    setStreamReply('')
    setAgentMood('thinking')
    window.appAPI.askAIStream(value)
  }

  const renderPreviewContent = () => {
    if (!preview) return null
    const ext = preview.file.ext

    if (loadingPreview) return <div className="preview-empty">加载中...</div>
    if (!previewUrl && !textPreview && !docxHtml) return <div className="preview-empty">暂不支持该格式预览。</div>

    if (ext === 'docx') return <div className="docx-preview" dangerouslySetInnerHTML={{ __html: docxHtml }} />
    if (TEXT_EXTS.has(ext)) return <pre className="text-preview">{textPreview}</pre>
    if (IMAGE_EXTS.has(ext)) return <img className="preview-image" src={previewUrl} alt={preview.file.name} />
    if (VIDEO_EXTS.has(ext)) return <video className="preview-media" src={previewUrl} controls />
    if (AUDIO_EXTS.has(ext)) return <audio className="preview-audio" src={previewUrl} controls />
    if (ext === 'pdf') return <iframe className="preview-pdf" src={previewUrl} title={preview.file.name} />

    return <div className="preview-empty">暂不支持该格式预览。</div>
  }

  return (
    <div className="app">
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />

      <header className="top-bar glass">
        <div className="brand-wrap">
          <div className="brand-dot" />
          <div>
            <div className="logo">AI 学习收容仓</div>
            <div className="logo-sub">Pure Learning Space</div>
          </div>
        </div>
        <div className="top-avatar">A</div>
      </header>

      <main className="main-layout">
        <section className="file-zone glass panel">
          <div className="panel-head">
            <h2>文件区</h2>
            <button className="ghost-btn" onClick={importFiles}>
              + 导入文件
            </button>
          </div>
          <p className="muted">支持 PDF / Word / TXT / MD / 图片 / 音频 / 视频（当前优先实现基础预览）</p>

          <div className="drop-zone">
            {files.length === 0 ? (
              <>
                <div className="drop-title">导入文件开始学习</div>
                <div className="drop-sub">点击右上角按钮后，可在列表打开统一预览弹窗</div>
              </>
            ) : (
              <div className="file-list">
                {files.map((f) => (
                  <button key={f.id} className="file-item" onClick={() => openPreview(f)}>
                    <span className="file-name">{f.name}</span>
                    <span className="file-ext">.{f.ext || 'file'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="agent-panel">
          <div className="agent-card glass panel">
            <div className={`agent-avatar ${agentMood}`}>
              <div className="agent-body">动漫角色</div>
              <div className={`agent-mouth ${agentMood === 'speaking' ? 'active' : ''}`} />
            </div>
            <div className={`speech-bubble ${streamReply ? 'show' : ''}`}>{streamReply || '等待你提问中...'}</div>
            <p className="muted">当前动作：{agentMood === 'thinking' ? '思考中' : agentMood === 'speaking' ? '说话中' : '待机'}</p>
          </div>
        </aside>
      </main>

      {preview && (
        <div className="preview-mask" onClick={() => setPreview(null)}>
          <div
            className="preview-window glass"
            style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-head" onMouseDown={onDragStart}>
              <span>{preview.file.name}</span>
              <button onClick={() => setPreview(null)}>关闭</button>
            </div>
            <div className="preview-body">{renderPreviewContent()}</div>
            <div className="resize-handle" onMouseDown={onResizeStart} />
          </div>
        </div>
      )}

      <div className="chat-reveal-zone" aria-hidden="true" />
      <div className="chat-floating glass">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendMessage()
          }}
          placeholder="输入你的问题，按 Enter 发送..."
        />
        <button className="secondary-btn" disabled>
          语音
        </button>
        <button className="primary-btn" onClick={sendMessage} disabled={asking}>
          {asking ? '思考中...' : '发送'}
        </button>
      </div>
    </div>
  )
}

export default App
