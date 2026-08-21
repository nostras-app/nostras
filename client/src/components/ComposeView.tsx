import { useState } from 'react'
import { Composer } from './Composer'
import { ArticleComposer } from './ArticleComposer'
import { ZapGoalComposer } from './ZapGoalComposer'
import { PollComposer } from './PollComposer'
import { ThreadComposer } from './ThreadComposer'
import { PodcastComposer } from './PodcastComposer'
import { ListingComposer } from './ListingComposer'

type Mode = 'note' | 'article' | 'zap-goal' | 'poll' | 'thread' | 'podcast' | 'listing'

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
          aria-selected={mode === 'thread'}
          className={`feed-tab${mode === 'thread' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('thread')}
        >
          Thread
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'podcast'}
          className={`feed-tab${mode === 'podcast' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('podcast')}
        >
          Podcast
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
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'listing'}
          className={`feed-tab${mode === 'listing' ? ' feed-tab-active' : ''}`}
          onClick={() => setMode('listing')}
        >
          Listing
        </button>
      </div>
      {mode === 'note' && <Composer />}
      {mode === 'article' && <ArticleComposer />}
      {mode === 'thread' && <ThreadComposer />}
      {mode === 'podcast' && <PodcastComposer />}
      {mode === 'zap-goal' && <ZapGoalComposer />}
      {mode === 'poll' && <PollComposer />}
      {mode === 'listing' && <ListingComposer />}
    </div>
  )
}
