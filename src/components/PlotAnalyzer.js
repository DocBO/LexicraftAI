import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { geminiService } from '../services/geminiAPI';
import { useProject } from '../context/ProjectContext';
import { storageService } from '../services/storageService';

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

  useEffect(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        setPlotText(parsed.plotText || '');
        setAnalysis(parsed.analysis || null);
        setPlotType(parsed.plotType || 'three-act');
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

  const resetAnalysis = useCallback((keepPreviews = false) => {
    setAnalysis(null);
    setChapterSuggestions([]);
    if (!keepPreviews) {
      setPromptPreview('');
      setResponsePreview('');
    }
    setStatus('');
  }, []);

  useEffect(() => {
    resetAnalysis();
    setAppliedDirectives('');
  }, [plotType, resetAnalysis]);

  const analyzePlot = async () => {
    if (!plotText.trim()) return;

    setLoading(true);
    setError('');
    resetAnalysis();
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

  const persistChapters = async (chapters, promptText = '') => {
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
      const existing = await loadExistingChapters();
      const filteredExisting = existing.filter(existingChapter =>
        !normalized.some(newChapter => newChapter.title === existingChapter.title)
      );
      const combined = [...normalized, ...filteredExisting];
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
    await persistChapters(chapterSuggestions, actionPrompt);
    setStatus(actionPrompt.trim() ? 'Chapters synced with custom prompt' : 'Chapters synced to Manuscript Manager');
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

  const getStageColor = (completion) => {
    if (completion >= 80) return '#22c55e';
    if (completion >= 60) return '#eab308';
    if (completion >= 40) return '#f97316';
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
          </div>

          <div className="plot-stages">
            <h4>Story Stages:</h4>
            {analysis.stages?.map((stage, index) => (
              <div key={index} className="stage-item">
                <div className="stage-header">
                  <span className="stage-name">{stage.name}</span>
                  <span 
                    className="stage-completion"
                    style={{ color: getStageColor(stage.completion) }}
                  >
                    {stage.completion}% Complete
                  </span>
                </div>
                
                <div className="stage-progress">
                  <div 
                    className="progress-bar"
                    style={{ 
                      width: `${stage.completion}%`,
                      backgroundColor: getStageColor(stage.completion)
                    }}
                  ></div>
                </div>
                
                <p className="stage-description">{stage.description}</p>
                
                {stage.suggestions && (
                  <div className="stage-suggestions">
                    <strong>Suggestions:</strong>
                    <ul>
                      {stage.suggestions.map((suggestion, idx) => (
                        <li key={idx}>{suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="plot-insights">
            <h4>Story Insights:</h4>
            <div className="insights-grid">
              <div className="insight-card">
                <h5>Pacing</h5>
                <p>{analysis.pacing}</p>
              </div>
              <div className="insight-card">
                <h5>Conflict</h5>
                <p>{analysis.conflict}</p>
              </div>
              <div className="insight-card">
                <h5>Character Arc</h5>
                <p>{analysis.characterArc}</p>
              </div>
              <div className="insight-card">
                <h5>Theme Development</h5>
                <p>{analysis.themeDevelopment}</p>
              </div>
            </div>
          </div>

          {analysis.recommendations && (
            <div className="plot-recommendations">
              <h4>Recommendations:</h4>
              <div className="recommendations-list">
                {analysis.recommendations.map((rec, index) => (
                  <div key={index} className="recommendation-item">
                    <div className="recommendation-priority">
                      {rec.priority.toUpperCase()}
                    </div>
                    <div className="recommendation-content">
                      <h5>{rec.title}</h5>
                      <p>{rec.description}</p>
                    </div>
                  </div>
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
