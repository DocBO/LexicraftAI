import React, { useState, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { geminiService } from '../services/geminiAPI';
import { storageService } from '../services/storageService';
import { useProject } from '../context/ProjectContext';

const modules = {
  toolbar: [
    [{ 'header': [1, 2, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{'list': 'ordered'}, {'list': 'bullet'}],
    ['clean']
  ],
};

const formats = [
  'header',
  'bold', 'italic', 'underline', 'strike',
  'list', 'bullet'
];

const getPlainText = (html) => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  return tempDiv.textContent || tempDiv.innerText || '';
};

const ManuscriptManager = () => {
  const { activeProject } = useProject();
  const storageEnabled = storageService.isBackendEnabled();
  const [chapters, setChapters] = useState([]);
  const [currentChapter, setCurrentChapter] = useState({ title: '', content: '', wordCount: 0 });
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [factExtractionLoading, setFactExtractionLoading] = useState(false);
  const [consistencyLoading, setConsistencyLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editingChapter, setEditingChapter] = useState(null);
  const [storageReady, setStorageReady] = useState(!storageEnabled);

  useEffect(() => {
    let cancelled = false;

    setStorageReady(!storageEnabled);

    const loadChapters = async () => {
      if (storageEnabled) {
        try {
          const response = await storageService.loadManuscript(activeProject);
          if (!cancelled && response?.chapters) {
            setChapters(response.chapters);
          }
        } catch (err) {
          if (!cancelled) {
            setError('Failed to load saved chapters: ' + err.message);
          }
        } finally {
          if (!cancelled) {
            setStorageReady(true);
          }
        }
      } else {
        const key = `manuscript_chapters_${activeProject}`;
        const savedChapters = localStorage.getItem(key);
        if (!cancelled && savedChapters) {
          setChapters(JSON.parse(savedChapters));
        }
        if (!cancelled) {
          setStorageReady(true);
        }
      }
    };

    loadChapters();

    return () => {
      cancelled = true;
    };
  }, [storageEnabled, activeProject]);

  const persistChapters = async (nextChapters) => {
    setChapters(nextChapters);
    if (storageEnabled) {
      try {
        const saved = await storageService.saveManuscript(nextChapters, activeProject);
        if (saved?.chapters) {
          setChapters(saved.chapters);
          return saved.chapters;
        }
      } catch (err) {
        setError('Failed to save chapters: ' + err.message);
      }
    } else {
      const key = `manuscript_chapters_${activeProject}`;
      localStorage.setItem(key, JSON.stringify(nextChapters));
    }
    return nextChapters;
  };

  const addChapter = async () => {
    if (!storageReady) return;
    const plainContent = getPlainText(currentChapter.content);
    if (!currentChapter.title.trim() || !plainContent.trim()) return;

    const newChapter = {
      id: Date.now(),
      title: currentChapter.title,
      content: currentChapter.content,
      wordCount: plainContent.split(' ').filter(w => w).length,
      createdAt: new Date().toLocaleDateString(),
      status: 'draft'
    };

    const next = [...chapters, newChapter];
    await persistChapters(next);
    setCurrentChapter({ title: '', content: '', wordCount: 0 });
  };

  const updateChapter = async (id, updatedChapter) => {
    if (!storageReady) return;
    const next = chapters.map(chapter => 
      chapter.id === id 
        ? { 
            ...chapter, 
            ...updatedChapter, 
            wordCount: getPlainText(updatedChapter.content).split(' ').filter(w => w).length 
          }
        : chapter
    );
    await persistChapters(next);
    setEditingChapter(null);
  };

  const deleteChapter = async (id) => {
    if (!storageReady) return;
    const next = chapters.filter(chapter => chapter.id !== id);
    await persistChapters(next);
  };

  const analyzeManuscript = async () => {
    if (chapters.length === 0) return;

    setAnalysisLoading(true);
    setError('');

    try {
      const chapterData = chapters.map(ch => ({
        title: ch.title,
        wordCount: ch.wordCount,
        content: getPlainText(ch.content).substring(0, 500) // First 500 chars for analysis
      }));

      const response = await geminiService.analyzeManuscript(chapterData);
      if (response.success) {
        setAnalysis(response.analysis);
      }
    } catch (error) {
      setError('Failed to analyze manuscript: ' + error.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const extractWorldFacts = async () => {
    setStatus('');
    setError('');

    if (factExtractionLoading || consistencyLoading || analysisLoading) {
      return;
    }

    if (!storageReady || chapters.length === 0) {
      setError('No chapters available to extract facts.');
      return;
    }

    try {
      setFactExtractionLoading(true);
      const facts = chapters.flatMap(chapter => {
        const text = getPlainText(chapter.content);
        const sentences = text.split(/(?<=[\.\!\?])\s+/);
        const majorSentences = sentences.filter(sentence => sentence.split(' ').length >= 6);
        return majorSentences.slice(0, 2).map((sentence, index) => ({
          title: `${chapter.title || 'Chapter'} Fact ${index + 1}`,
          summary: sentence.trim(),
          details: {
            chapter: chapter.title,
            status: chapter.status,
          },
          tags: ['auto-extracted', chapter.status].filter(Boolean),
        }));
      });

      if (!facts.length) {
        setStatus('No substantial facts extracted.');
        return;
      }

      for (const fact of facts) {
        await storageService.saveWorldFact(fact, activeProject);
      }

      setStatus(`${facts.length} world facts extracted and saved.`);
    } catch (err) {
      setError('Failed to extract world facts: ' + err.message);
    } finally {
      setFactExtractionLoading(false);
    }
  };

  const checkWorldConsistency = async () => {
    if (consistencyLoading || factExtractionLoading || analysisLoading) {
      return;
    }

    setError('');
    setStatus('');
    setConsistencyLoading(true);

    try {
      const facts = await storageService.listWorldFacts(activeProject);
      if (!facts.length) {
        setStatus('No world facts available to cross-check.');
        return;
      }

      const factMap = new Map();
      const conflicts = [];

      facts.forEach(fact => {
        const key = fact.title.toLowerCase();
        if (factMap.has(key) && factMap.get(key).summary !== fact.summary) {
          conflicts.push({
            title: fact.title,
            summaries: [factMap.get(key).summary, fact.summary],
          });
        } else {
          factMap.set(key, fact);
        }
      });

      if (conflicts.length) {
        setAnalysis(prev => ({
          ...(prev || {}),
          worldConsistency: conflicts,
        }));
        setStatus(`World consistency issues found: ${conflicts.length}`);
      } else {
        setStatus('World facts align with the manuscript.');
      }
    } catch (err) {
      setError('Failed to check world consistency: ' + err.message);
    } finally {
      setConsistencyLoading(false);
    }
  };

  const handleContentChange = (content) => {
    setCurrentChapter(prev => ({
      ...prev,
      content,
      wordCount: getPlainText(content).split(' ').filter(w => w).length
    }));
  };

  const totalWordCount = chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  const averageChapterLength = chapters.length > 0 ? Math.round(totalWordCount / chapters.length) : 0;

  return (
    <div className="component manuscript-manager">
      <h2>📖 Manuscript Manager</h2>
      
      <div className="manuscript-stats">
        <div className="stat-card">
          <h3>{chapters.length}</h3>
          <p>Chapters</p>
        </div>
        <div className="stat-card">
          <h3>{totalWordCount.toLocaleString()}</h3>
          <p>Total Words</p>
        </div>
        <div className="stat-card">
          <h3>{averageChapterLength}</h3>
          <p>Avg. Chapter Length</p>
        </div>
        <div className="stat-card">
          <h3>{Math.round(totalWordCount / 250)}</h3>
          <p>Estimated Pages</p>
        </div>
      </div>

      <div className="chapter-input-section">
        <h3>Add New Chapter</h3>
        <input
          type="text"
          value={currentChapter.title}
          onChange={(e) => setCurrentChapter(prev => ({ ...prev, title: e.target.value }))}
          placeholder="Chapter title..."
          className="chapter-title-input"
        />
        
        <ReactQuill
          value={currentChapter.content}
          onChange={handleContentChange}
          placeholder="Write your chapter content here..."
          className="chapter-content-input"
          modules={modules}
          formats={formats}
        />
        
        <div className="chapter-input-footer">
          <span className="word-count">{currentChapter.wordCount} words</span>
          <button 
            onClick={addChapter}
            disabled={!storageReady || !currentChapter.title.trim() || !getPlainText(currentChapter.content).trim()}
            className="button"
          >
            Add Chapter
          </button>
        </div>
      </div>

      <div className="chapters-list">
        <div className="chapters-header">
          <h3>Chapters ({chapters.length})</h3>
          <div className="manuscript-actions">
            <button 
              onClick={analyzeManuscript}
              disabled={analysisLoading || chapters.length === 0 || !storageReady || factExtractionLoading || consistencyLoading}
              className="button secondary"
            >
              {analysisLoading ? 'Analyzing...' : 'Analyze Manuscript'}
            </button>
            <button
              onClick={extractWorldFacts}
              disabled={!storageReady || chapters.length === 0 || factExtractionLoading || consistencyLoading || analysisLoading}
              className="button secondary"
            >
              {factExtractionLoading ? 'Extracting Facts...' : 'Extract World Facts'}
            </button>
            <button
              onClick={checkWorldConsistency}
              disabled={consistencyLoading || factExtractionLoading || analysisLoading}
              className="button secondary"
            >
              {consistencyLoading ? 'Checking Consistency...' : 'Check World Consistency'}
            </button>
          </div>
        </div>

        {chapters.map((chapter, index) => (
          <div key={chapter.id} className="chapter-item">
            {editingChapter === chapter.id ? (
              <ChapterEditor 
                chapter={chapter}
                onSave={(updated) => updateChapter(chapter.id, updated)}
                onCancel={() => setEditingChapter(null)}
              />
            ) : (
              <ChapterDisplay
                chapter={chapter}
                index={index}
                onEdit={() => setEditingChapter(chapter.id)}
                onDelete={() => deleteChapter(chapter.id)}
              />
            )}
          </div>
        ))}
      </div>

      {status && <div className="status-message">{status}</div>}

      {error && <div className="error-message">{error}</div>}

      {analysis && (
        <div className="manuscript-analysis">
          <h3>Manuscript Analysis</h3>
          
          <div className="analysis-overview">
            <div className="progress-circle">
              <span className="progress-number">{analysis.overallProgress}%</span>
              <span className="progress-label">Overall Progress</span>
            </div>
            
            <div className="readability-score">
              <span className="score-number">{analysis.readabilityScore}</span>
              <span className="score-label">Readability Score</span>
            </div>
          </div>

          <div className="analysis-details">
            <div className="analysis-section">
              <h4>Pacing Analysis</h4>
              <p>{analysis.paceAnalysis}</p>
            </div>

            {analysis.consistencyIssues.length > 0 && (
              <div className="analysis-section">
                <h4>Consistency Issues</h4>
                <ul>
                  {analysis.consistencyIssues.map((issue, index) => (
                    <li key={index} className="issue-item">{issue}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="analysis-section">
              <h4>Suggestions</h4>
              <ul>
                {analysis.suggestions.map((suggestion, index) => (
                  <li key={index} className="suggestion-item">{suggestion}</li>
                ))}
              </ul>
            </div>

            {analysis.chapterInsights.length > 0 && (
              <div className="chapter-insights">
                <h4>Chapter Insights</h4>
                {analysis.chapterInsights.map((insight, index) => (
                  <div key={index} className="insight-card">
                    <h5>Chapter {insight.chapterNumber}</h5>
                    <div className="insight-details">
                      <div className="strengths">
                        <strong>Strengths:</strong>
                        <ul>
                          {insight.strengths.map((strength, idx) => (
                            <li key={idx}>{strength}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="improvements">
                        <strong>Improvements:</strong>
                        <ul>
                          {insight.improvements.map((improvement, idx) => (
                            <li key={idx}>{improvement}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="pace-rating">
                        <strong>Pace:</strong> {insight.paceRating}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ChapterDisplay = ({ chapter, index, onEdit, onDelete }) => {
  let createdDate = chapter.createdAt;
  try {
    createdDate = chapter.createdAt ? new Date(chapter.createdAt).toLocaleDateString() : '';
  } catch (err) {
    createdDate = chapter.createdAt || '';
  }

  return (
    <div className="chapter-display">
    <div className="chapter-header">
      <h4>Chapter {index + 1}: {chapter.title}</h4>
      <div className="chapter-actions">
        <button onClick={onEdit} className="edit-btn">Edit</button>
        <button onClick={onDelete} className="delete-btn">Delete</button>
      </div>
    </div>
    
    <div className="chapter-meta">
      <span className="word-count">{chapter.wordCount} words</span>
      <span className="created-date">{createdDate}</span>
      <span className={`status ${chapter.status}`}>{chapter.status}</span>
    </div>
    
    <div className="chapter-preview">
      {getPlainText(chapter.content).substring(0, 200)}...
    </div>
    </div>
  );
};

const ChapterEditor = ({ chapter, onSave, onCancel }) => {
  const [title, setTitle] = useState(chapter.title);
  const [content, setContent] = useState(chapter.content);
  const [status, setStatus] = useState(chapter.status);

  const handleSave = () => {
    onSave({ title, content, status });
  };

  return (
    <div className="chapter-editor">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="chapter-title-input"
      />
      
      <select 
        value={status} 
        onChange={(e) => setStatus(e.target.value)}
        className="status-select"
      >
        <option value="draft">Draft</option>
        <option value="review">In Review</option>
        <option value="final">Final</option>
      </select>
      
      <ReactQuill
        value={content}
        onChange={setContent}
        className="chapter-content-input"
        modules={modules}
        formats={formats}
      />
      
      <div className="editor-actions">
        <button onClick={handleSave} className="button">Save</button>
        <button onClick={onCancel} className="button secondary">Cancel</button>
      </div>
    </div>
  );
};

export default ManuscriptManager;
