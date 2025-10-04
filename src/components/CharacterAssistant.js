import React, { useEffect, useMemo, useState } from 'react';
import { geminiService } from '../services/geminiAPI';
import { storageService } from '../services/storageService';
import { useProject } from '../context/ProjectContext';

const CharacterAssistant = () => {
  const [characterName, setCharacterName] = useState('');
  const [characterText, setCharacterText] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState({});
  const [error, setError] = useState('');
  const [analysisType, setAnalysisType] = useState('voice');
  const { activeProject } = useProject();
  const storageEnabled = storageService.isBackendEnabled();
  const [characters, setCharacters] = useState([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState('');

  const localKey = useMemo(() => `characters_${activeProject}`, [activeProject]);

  useEffect(() => {
    let cancelled = false;

    const loadCharacters = async () => {
      if (storageEnabled) {
        try {
          const list = await storageService.listCharacters(activeProject);
          if (!cancelled) {
            setCharacters(list || []);
            setSelectedCharacterId('');
            setCharacterName('');
            setCharacterText('');
            setAnalysis(null);
            setSuggestions(null);
          }
        } catch (err) {
          if (!cancelled) setError('Failed to load characters: ' + err.message);
        }
      } else {
        const cached = localStorage.getItem(localKey);
        if (!cancelled && cached) {
          try {
            const parsed = JSON.parse(cached);
            setCharacters(Array.isArray(parsed) ? parsed : []);
            setSelectedCharacterId('');
            setCharacterName('');
            setCharacterText('');
            setAnalysis(null);
            setSuggestions(null);
          } catch (err) {
            console.warn('Failed to parse cached characters', err);
            setCharacters([]);
          }
        } else if (!cancelled) {
          setCharacters([]);
          setSelectedCharacterId(null);
          setCharacterName('');
          setCharacterText('');
          setAnalysis(null);
          setSuggestions(null);
        }
      }
    };

    loadCharacters();

    return () => {
      cancelled = true;
    };
  }, [storageEnabled, activeProject, localKey]);

  const analysisTypes = [
    { value: 'voice', label: 'Character Voice Analysis' },
    { value: 'development', label: 'Character Development' },
    { value: 'consistency', label: 'Consistency Check' },
    { value: 'dialogue', label: 'Dialogue Enhancement' },
    { value: 'backstory', label: 'Backstory Suggestions' }
  ];

  const analyzeCharacter = async () => {
    if (!characterText.trim()) return;
    
    setLoading(prev => ({ ...prev, analysis: true }));
    setError('');
    
    try {
      const response = await geminiService.analyzeCharacter(
        characterText, 
        characterName, 
        analysisType
      );
      if (response.success) {
        setAnalysis(response.analysis);
      }
    } catch (error) {
      setError('Failed to analyze character: ' + error.message);
    } finally {
      setLoading(prev => ({ ...prev, analysis: false }));
    }
  };

  const generateCharacterSuggestions = async () => {
    if (!characterName.trim()) return;
    
    setLoading(prev => ({ ...prev, suggestions: true }));
    setError('');
    
    try {
      const response = await geminiService.generateCharacterSuggestions(
        characterName,
        analysis?.traits || [],
        analysisType
      );
      if (response.success) {
        setSuggestions(response.suggestions);
      }
    } catch (error) {
      setError('Failed to generate suggestions: ' + error.message);
    } finally {
      setLoading(prev => ({ ...prev, suggestions: false }));
    }
  };

  const persistCharacters = (next) => {
    setCharacters(next);
    if (!storageEnabled) {
      localStorage.setItem(localKey, JSON.stringify(next));
    }
  };

  const saveCharacterProfile = async () => {
    if (!characterName.trim()) {
      setError('Character name is required to save');
      return;
    }
    const payload = {
      name: characterName,
      sourceText: characterText,
      analysis,
      suggestions,
    };

    try {
      let saved = payload;
      if (storageEnabled) {
        const backendPayload = {
          ...payload,
          id: selectedCharacterId ? Number(selectedCharacterId) : undefined,
        };
        saved = await storageService.saveCharacter(backendPayload, activeProject);
      } else {
        const localId = selectedCharacterId || Date.now().toString();
        saved = { ...payload, id: localId };
      }
      const withoutCurrent = characters.filter(ch => String(ch.id) !== String(saved.id));
      const next = [{
        ...saved,
        id: saved.id,
        analysis: saved.analysis,
        suggestions: saved.suggestions,
      }, ...withoutCurrent];
      persistCharacters(next);
      setSelectedCharacterId(String(saved.id));
      setError('');
    } catch (err) {
      setError('Failed to save character: ' + err.message);
    }
  };

  const deleteCharacterProfile = async (id) => {
    try {
      if (storageEnabled && id) {
        await storageService.deleteCharacter(id, activeProject);
      }
      const next = characters.filter(ch => String(ch.id) !== String(id));
      persistCharacters(next);
      if (String(selectedCharacterId) === String(id)) {
        setSelectedCharacterId('');
        setCharacterName('');
        setCharacterText('');
        setAnalysis(null);
        setSuggestions(null);
      }
    } catch (err) {
      setError('Failed to delete character: ' + err.message);
    }
  };

  const loadCharacter = (character) => {
    setSelectedCharacterId(String(character.id));
    setCharacterName(character.name || '');
    setCharacterText(character.sourceText || '');
    setAnalysis(character.analysis || null);
    setSuggestions(Array.isArray(character.suggestions) ? character.suggestions : null);
  };

  const resetCharacterForm = () => {
    setSelectedCharacterId('');
    setCharacterName('');
    setCharacterText('');
    setAnalysis(null);
    setSuggestions(null);
  };

  return (
    <div className="component character-assistant">
      <h2>👥 Character Development Assistant</h2>

      <div className="character-saved-panel">
        <div className="saved-header">
          <h3>Saved Characters</h3>
          <div className="saved-controls">
            <label htmlFor="character-select">Select</label>
            <select
              id="character-select"
              value={selectedCharacterId}
              onChange={(e) => {
                const value = e.target.value;
                if (!value) {
                  resetCharacterForm();
                  return;
                }
                const found = characters.find(ch => String(ch.id) === value);
                if (found) loadCharacter(found);
              }}
            >
              <option value="">New Character</option>
              {characters.map(character => (
                <option key={character.id} value={character.id}>{character.name}</option>
              ))}
            </select>
            <div className="saved-actions">
              <button className="button secondary" onClick={saveCharacterProfile} disabled={!characterName.trim()}>
                Save
              </button>
              <button className="button secondary" onClick={resetCharacterForm}>
                Clear
              </button>
              <button
                className="button danger"
                onClick={() => selectedCharacterId && deleteCharacterProfile(selectedCharacterId)}
                disabled={!selectedCharacterId}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        {characters.length === 0 && <p className="text-muted">No characters saved yet.</p>}
      </div>
      
      <div className="character-controls">
        <div className="character-input">
          <label>Character Name:</label>
          <input
            type="text"
            value={characterName}
            onChange={(e) => setCharacterName(e.target.value)}
            placeholder="Enter character name..."
            className="character-name-input"
          />
        </div>

        <div className="analysis-type-selector">
          <label>Analysis Type:</label>
          <select 
            value={analysisType} 
            onChange={(e) => setAnalysisType(e.target.value)}
            className="mode-select"
          >
            {analysisTypes.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <textarea
        value={characterText}
        onChange={(e) => setCharacterText(e.target.value)}
        placeholder="Paste text featuring this character (dialogue, descriptions, actions, etc.)..."
        className="text-area character-textarea"
        style={{ height: '300px' }}
      />

      <div className="action-buttons">
        <button 
          onClick={analyzeCharacter}
          disabled={loading.analysis || !characterText.trim()}
          className="button"
        >
          {loading.analysis ? 'Analyzing...' : 'Analyze Character'}
        </button>

        <button 
          onClick={generateCharacterSuggestions}
          disabled={loading.suggestions || !characterName.trim()}
          className="button secondary"
        >
          {loading.suggestions ? 'Generating...' : 'Get Suggestions'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {analysis && (
        <div className="character-analysis">
          <h3>Character Analysis: {characterName}</h3>
          
          <div className="analysis-sections">
            <div className="traits-section">
              <h4>Character Traits:</h4>
              <div className="traits-list">
                {analysis.traits?.map((trait, index) => (
                  <span key={index} className="trait-tag">
                    {trait}
                  </span>
                ))}
              </div>
            </div>

            <div className="voice-section">
              <h4>Voice Characteristics:</h4>
              <ul>
                <li><strong>Tone:</strong> {analysis.voiceTone}</li>
                <li><strong>Speech Pattern:</strong> {analysis.speechPattern}</li>
                <li><strong>Vocabulary Level:</strong> {analysis.vocabularyLevel}</li>
                <li><strong>Emotional Range:</strong> {analysis.emotionalRange}</li>
              </ul>
            </div>

            <div className="development-section">
              <h4>Development Notes:</h4>
              <p>{analysis.developmentNotes}</p>
            </div>

            {analysis.inconsistencies && (
              <div className="inconsistencies-section">
                <h4>Potential Inconsistencies:</h4>
                <ul>
                  {analysis.inconsistencies.map((issue, index) => (
                    <li key={index} className="inconsistency-item">
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {suggestions && (
        <div className="character-suggestions">
          <h3>Enhancement Suggestions:</h3>
          
          <div className="suggestions-list">
            {suggestions.map((suggestion, index) => (
              <div key={index} className="suggestion-item">
                <h4>{suggestion.category}</h4>
                <p>{suggestion.description}</p>
                {suggestion.example && (
                  <div className="suggestion-example">
                    <strong>Example:</strong> "{suggestion.example}"
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterAssistant;
