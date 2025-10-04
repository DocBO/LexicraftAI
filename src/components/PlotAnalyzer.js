import React, { useState } from 'react';
import { geminiService } from '../services/geminiAPI';
import { useProject } from '../context/ProjectContext';
import { storageService } from '../services/storageService';

const PlotAnalyzer = () => {
  const [plotText, setPlotText] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [plotType, setPlotType] = useState('three-act');
  const { activeProject } = useProject();

  const plotStructures = [
    { value: 'three-act', label: 'Three-Act Structure' },
    { value: 'heros-journey', label: "Hero's Journey" },
    { value: 'seven-point', label: 'Seven-Point Story Structure' },
    { value: 'freytag', label: "Freytag's Pyramid" },
    { value: 'fichtean', label: 'Fichtean Curve' },
    { value: 'custom', label: 'Custom Analysis' }
  ];

  const analyzePlot = async () => {
    if (!plotText.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      const response = await geminiService.analyzePlotStructure(plotText, plotType);
      if (response.success) {
        setAnalysis(response.analysis);
        if (Array.isArray(response.chapters) && response.chapters.length > 0) {
          await persistChapters(response.chapters);
          setStatus('Chapters synced to Manuscript Manager');
        } else {
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

  const persistChapters = async (chapters) => {
    const normalized = chapters.map(chapter => {
      const safeTitle = chapter.title || 'Untitled Chapter';
      const safeSummary = chapter.summary || '';
      const tags = Array.isArray(chapter.tags) ? chapter.tags.join(', ') : '';
      const content = `${safeSummary}${tags ? `\n\nTags: ${tags}` : ''}`;

      return {
        id: Date.now() + Math.floor(Math.random() * 1000),
        title: safeTitle,
        content,
        wordCount: content.split(' ').filter(Boolean).length,
        status: chapter.purpose ? chapter.purpose : 'outline',
        createdAt: new Date().toISOString(),
      };
    });

    try {
      const response = await storageService.saveManuscript(normalized, activeProject);
      return response;
    } catch (err) {
      setError('Failed to sync chapters: ' + err.message);
    }
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
      </div>

      <textarea
        value={plotText}
        onChange={(e) => setPlotText(e.target.value)}
        placeholder="Paste your story outline, synopsis, or full text for plot analysis..."
        className="text-area plot-textarea"
        style={{ height: '400px' }}
      />

      <button 
        onClick={analyzePlot}
        disabled={loading || !plotText.trim()}
        className="button"
      >
        {loading ? 'Analyzing Plot...' : 'Analyze Plot Structure'}
      </button>

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
