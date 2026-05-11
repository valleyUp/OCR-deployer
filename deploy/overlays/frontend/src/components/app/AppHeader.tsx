import { useMemo } from 'react'
import type { TaskResponse, UploadedFile } from '@/routes/_ocr/FileUpload'

interface AppHeaderProps {
  uploadFile: UploadedFile | null
  result: TaskResponse | null
}

export function AppHeader({ uploadFile, result }: AppHeaderProps) {
  const mode = useMemo(() => {
    const m = result?.response?.processing_mode
      || result?.response?.metadata?.processing_mode
      || uploadFile?.processingMode
      || 'pipeline'
    return m as string
  }, [result, uploadFile])

  const isFormula = mode === 'formula'

  return (
    <header className='topbar'>
      <span className='topbar-brand'>OCRServer</span>
      <span className='topbar-mode-badge'>
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: isFormula ? 'var(--color-accent)' : 'var(--color-success)',
          display: 'inline-block'
        }} />
        {isFormula ? 'Formula' : 'Layout'}
      </span>
    </header>
  )
}
