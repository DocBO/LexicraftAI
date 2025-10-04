import React, { useEffect, useMemo, useState } from 'react';
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
      }
    } catch (err) {
      console.warn('Failed to load cached plot analysis', err);
    }
  }, [storageKey]);

  useEffect(() => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ plotText, plotType, analysis, chapterSuggestions })
    );
  }, [plotText, plotType, analysis, chapterSuggestions, storageKey]);

  const analyzePlot = async () => {
    if (!plotText.trim()) return;

    setLoading(true);
    setError('');
    
    try {
      const response = await geminiService.analyzePlotStructure(plotText, plotType);
      if (response.success) {
        setAnalysis(response.analysis);
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

  const persistChapters = async (chapters) => {
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
      const mergedContent = `${htmlSummary}${purposeLine}${conflictLine}${tagsLine}`;

      return {
        id: chapter.id || `plot-${Date.now()}-${index}`,
        title: safeTitle,
        content: mergedContent,
        wordCount: safeSummary.split(' ').filter(Boolean).length,
        status: chapter.purpose || 'outline',
        createdAt: chapter.createdAt || nowISO,
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
    await persistChapters(chapterSuggestions);
    setStatus('Chapters synced to Manuscript Manager');
    setChapterSuggestions([]);
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
          {chapterSuggestions.length > 0 && !loading && (
            <button
              onClick={handleSyncChapters}
              className="button secondary"
            >
              Sync Chapters
            </button>
          )}
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
    </div>
  );
};

export default PlotAnalyzer;
