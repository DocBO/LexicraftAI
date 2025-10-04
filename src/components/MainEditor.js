import React, { useState, useRef, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { geminiService } from '../services/geminiAPI';
import ApiKeyModal from './ApiKeyModal';
import { useProject } from '../context/ProjectContext';

const MainEditor = () => {
  const usingBackend = geminiService.usingBackend;
  const { projects, activeProject } = useProject();
  const activeProjectName = projects.find(p => p.id === activeProject)?.name || activeProject;
  const [text, setText] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [synonyms, setSynonyms] = useState([]);
  const [showSynonyms, setShowSynonyms] = useState(false);
  const [synonymPosition, setSynonymPosition] = useState({ x: 0, y: 0 });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState({});
  const [frozenWords, setFrozenWords] = useState(new Set());
  const [compareMode, setCompareMode] = useState(false);
  const [compareResults, setCompareResults] = useState([]);
  const [showApiModal, setShowApiModal] = useState(false);
  const [apiKeySet, setApiKeySet] = useState(usingBackend);
  const [error, setError] = useState('');
  
  const quillRef = useRef(null);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (usingBackend) {
      if (savedKey) {
        geminiService.setApiKey(savedKey);
      }
      setApiKeySet(true);
      setShowApiModal(false);
      return;
    }

    if (savedKey) {
      geminiService.setApiKey(savedKey);
      setApiKeySet(true);
    } else {
      setShowApiModal(true);
    }
  }, [usingBackend]);

  const handleApiKeySet = (apiKey) => {
    geminiService.setApiKey(apiKey);
    setApiKeySet(true);
    setShowApiModal(false);
  };

  const handleTextChange = (content) => {
    setText(content);
  };

  const handleTextSelection = async () => {
    if (!apiKeySet && !usingBackend) {
      setShowApiModal(true);
      return;
    }

    const editor = quillRef.current.getEditor();
    const range = editor.getSelection();
    if (range && range.length > 0) {
      const selected = editor.getText(range.index, range.length);
      setSelectedText(selected);

      if (selected.split(' ').length === 1) {
        try {
          const response = await geminiService.getSynonyms(selected, editor.getText());
          if (response.success) {
            setSynonyms(response.synonyms);
            const bounds = editor.getBounds(range.index);
            setSynonymPosition({
              x: bounds.left,
              y: bounds.bottom + window.scrollY
            });
            setShowSynonyms(true);
          }
        } catch (error) {
          setError('Failed to get synonyms: ' + error.message);
        }
      }
    } else {
      setShowSynonyms(false);
    }
  };

  const replaceSynonym = (synonym) => {
    const editor = quillRef.current.getEditor();
    const range = editor.getSelection();
    if (range) {
      editor.deleteText(range.index, range.length);
      editor.insertText(range.index, synonym);
    }
    setShowSynonyms(false);
  };

  const freezeWord = (word) => {
    const newFrozenWords = new Set(frozenWords);
    if (newFrozenWords.has(word)) {
      newFrozenWords.delete(word);
    } else {
      newFrozenWords.add(word);
    }
    setFrozenWords(newFrozenWords);
  };

  const dismissResult = (key) => {
    setResults(prev => prev.filter(entry => entry.key !== key));
  };

  const getPlainText = (html) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return tempDiv.textContent || tempDiv.innerText || '';
  };

  const handleParaphrase = async (mode, customPrompt = '') => {
    if (!apiKeySet && !usingBackend) {
      setShowApiModal(true);
      return;
    }

    const plainText = getPlainText(text);
    if (!plainText.trim()) return;
    
    setLoading(prev => ({ ...prev, [mode]: true }));
    setError('');
    
    try {
      // Protect frozen words
      let processedText = plainText;
      frozenWords.forEach(word => {
        processedText = processedText.replace(new RegExp(`\\b${word}\\b`, 'gi'), `[FROZEN]${word}[/FROZEN]`);
      });

      const response = await geminiService.paraphraseText(processedText, mode, customPrompt);
      if (response.success) {
        let result = response.result;
        // Restore frozen words
        frozenWords.forEach(word => {
          result = result.replace(new RegExp(`\\[FROZEN\\]${word}\\[/FROZEN\\]`, 'gi'), word);
        });

        if (compareMode) {
          setCompareResults(prev => [...prev, { mode, result, original: text }]);
        } else {
          setResults(prev => [{ key: mode, data: result }, ...prev.filter(entry => entry.key !== mode)]);
        }
      }
    } catch (error) {
      setError('Paraphrasing failed: ' + error.message);
    } finally {
      setLoading(prev => ({ ...prev, [mode]: false }));
    }
  };

  const handleSummarize = async (length = 'medium') => {
    const targetLength = typeof length === 'string' ? length : 'medium';

    if (!apiKeySet && !usingBackend) {
      setShowApiModal(true);
      return;
    }

    if (!text.trim()) return;
    
    setLoading(prev => ({ ...prev, summarize: true }));
    setError('');
    
    try {
      const response = await geminiService.summarizeText(text, targetLength);
      if (response.success) {
        setResults(prev => [{ key: 'summary', data: response.summary }, ...prev.filter(entry => entry.key !== 'summary')]);
      }
    } catch (error) {
      setError('Summarization failed: ' + error.message);
    } finally {
      setLoading(prev => ({ ...prev, summarize: false }));
    }
  };

  const handleToneAnalysis = async () => {
    if (!apiKeySet && !usingBackend) {
      setShowApiModal(true);
      return;
    }

    if (!text.trim()) return;
    
    setLoading(prev => ({ ...prev, tone: true }));
    setError('');
    
    try {
      const response = await geminiService.analyzeTone(text);
      if (response.success) {
        setResults(prev => [{ key: 'toneAnalysis', data: response.analysis }, ...prev.filter(entry => entry.key !== 'toneAnalysis')]);
      }
    } catch (error) {
      setError('Tone analysis failed: ' + error.message);
    } finally {
      setLoading(prev => ({ ...prev, tone: false }));
    }
  };

  const handleHumanize = async () => {
    if (!apiKeySet && !usingBackend) {
      setShowApiModal(true);
      return;
    }

    if (!text.trim()) return;
    
    setLoading(prev => ({ ...prev, humanize: true }));
    setError('');
    
    try {
      const response = await geminiService.humanizeText(text);
      if (response.success) {
        setResults(prev => [{ key: 'humanized', data: response.result }, ...prev.filter(entry => entry.key !== 'humanized')]);
      }
    } catch (error) {
      setError('Humanization failed: ' + error.message);
    } finally {
      setLoading(prev => ({ ...prev, humanize: false }));
    }
  };

  const paraphraseModes = ['Formal', 'Academic', 'Simple', 'Creative', 'Shorten', 'Expand'];

  return (
    <div className="main-editor">
      <ApiKeyModal isOpen={showApiModal} onApiKeySet={handleApiKeySet} />
      
      <div className="editor-header">
        <div style={{ flexGrow: 1 }}>
          <h1 style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '2em', margin: '0.5em 0' }}>LexicraftAI</h1>
          <p style={{ textAlign: 'center', margin: 0, color: '#888' }}>Project: {activeProjectName}</p>
        </div>
        <div className="header-meta">
          <div className="author-info">
            <span>by euclidstellar</span>
            <a href="https://github.com/euclidstellar" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="https://linkedin.com/in/euclidstellar" target="_blank" rel="noopener noreferrer">LinkedIn</a>
          </div>
          <div className="editor-controls">
            <button 
              className={`compare-btn ${compareMode ? 'active' : ''}`}
              onClick={() => setCompareMode(!compareMode)}
            >
              📊 Compare Modes
            </button>
            <button 
              className="api-key-btn"
              onClick={() => setShowApiModal(true)}
            >
              API Key
            </button>
            <span className="word-count">{text.split(' ').filter(w => w).length} words</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="editor-container">
        <div className="input-section">
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={text}
            onChange={handleTextChange}
            onBlur={handleTextSelection}
            placeholder="Start writing your masterpiece here..."
            className="main-textarea"
            modules={modules}
            formats={formats}
          />
          
          {frozenWords.size > 0 && (
            <div className="frozen-words">
              <h4>Frozen Words (Protected from changes):</h4>
              <div>
                {Array.from(frozenWords).map(word => (
                  <span key={word} className="frozen-word" onClick={() => freezeWord(word)}>
                    {word} ×
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="tools-section">
          <div className="tool-group">
            <h3>Paraphrasing Modes</h3>
            <div className="mode-buttons">
              {paraphraseModes.map(mode => (
                <button
                  key={mode}
                  onClick={() => handleParaphrase(mode)}
                  disabled={loading[mode] || (!apiKeySet && !usingBackend)}
                  className="mode-btn"
                >
                  {loading[mode] ? 'Processing...' : mode}
                </button>
              ))}
            </div>
          </div>

          <div className="tool-group">
            <h3>Analysis Tools</h3>
            <div className="analysis-buttons">
              <button onClick={handleToneAnalysis} disabled={loading.tone || (!apiKeySet && !usingBackend)}>
                {loading.tone ? 'Analyzing...' : 'Tone Insights'}
              </button>
              <button onClick={handleSummarize} disabled={loading.summarize || (!apiKeySet && !usingBackend)}>
                {loading.summarize ? 'Summarizing...' : 'Summarize'}
              </button>
              <button onClick={handleHumanize} disabled={loading.humanize || (!apiKeySet && !usingBackend)}>
                {loading.humanize ? 'Humanizing...' : 'AI Humanizer'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSynonyms && (
        <div 
          className="synonym-popup"
          style={{
            position: 'absolute',
            left: synonymPosition.x,
            top: synonymPosition.y,
            zIndex: 1000
          }}
        >
          <h4>Synonyms for "{selectedText}"</h4>
          <div className="synonym-list">
            {synonyms.map((synonym, index) => (
              <button
                key={index}
                onClick={() => replaceSynonym(synonym)}
                className="synonym-option"
              >
                {synonym}
              </button>
            ))}
          </div>
          <button onClick={() => freezeWord(selectedText)} className="freeze-btn">
            {frozenWords.has(selectedText) ? 'Unfreeze' : 'Freeze'} Word
          </button>
        </div>
      )}

      <div className="results-section">
        {compareMode && compareResults.length > 0 && (
          <div className="compare-results">
            <h3>📊 Mode Comparison</h3>
            <div className="compare-grid">
              {compareResults.map((result, index) => (
                <div key={index} className="compare-item">
                  <h4>{result.mode}</h4>
                  <p>{result.result}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {results.map(({ key, data }) => (
          <div key={key} className="result-item">
            <div className="result-header">
              <h3>
                {key.charAt(0).toUpperCase() + key.slice(1).replace('Analysis', ' Analysis')}
              </h3>
              <button className="close-btn" onClick={() => dismissResult(key)} aria-label="Close result">×</button>
            </div>
            {key === 'toneAnalysis' && typeof data === 'object' ? (
              <div className="tone-results">
                <p><strong>Overall Tone:</strong> {data.overallTone}</p>
                <p><strong>Sentiment:</strong> {data.sentiment}</p>
                <p><strong>Confidence:</strong> {data.confidence}</p>
                {data.emotions?.length > 0 && (
                  <p><strong>Emotions:</strong> {data.emotions.join(', ')}</p>
                )}
                <p><strong>Suggestions:</strong> {data.suggestions}</p>
              </div>
            ) : (
              <p>{data}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const modules = {
  toolbar: [
    [{ 'header': [1, 2, 3, false] }, { 'font': [] }],
    [{ 'size': ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
    [{ 'color': [] }, { 'background': [] }],
    [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'indent': '-1'}, { 'indent': '+1' }],
    ['link', 'image', 'video'],
    ['clean']
  ],
};

const formats = [
  'header', 'font', 'size',
  'bold', 'italic', 'underline', 'strike', 'blockquote',
  'color', 'background',
  'list', 'bullet', 'indent',
  'link', 'image', 'video'
];

export default MainEditor;
