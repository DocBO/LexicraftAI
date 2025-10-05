import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { geminiService } from '../services/geminiAPI';
import { useProject } from '../context/ProjectContext';
import { storageService } from '../services/storageService';

const InsightCard = ({ label, value, accent }) => {
  if (!value) return null;

  let content = Array.isArray(value)
    ? value.filter(Boolean).join(', ')
    : value;

  if (typeof content === 'object') {
    content = JSON.stringify(content);
  }

  if (!content) return null;

  return (
    <article className={`insight-card insight-${accent}`}>
      <span className="insight-label">{label}</span>
      <p>{content}</p>
    </article>
  );
};

const PlotAnalyzer = () => {
  const [plotText, setPlotText] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [chapterSuggestions, setChapterSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [plotType, setPlotType] = useState('three-act');
  const [actionPrompt, setActionPrompt] = useState('');
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [promptPreview, setPromptPreview] = useState('');
  const [appliedDirectives, setAppliedDirectives] = useState('');
  const [responsePreview, setResponsePreview] = useState('');
  const { activeProject } = useProject();
  const storageKey = useMemo(() => `plot_analysis_${activeProject}`, [activeProject]);

  const plotStructures = [
    { value: 'three-act', label: 'Three-Act Structure' },
    { value: 'heros-journey', label: "Hero's Journey" },
    { value: 'seven-point', label: 'Seven-Point Story Structure' },
    { value: 'freytag', label: "Freytag's Pyramid" },
    { value: 'fichtean', label: 'Fichtean Curve' },
    { value: 'custom', label: 'Custom Analysis' }
  ];

  const initialLoad = useRef(true);
  const skipNextReset = useRef(false);
  const latestPlotType = useRef(plotType);

  useEffect(() => {
    latestPlotType.current = plotType;
  }, [plotType]);

  useEffect(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setPlotText(parsed.plotText || '');
        setAnalysis(parsed.analysis || null);
        const parsedType = parsed.plotType || 'three-act';
        if (parsedType !== latestPlotType.current) {
          skipNextReset.current = true;
          setPlotType(parsedType);
        } else {
          setPlotType(parsedType);
        }
        setChapterSuggestions(Array.isArray(parsed.chapterSuggestions) ? parsed.chapterSuggestions : []);
        const cachedPrompt = parsed.actionPrompt || '';
        setActionPrompt(cachedPrompt);
        setAppliedDirectives(cachedPrompt);
        setPromptPreview(parsed.promptPreview || '');
        setResponsePreview(parsed.responsePreview || '');
      }
    } catch (err) {
      console.warn('Failed to load cached plot analysis', err);
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        plotText,
        plotType,
        analysis,
        chapterSuggestions,
        actionPrompt,
        promptPreview,
        responsePreview,
      })
    );
  }, [plotText, plotType, analysis, chapterSuggestions, actionPrompt, promptPreview, responsePreview, storageKey]);

  const resetAnalysis = useCallback((keepPreviews = false, clearCache = false) => {
    setAnalysis(null);
    setChapterSuggestions([]);
    if (!keepPreviews) {
      setPromptPreview('');
      setResponsePreview('');
    }
    setStatus('');
    if (clearCache) {
      try {
        localStorage.removeItem(storageKey);
      } catch (err) {
        console.warn('Failed to clear cached plot analysis', err);
      }
    }
  }, [storageKey]);

  useEffect(() => {
    if (initialLoad.current) {
      initialLoad.current = false;
      return;
    }
    if (skipNextReset.current) {
      skipNextReset.current = false;
      return;
    }
    resetAnalysis(false, true);
    setAppliedDirectives('');
  }, [plotType, resetAnalysis]);

  const analyzePlot = async () => {
    if (!plotText.trim()) return;

    setLoading(true);
    setError('');
    resetAnalysis(false, true);
    setAppliedDirectives(actionPrompt.trim() ? actionPrompt : '');
    
    try {
      const response = await geminiService.analyzePlotStructure(plotText, plotType, actionPrompt);
      if (response.success) {
        setAnalysis(response.analysis);
        setPromptPreview(response.prompt || response.promptPreview || '');
        setResponsePreview(response.responsePreview || '');
        setAppliedDirectives(response.directives || (actionPrompt.trim() ? actionPrompt : ''));
        if (Array.isArray(response.chapters) && response.chapters.length > 0) {
          setChapterSuggestions(response.chapters);
          setStatus('Plot analyzed – chapters ready to sync');
        } else {
          setChapterSuggestions([]);
          setStatus('Plot analyzed');
        }
      }
    } catch (error) {
      setError('Failed to analyze plot: ' + error.message);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const loadExistingChapters = async () => {
    if (storageService.isBackendEnabled()) {
      const resp = await storageService.loadManuscript(activeProject);
      return resp?.chapters || [];
    }
    const key = `manuscript_chapters_${activeProject}`;
    const cached = localStorage.getItem(key);
    if (!cached) return [];
    try {
      return JSON.parse(cached);
    } catch (err) {
      console.warn('Failed to parse cached manuscript chapters', err);
      return [];
    }
  };

  const persistChapters = async (chapters, promptText = '', replaceExisting = false) => {
    const nowISO = new Date().toISOString();

    const normalized = chapters.map((chapter, index) => {
      const safeTitle = chapter.title || `Untitled Chapter ${index + 1}`;
      const safeSummary = chapter.summary || '';
      const tags = Array.isArray(chapter.tags) ? chapter.tags : [];
      const htmlSummary = safeSummary
        ? `<p>${safeSummary.replace(/\n/g, '<br/>')}</p>`
        : '<p></p>';
      const tagsLine = tags.length ? `<p><em>Tags: ${tags.join(', ')}</em></p>` : '';
      const purposeLine = chapter.purpose ? `<p><strong>Purpose:</strong> ${chapter.purpose}</p>` : '';
      const conflictLine = chapter.conflict ? `<p><strong>Conflict:</strong> ${chapter.conflict}</p>` : '';
      const promptNote = promptText.trim()
        ? `<p><em>Sync Prompt: ${promptText.trim()}</em></p>`
        : '';
      const mergedContent = `${htmlSummary}${purposeLine}${conflictLine}${tagsLine}${promptNote}`;
      const metadata = { ...(chapter.metadata || {}) };
      if (promptText.trim()) {
        metadata.syncPrompt = promptText.trim();
      }

      return {
        id: chapter.id || `plot-${Date.now()}-${index}`,
        title: safeTitle,
        content: mergedContent,
        wordCount: safeSummary.split(' ').filter(Boolean).length,
        status: chapter.purpose || 'outline',
        createdAt: chapter.createdAt || nowISO,
        ...(Object.keys(metadata).length ? { metadata } : {}),
      };
    });

    try {
      let combined = normalized;

      if (!replaceExisting) {
        const existing = await loadExistingChapters();
        const filteredExisting = existing.filter(existingChapter =>
          !normalized.some(newChapter => newChapter.title === existingChapter.title)
        );
        combined = [...normalized, ...filteredExisting];
      }

      const response = await storageService.saveManuscript(combined, activeProject);
      if (!storageService.isBackendEnabled()) {
        localStorage.setItem(
          `manuscript_chapters_${activeProject}`,
          JSON.stringify(combined)
        );
      } else if (response?.chapters) {
        localStorage.setItem(
          `manuscript_chapters_${activeProject}`,
          JSON.stringify(response.chapters)
        );
      }
      return response;
    } catch (err) {
      setError('Failed to sync chapters: ' + err.message);
    }
  };

  const handleSyncChapters = async () => {
    if (!chapterSuggestions.length) {
      setStatus('No chapter suggestions to sync');
      return;
    }
    const replaceExisting = window.confirm(
      'Replace existing Manuscript Manager chapters with these suggestions?\n\nSelect OK to replace, or Cancel to append the new chapters to your current manuscript.'
    );

    await persistChapters(chapterSuggestions, actionPrompt, replaceExisting);
    setStatus(
      replaceExisting
        ? 'Chapters replaced in Manuscript Manager'
        : 'Chapters appended to Manuscript Manager'
    );
    setChapterSuggestions([]);
  };

  const removeSuggestion = (indexToRemove) => {
    setChapterSuggestions(prev => prev.filter((_, index) => index !== indexToRemove));
    setStatus('Chapter suggestion removed');
  };

  const clearSuggestions = () => {
    setChapterSuggestions([]);
    setStatus('Chapter suggestions cleared');
  };

  const getStageColor = (progress) => {
    if (progress >= 80) return '#22c55e';
    if (progress >= 60) return '#eab308';
    if (progress >= 40) return '#f97316';
    return '#ef4444';
  };

  return (
    <div className="component plot-analyzer">
      <h2>📊 Plot Structure Analyzer</h2>
      
      <div className="plot-controls">
        <div className="structure-selector">
          <label>Plot Structure:</label>
          <select 
            value={plotType} 
            onChange={(e) => setPlotType(e.target.value)}
            className="mode-select"
          >
            {plotStructures.map(structure => (
              <option key={structure.value} value={structure.value}>
                {structure.label}
              </option>
            ))}
          </select>
        </div>

        <div className="plot-actions">
          <button 
            onClick={analyzePlot}
            disabled={loading || !plotText.trim()}
            className="button"
          >
            {loading ? 'Analyzing Plot...' : 'Analyze Plot'}
          </button>
          <button
            onClick={handleSyncChapters}
            className="button secondary"
            disabled={loading || chapterSuggestions.length === 0}
            title={chapterSuggestions.length === 0 ? 'Analyze your plot to generate chapters' : 'Send suggested chapters to Manuscript Manager'}
          >
            Sync Chapters{chapterSuggestions.length > 0 ? ` (${chapterSuggestions.length})` : ''}
          </button>
        </div>
      </div>

      <textarea
        value={plotText}
        onChange={(e) => setPlotText(e.target.value)}
        placeholder="Paste your story outline, synopsis, or full text for plot analysis..."
        className="text-area plot-textarea"
        style={{ height: '400px' }}
      />

      {error && <div className="error-message">{error}</div>}
      {status && <div className="status-message">{status}</div>}

      <div className="plot-chapter-suggestions">
        <div className="chapter-suggestions-header">
          <h3>Chapter Suggestions</h3>
          {chapterSuggestions.length > 0 && (
            <button className="button tertiary" onClick={clearSuggestions}>
              Clear All
            </button>
          )}
        </div>
        {(appliedDirectives || promptPreview || responsePreview) && (
          <div className="prompt-preview">
            {appliedDirectives && (
              <p><strong>Applied Directives:</strong> {appliedDirectives}</p>
            )}
            {promptPreview && (
              <details>
                <summary>Prompt Preview</summary>
                <pre>{promptPreview}</pre>
              </details>
            )}
            {responsePreview && (
              <details>
                <summary>Response Preview</summary>
                <pre>{responsePreview}</pre>
              </details>
            )}
          </div>
        )}
        {chapterSuggestions.length === 0 ? (
          <p className="empty-state">Analyze your plot to generate chapter outlines ready for Manuscript Manager.</p>
        ) : (
          <div className="suggestions-grid">
            {chapterSuggestions.map((chapter, index) => (
              <div key={chapter.id || index} className="suggestion-card">
                <button
                  type="button"
                  className="suggestion-remove"
                  onClick={() => removeSuggestion(index)}
                  aria-label={`Remove chapter suggestion ${index + 1}`}
                >
                  ×
                </button>
                <div className="suggestion-header">
                  <span className="suggestion-index">Chapter {index + 1}</span>
                  <h4>{chapter.title || `Untitled Chapter ${index + 1}`}</h4>
                </div>
                {chapter.summary && <p className="suggestion-summary">{chapter.summary}</p>}
                <ul className="suggestion-details">
                  {chapter.purpose && <li><strong>Purpose:</strong> {chapter.purpose}</li>}
                  {chapter.conflict && <li><strong>Conflict:</strong> {chapter.conflict}</li>}
                  {Array.isArray(chapter.tags) && chapter.tags.length > 0 && (
                    <li><strong>Tags:</strong> {chapter.tags.join(', ')}</li>
                  )}
                  {Array.isArray(chapter.metadata?.hooks) && chapter.metadata.hooks.length > 0 && (
                    <li><strong>Hooks:</strong> {chapter.metadata.hooks.join(', ')}</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {analysis && (
        <div className="plot-analysis">
          <div className="plot-overview">
            <h3>Plot Structure Analysis</h3>
            <div className="overall-score">
              <div className="score-circle">
                <span className="score-number">{analysis.overallScore}</span>
                <span className="score-label">Structure Score</span>
              </div>
            </div>
            {analysis.structureSummary && (
              <p className="structure-summary">{analysis.structureSummary}</p>
            )}
          </div>

          <div className="plot-stages">
            <h4>Story Stages</h4>
            {analysis.stages?.map((stage, index) => {
              const progress = typeof stage.progressPercent === 'number'
                ? stage.progressPercent
                : typeof stage.completion === 'number'
                ? stage.completion
                : 0;
              const notes = stage.notes || stage.description || '';

              return (
                <div key={index} className="stage-item">
                  <header className="stage-header">
                    <div className="stage-title">
                      <span className="stage-step">Step {index + 1}</span>
                      <h5>{stage.name || `Stage ${index + 1}`}</h5>
                    </div>
                    <span
                      className="stage-progress-pill"
                      style={{ borderColor: getStageColor(progress), color: getStageColor(progress) }}
                    >
                      {progress}%
                    </span>
                  </header>

                  <div className="stage-progress">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${progress}%`,
                        backgroundColor: getStageColor(progress)
                      }}
                    ></div>
                  </div>

                  {stage.focus && (
                    <p className="stage-focus">
                      <strong>Focus:</strong> {stage.focus}
                    </p>
                  )}

                  {notes && <p className="stage-notes">{notes}</p>}


                  {Array.isArray(stage.keyBeats) && stage.keyBeats.length > 0 && (
                    <div className="stage-list">
                      <strong>Key Beats</strong>
                      <ul>
                        {stage.keyBeats.map((beat, beatIndex) => (
                          <li key={beatIndex}>{beat}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(stage.suggestions) && stage.suggestions.length > 0 && (
                    <div className="stage-list">
                      <strong>Opportunities</strong>
                      <ul>
                        {stage.suggestions.map((suggestion, suggestionIndex) => (
                          <li key={suggestionIndex}>{suggestion}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {stage.transition && (
                    <div className="stage-transition">
                      <strong>Transition:</strong> {stage.transition}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="plot-insights">
            <h4>Story Insights</h4>
            <div className="insights-grid">
              <InsightCard label="Pacing" value={analysis.pacing} accent="timing" />
              <InsightCard label="Conflict" value={analysis.conflict} accent="conflict" />
              <InsightCard label="Character Arc" value={analysis.characterArc} accent="character" />
              <InsightCard label="Themes" value={analysis.themes || analysis.themeDevelopment} accent="theme" />
            </div>
          </div>

          {Array.isArray(analysis.recommendations) && analysis.recommendations.length > 0 && (
            <div className="plot-recommendations">
              <h4>Recommendations</h4>
              <div className="recommendations-list">
                {analysis.recommendations.map((rec, index) => (
                  <article key={index} className="recommendation-card">
                    <header>
                      <span className={`priority-pill priority-${(rec.priority || 'medium').toLowerCase()}`}>
                        {rec.priority || 'medium'}
                      </span>
                      <h5>{rec.title || `Recommendation ${index + 1}`}</h5>
                    </header>
                    <p>{rec.description}</p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className={`action-prompt-drawer ${isPromptOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="prompt-toggle"
          onClick={() => setIsPromptOpen(prev => !prev)}
          aria-expanded={isPromptOpen}
        >
          {isPromptOpen ? 'Close Action Prompt' : 'Open Action Prompt'}
        </button>
        {isPromptOpen && (
          <div className="prompt-content">
            <label htmlFor="action-prompt-input">Sync Prompt</label>
            <textarea
              id="action-prompt-input"
              value={actionPrompt}
              onChange={(e) => setActionPrompt(e.target.value)}
              placeholder="Add extra guidance for chapter sync (e.g., ensure 12 chapters)."
            />
            <div className="prompt-actions">
              <button className="button tertiary" onClick={() => setActionPrompt('')}>
                Clear Prompt
              </button>
              <span className="prompt-hint">This note is attached whenever chapters sync to the Manuscript Manager.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlotAnalyzer;
