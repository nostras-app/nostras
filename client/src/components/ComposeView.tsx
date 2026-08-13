import { useState } from 'react'
import { Composer } from './Composer'
import { ArticleComposer } from './ArticleComposer'
import { ZapGoalComposer } from './ZapGoalComposer'
import { PollComposer } from './PollComposer'

type Mode = 'note' | 'article' | 'zap-goal' | 'poll'

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
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'zap-goal'}
          className={`feed-tab${mode === 'zap-goal' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('zap-goal')}
        >
          Zap Goal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'poll'}
          className={`feed-tab${mode === 'poll' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('poll')}
        >
          Poll
        </button>
      </div>
      {mode === 'note' && <Composer />}
      {mode === 'article' && <ArticleComposer />}
      {mode === 'zap-goal' && <ZapGoalComposer />}
      {mode === 'poll' && <PollComposer />}
    </div>
  )
}
