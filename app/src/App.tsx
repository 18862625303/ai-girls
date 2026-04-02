import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

declare global {
  interface Window {
    appAPI: {
      openFiles: () => Promise<string[]>
      readFileAsBase64: (filePath: string) => Promise<string>
      readDocxAsHtml: (filePath: string) => Promise<string>
      askAI: (message: string) => Promise<{ ok: boolean; reply: string }>
      askAIWithFiles: (message: string, filePaths: string[]) => Promise<{ ok: boolean; reply: string }>
      askAIStream: (message: string) => void
      askAIStreamWithFiles: (message: string, filePaths: string[]) => void
      stopAIStream: () => void
      speechToText: (payload: { audioBase64: string; mimeType?: string; fileName?: string; language?: string }) => Promise<{ ok: boolean; text: string; error?: string }>
      textToSpeech: (text: string) => Promise<{ ok: boolean; audioBase64: string; mimeType: string; error?: string }>
      onAIStreamStart: (cb: () => void) => () => void
      onAIStreamChunk: (cb: (chunk: string) => void) => () => void
      onAIStreamEnd: (cb: () => void) => () => void
      onAIStreamError: (cb: (errorText: string) => void) => () => void
    }
  }
}

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
type VoiceState = 'idle' | 'recording' | 'transcribing'

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

function toFileUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('/')) return encodeURI(`file://${normalized}`)
  return encodeURI(`file:///${normalized}`)
}

const AGENT_ACTION_LABEL: Record<AgentMood, string> = {
  idle: '待机',
  thinking: '思考中',
  speaking: '说话中',
}

async function blobToBase64(blob: Blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return window.btoa(binary)
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
  const [selectedFilesForAI, setSelectedFilesForAI] = useState<LocalFile[]>([])
  const [isDraggingOverAI, setIsDraggingOverAI] = useState(false)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [previewError, setPreviewError] = useState('')

  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; ow: number; oh: number } | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])

  const supportedText = useMemo(() => new Set(['txt', 'md']), [])

  useEffect(() => {
    const offStart = window.appAPI.onAIStreamStart(() => {
      setStatusMessage('AI 正在思考...')
      setAsking(true)
    })

    const offChunk = window.appAPI.onAIStreamChunk((chunk) => {
      setStreamReply((prev) => prev + chunk)
      setStatusMessage('AI 正在回复...')
      setAgentMood('speaking')
    })

    const offEnd = window.appAPI.onAIStreamEnd(() => {
      setAsking(false)
      setStatusMessage('')
      setAgentMood('idle')
    })

    const offError = window.appAPI.onAIStreamError((errorText) => {
      setStreamReply(errorText)
      setStatusMessage(`AI 请求失败：${errorText}`)
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

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
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

    setFiles((prev) => {
      const existingPaths = new Set(prev.map((f) => f.path))
      const deduped = next.filter((f) => !existingPaths.has(f.path))
      return [...deduped, ...prev]
    })
  }

  const openPreview = async (file: LocalFile) => {
    setPreview({ file, x: 110, y: 90, width: 760, height: 520 })
    setLoadingPreview(true)
    setPreviewError('')
    setPreviewUrl('')
    setTextPreview('')
    setDocxHtml('')

    try {
      if (file.ext === 'docx') {
        const html = await window.appAPI.readDocxAsHtml(file.path)
        setDocxHtml(html)
        return
      }

      if (file.ext === 'pdf') {
        setStatusMessage('PDF 使用文件直连模式预览，大文件加载更快。')
        setPreviewUrl(toFileUrl(file.path))
        return
      }

      const base64 = await window.appAPI.readFileAsBase64(file.path)

      if (supportedText.has(file.ext)) {
        setTextPreview(decodeBase64Text(base64))
      } else {
        const mime = mimeFromExt(file.ext)
        setPreviewUrl(`data:${mime};base64,${base64}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件预览失败'
      const friendly = file.ext === 'docx' ? 'Word 文件解析失败，请确认文件未损坏。' : `无法预览该文件：${message}`
      setPreviewError(friendly)
      setStatusMessage(`文件预览失败：${message}`)
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
    setStatusMessage('AI 正在思考...')
    setAsking(true)
    setAgentMood('thinking')
    
    if (selectedFilesForAI.length > 0) {
      window.appAPI.askAIStreamWithFiles(
        value,
        selectedFilesForAI.map((f) => f.path),
      )
    } else {
      window.appAPI.askAIStream(value)
    }
  }

  const stopGenerating = () => {
    window.appAPI.stopAIStream()
    setAsking(false)
    setStatusMessage('已停止生成')
    setAgentMood('idle')
  }

  const startRecording = async () => {
    setStatusMessage('')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const recorder = new MediaRecorder(stream)
    recordedChunksRef.current = []

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data)
    }

    recorder.onstop = async () => {
      try {
        setStatusMessage('语音识别中...')
        setVoiceState('transcribing')
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const audioBase64 = await blobToBase64(blob)
        const result = await window.appAPI.speechToText({
          audioBase64,
          mimeType: blob.type || 'audio/webm',
          fileName: 'recording.webm',
          language: 'zh',
        })

        if (!result.ok) {
          throw new Error(result.error || '语音识别失败')
        }

        setInput((prev) => (prev ? `${prev} ${result.text}` : result.text))
      } catch (error) {
        const message = error instanceof Error ? error.message : '语音识别失败'
        setStatusMessage(`语音错误：${message}`)
      } finally {
        stream.getTracks().forEach((track) => track.stop())
        setVoiceState('idle')
        mediaRecorderRef.current = null
        recordedChunksRef.current = []
        setStatusMessage('')
      }
    }

    recorder.start()
    mediaRecorderRef.current = recorder
    setStatusMessage('录音中...')
    setVoiceState('recording')
  }

  const onVoiceButtonClick = async () => {
    if (voiceState === 'transcribing') return

    try {
      if (voiceState === 'recording') {
        mediaRecorderRef.current?.stop()
        return
      }

      await startRecording()
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法启动录音'
      setStatusMessage(`语音错误：${message}`)
      setVoiceState('idle')
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOverAI(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOverAI(false)
  }

  const handleFileDragStart = (e: React.DragEvent, file: LocalFile) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(file))
    e.dataTransfer.effectAllowed = 'copy'
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDraggingOverAI(false)
    
    const newFiles: LocalFile[] = []
    
    const dragData = e.dataTransfer.getData('text/plain')
    
    if (dragData) {
      try {
        const file = JSON.parse(dragData) as LocalFile
        const ext = file.ext
        
        if (['txt', 'md', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
          newFiles.push(file)
        } else {
          alert('目前只支持 TXT、MD、DOCX 和图片文件（PNG、JPG、GIF等）的AI分析')
          return
        }
      } catch {
        // ignore invalid json drag payload
      }
    }
    
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length > 0) {
      for (const file of droppedFiles) {
        const ext = getExt(file.name)
        
        if (['txt', 'md', 'docx', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
          const localFile: LocalFile = {
            id: `dropped-${Date.now()}-${Math.random()}`,
            name: file.name,
            path: (file as File & { path?: string }).path || file.name,
            ext,
          }
          newFiles.push(localFile)
        } else {
          alert(`文件 ${file.name} 格式不支持，目前只支持 TXT、MD、DOCX 和图片文件`)
        }
      }
    }
    
    if (newFiles.length > 0) {
      setSelectedFilesForAI((prev) => [...prev, ...newFiles])
    }
  }

  const clearSelectedFiles = () => {
    setSelectedFilesForAI([])
  }

  const removeSelectedFile = (fileId: string) => {
    setSelectedFilesForAI((prev) => prev.filter((f) => f.id !== fileId))
  }

  const toggleFileSelect = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  const selectAllFiles = () => {
    setSelectedFileIds(new Set(files.map((f) => f.id)))
  }

  const clearFileSelection = () => {
    setSelectedFileIds(new Set())
  }

  const removeFileById = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      next.delete(fileId)
      return next
    })
    setSelectedFilesForAI((prev) => prev.filter((f) => f.id !== fileId))
  }

  const removeSelectedFiles = () => {
    if (selectedFileIds.size === 0) return
    const confirmed = window.confirm(`确认删除选中的 ${selectedFileIds.size} 个文件吗？`)
    if (!confirmed) return

    const selected = selectedFileIds
    setFiles((prev) => prev.filter((f) => !selected.has(f.id)))
    setSelectedFilesForAI((prev) => prev.filter((f) => !selected.has(f.id)))
    setSelectedFileIds(new Set())
  }

  const renderPreviewContent = () => {
    if (!preview) return null
    const ext = preview.file.ext

    if (loadingPreview) return <div className="preview-empty">加载中...</div>
    if (previewError) return <div className="preview-empty">{previewError}</div>
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

          {files.length > 0 ? (
            <div className="file-actions">
              <button className="ghost-btn" onClick={selectAllFiles}>全选</button>
              <button className="ghost-btn" onClick={clearFileSelection}>取消全选</button>
              <button className="ghost-btn" onClick={removeSelectedFiles} disabled={selectedFileIds.size === 0}>
                删除选中（{selectedFileIds.size}）
              </button>
            </div>
          ) : null}

          <div className="drop-zone">
            {files.length === 0 ? (
              <>
                <div className="drop-title">导入文件开始学习</div>
                <div className="drop-sub">点击右上角按钮后，可在列表打开统一预览弹窗</div>
              </>
            ) : (
              <div className="file-list">
                {files.map((f) => (
                  <div key={f.id} className="file-item-wrap">
                    <label className="file-check">
                      <input
                        type="checkbox"
                        checked={selectedFileIds.has(f.id)}
                        onChange={() => toggleFileSelect(f.id)}
                      />
                    </label>
                    <button
                      className="file-item"
                      onClick={() => openPreview(f)}
                      draggable
                      onDragStart={(e) => handleFileDragStart(e, f)}
                      title="点击预览，拖拽到AI区域进行分析"
                    >
                      <span className="file-name">{f.name}</span>
                      <span className="file-ext">.{f.ext || 'file'}</span>
                    </button>
                    <button className="file-delete-btn" onClick={() => removeFileById(f.id)} title="删除文件">
                      ✕
                    </button>
                  </div>
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
            <p className="muted">当前动作：{AGENT_ACTION_LABEL[agentMood]}</p>
            
            <div 
              className={`ai-drop-zone ${isDraggingOverAI ? 'dragging' : ''} ${selectedFilesForAI.length > 0 ? 'has-file' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {selectedFilesForAI.length > 0 ? (
                <div className="selected-files">
                  <div className="files-header">
                    <span>📁 已选择 {selectedFilesForAI.length} 个文件</span>
                    <button className="clear-files-btn" onClick={clearSelectedFiles}>清除全部</button>
                  </div>
                  <div className="files-list">
                    {selectedFilesForAI.map((file) => (
                      <div key={file.id} className="selected-file-item">
                        <span className="file-info">
                          {['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(file.ext) ? '🖼️' : '📄'} 
                          {file.name}
                        </span>
                        <button className="remove-file-btn" onClick={() => removeSelectedFile(file.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="drop-hint">
                  <span>📁 拖拽文件到这里进行AI分析</span>
                  <small>支持 TXT、MD、DOCX 和图片文件（可多选）</small>
                </div>
              )}
            </div>
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
        <button className="secondary-btn" onClick={onVoiceButtonClick} disabled={voiceState === 'transcribing'}>
          {voiceState === 'recording' ? '停止录音' : voiceState === 'transcribing' ? '识别中...' : '语音'}
        </button>
        {asking ? (
          <button className="secondary-btn" onClick={stopGenerating}>
            停止生成
          </button>
        ) : null}
        <button className="primary-btn" onClick={sendMessage} disabled={asking}>
          {asking ? '思考中...' : '发送'}
        </button>
      </div>
      {statusMessage ? <div className="muted" style={{ textAlign: 'center', marginTop: 8 }}>{statusMessage}</div> : null}
    </div>
  )
}

export default App
