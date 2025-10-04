import React, { useEffect, useMemo, useState } from 'react';
import { storageService } from '../services/storageService';
import { useProject } from '../context/ProjectContext';

const WorldBuilder = () => {
  const { activeProject } = useProject();
  const storageEnabled = storageService.isBackendEnabled();

  const [facts, setFacts] = useState([]);
  const [selectedFactId, setSelectedFactId] = useState('');
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [detailsText, setDetailsText] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const storageKey = useMemo(() => `world_facts_${activeProject}`, [activeProject]);

  useEffect(() => {
    let cancelled = false;

    const loadFacts = async () => {
      setError('');
      setStatus('');

      if (storageEnabled) {
        try {
          const result = await storageService.listWorldFacts(activeProject);
          if (!cancelled) {
            setFacts(result || []);
            resetForm();
          }
        } catch (err) {
          if (!cancelled) setError('Failed to load world facts: ' + err.message);
        }
      } else {
        try {
          const cached = localStorage.getItem(storageKey);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed)) {
              setFacts(parsed);
            } else {
              setFacts([]);
            }
          } else {
            setFacts([]);
          }
        } catch (err) {
          console.warn('Failed to parse cached world facts', err);
          setFacts([]);
        }
        resetForm();
      }
    };

    loadFacts();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageEnabled, activeProject]);

  const persistFacts = (nextFacts) => {
    setFacts(nextFacts);
    if (!storageEnabled) {
      localStorage.setItem(storageKey, JSON.stringify(nextFacts));
    }
  };

  const resetForm = () => {
    setSelectedFactId('');
    setTitle('');
    setSummary('');
    setDetailsText('');
    setTagsText('');
  };

  const parseDetails = () => {
    if (!detailsText.trim()) return null;
    try {
      return JSON.parse(detailsText);
    } catch (err) {
      throw new Error('Details must be valid JSON.');
    }
  };

  const parseTags = () => {
    if (!tagsText.trim()) return [];
    return tagsText.split(',').map(tag => tag.trim()).filter(Boolean);
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }

    let parsedDetails = null;
    try {
      parsedDetails = parseDetails();
    } catch (err) {
      setError(err.message);
      return;
    }

    const tags = parseTags();

    const payload = {
      title: title.trim(),
      summary,
      details: parsedDetails,
      tags,
    };

    setLoading(true);
    setError('');
    setStatus('');

    try {
      let saved = payload;
      if (storageEnabled) {
        const backendPayload = {
          ...payload,
          id: selectedFactId ? Number(selectedFactId) : undefined,
        };
        saved = await storageService.saveWorldFact(backendPayload, activeProject);
      } else {
        const localId = selectedFactId || Date.now().toString();
        saved = {
          id: localId,
          title: payload.title,
          summary: payload.summary,
          details: payload.details,
          tags,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      const normalized = {
        ...saved,
        id: saved.id,
        details: saved.details,
        tags: Array.isArray(saved.tags) ? saved.tags : [],
      };

      const remaining = facts.filter(fact => String(fact.id) !== String(normalized.id));
      persistFacts([normalized, ...remaining]);
      setSelectedFactId(String(normalized.id));
      setStatus('Saved');
    } catch (err) {
      setError('Failed to save world fact: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedFactId) return;

    setLoading(true);
    setError('');
    setStatus('');

    try {
      if (storageEnabled) {
        await storageService.deleteWorldFact(selectedFactId, activeProject);
      }
      const remaining = facts.filter(fact => String(fact.id) !== String(selectedFactId));
      persistFacts(remaining);
      resetForm();
      setStatus('Deleted');
    } catch (err) {
      setError('Failed to delete world fact: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectChange = (value) => {
    if (!value) {
      resetForm();
      setStatus('');
      return;
    }
    const fact = facts.find(entry => String(entry.id) === value);
    if (!fact) return;

    setSelectedFactId(String(fact.id));
    setTitle(fact.title || '');
    setSummary(fact.summary || '');
    setDetailsText(
      fact.details ? JSON.stringify(fact.details, null, 2) : ''
    );
    setTagsText(Array.isArray(fact.tags) ? fact.tags.join(', ') : '');
    setStatus('');
  };

  return (
    <div className="component world-builder">
      <h2>🌍 World Builder</h2>

      <div className="world-saved-panel">
        <div className="saved-header">
          <h3>Saved Facts</h3>
          <div className="saved-controls">
            <label htmlFor="world-fact-select">Select</label>
            <select
              id="world-fact-select"
              value={selectedFactId}
              onChange={(e) => handleSelectChange(e.target.value)}
            >
              <option value="">New Fact</option>
              {facts.map(fact => (
                <option key={fact.id} value={fact.id}>{fact.title}</option>
              ))}
            </select>
            <div className="saved-actions">
              <button className="button secondary" onClick={handleSave} disabled={loading}>
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button className="button secondary" onClick={resetForm} disabled={loading}>
                Clear
              </button>
              <button className="button danger" onClick={handleDelete} disabled={!selectedFactId || loading}>
                Delete
              </button>
            </div>
          </div>
        </div>
        {facts.length === 0 && <p className="text-muted">No world facts saved yet.</p>}
      </div>

      {error && <div className="error-message">{error}</div>}
      {status && <div className="status-message">{status}</div>}

      <div className="world-form">
        <label>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter world fact title"
        />

        <label>Summary</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Short summary of this fact"
          rows={3}
        />

        <label>Details (JSON optional)</label>
        <textarea
          value={detailsText}
          onChange={(e) => setDetailsText(e.target.value)}
          placeholder='{"location": "Eldoria", "history": "Founded in..."}'
          rows={8}
        />

        <label>Tags (comma separated)</label>
        <input
          type="text"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="kingdom, politics, trade"
        />
      </div>

      {selectedFactId && (
        <div className="world-fact-preview">
          <h3>Fact Preview</h3>
          <p><strong>Title:</strong> {title}</p>
          <p><strong>Summary:</strong> {summary}</p>
          {detailsText.trim() && (
            <div>
              <strong>Details JSON:</strong>
              <pre>{detailsText}</pre>
            </div>
          )}
          {tagsText.trim() && <p><strong>Tags:</strong> {tagsText}</p>}
        </div>
      )}
    </div>
  );
};

export default WorldBuilder;
