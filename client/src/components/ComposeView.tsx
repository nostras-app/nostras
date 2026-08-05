import { useState } from 'react'
import { Composer } from './Composer'
import { ArticleComposer } from './ArticleComposer'

type Mode = 'note' | 'article'

export function ComposeView() {
  const [mode, setMode] = useState<Mode>('note')

  return (
    <div className="compose-view">
      <div className="feed-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'note'}
          className={`feed-tab${mode === 'note' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('note')}
        >
          Note
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'article'}
          className={`feed-tab${mode === 'article' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('article')}
        >
          Article
        </button>
      </div>
      {mode === 'note' ? <Composer /> : <ArticleComposer />}
    </div>
  )
}
