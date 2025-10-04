import React, { useState, useRef, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { geminiService } from '../services/geminiAPI';
import { storageService } from '../services/storageService';
import { useProject } from '../context/ProjectContext';

const ShotListManager = () => {
  const { activeProject } = useProject();
  const storageEnabled = storageService.isBackendEnabled();
  const [script, setScript] = useState('');
  const [shots, setShots] = useState([]);
  const [currentScene, setCurrentScene] = useState('1');
  const [currentShot, setCurrentShot] = useState({
    id: Date.now().toString(),
    scene: '1',
    shotNumber: '1',
    description: '',
    type: 'MS',
    angle: 'Eye Level',
    movement: 'Static',
    equipment: '',
    lens: '50mm',
    framing: 'Medium',
    notes: '',
    duration: '5s',
    frameRate: '24 fps'
  });
  const [showShotEditor, setShowShotEditor] = useState(false);
  const [editingShotId, setEditingShotId] = useState(null);
  const [activeTab, setActiveTab] = useState('script');
  const [loading, setLoading] = useState(false);
  const [selectedScriptSegment, setSelectedScriptSegment] = useState('');
  const [scriptSelection, setScriptSelection] = useState({ start: 0, end: 0 });
  const [error, setError] = useState('');
  const [storageReady, setStorageReady] = useState(!storageEnabled);
  
  const quillRef = useRef(null);
  const shotListRef = useRef(null);
  const storageInitializedRef = useRef(false);

  useEffect(() => {
    storageInitializedRef.current = false;
    let cancelled = false;

    setStorageReady(!storageEnabled);

    const loadState = async () => {
      if (storageEnabled) {
        try {
          const response = await storageService.loadShotList(activeProject);
          if (!cancelled) {
            if (response?.shots) {
              setShots(response.shots);
            }
            if (typeof response?.script === 'string') {
              setScript(response.script);
            }
          }
        } catch (err) {
          if (!cancelled) {
            setError('Failed to load saved shot list: ' + err.message);
          }
        } finally {
          if (!cancelled) {
            setStorageReady(true);
          }
        }
      } else {
        const savedShots = localStorage.getItem(`shot_list_${activeProject}`);
        const savedScript = localStorage.getItem(`shot_list_script_${activeProject}`);
        if (!cancelled && savedShots) {
          setShots(JSON.parse(savedShots));
        }
        if (!cancelled && savedScript) {
          setScript(savedScript);
        }
        if (!cancelled) {
          setStorageReady(true);
        }
      }
    };

    loadState();

    return () => {
      cancelled = true;
    };
  }, [storageEnabled, activeProject]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    if (!storageEnabled) {
      localStorage.setItem(`shot_list_${activeProject}`, JSON.stringify(shots));
      localStorage.setItem(`shot_list_script_${activeProject}`, script);
      return;
    }

    if (!storageInitializedRef.current) {
      storageInitializedRef.current = true;
      return;
    }

    const timeout = setTimeout(() => {
      const normalizedShots = shots.map(shot => {
        let selection = shot.scriptSelection && typeof shot.scriptSelection === 'object'
          ? {
              start: typeof shot.scriptSelection.start === 'number' && Number.isFinite(shot.scriptSelection.start)
                ? shot.scriptSelection.start
                : null,
              end: typeof shot.scriptSelection.end === 'number' && Number.isFinite(shot.scriptSelection.end)
                ? shot.scriptSelection.end
                : null,
            }
          : undefined;

        if (selection && selection.start === null && selection.end === null) {
          selection = undefined;
        }

        return {
          ...shot,
          id: String(shot.id ?? Date.now()),
          scene: shot.scene ?? '',
          shotNumber: shot.shotNumber ?? '',
          description: shot.description ?? '',
          type: shot.type ?? '',
          angle: shot.angle ?? '',
          movement: shot.movement ?? '',
          equipment: shot.equipment ?? '',
          lens: shot.lens ?? '',
          framing: shot.framing ?? '',
          notes: shot.notes ?? '',
          duration: shot.duration ?? '',
          frameRate: shot.frameRate ?? '',
          scriptSegment: shot.scriptSegment ?? '',
          scriptSelection: selection,
        };
      });

      storageService
        .saveShotList({ script, shots: normalizedShots }, activeProject)
        .catch((err) => setError('Failed to save shot list: ' + err.message));
    }, 600);

    return () => clearTimeout(timeout);
  }, [shots, script, storageEnabled, storageReady, activeProject]);

  const shotTypes = [
    'ECU', 'CU', 'MCU', 'MS', 'MLS', 'LS', 'ELS', 'WS', 
    'Two Shot', 'OTS', 'POV', 'Insert', 'Cutaway', 'Establishing'
  ];
  
  const angles = [
    'Eye Level', 'High Angle', 'Low Angle', 'Dutch Angle', 'Bird\'s Eye',
    'Worm\'s Eye', 'Over The Shoulder', 'POV'
  ];
  
  const movements = [
    'Static', 'Pan', 'Tilt', 'Dolly In', 'Dolly Out', 'Truck Left',
    'Truck Right', 'Pedestal', 'Crane Up', 'Crane Down', 'Handheld',
    'Steadicam', 'Gimbal', 'Drone', 'Zoom In', 'Zoom Out'
  ];
  
  const lenses = [
    '16mm', '24mm', '35mm', '50mm', '85mm', '100mm', '135mm'
  ];
  
  const frameRates = [
    '24 fps', '25 fps', '30 fps', '48 fps', '60 fps', '120 fps'
  ];

  const handleScriptSelection = () => {
    const editor = quillRef.current.getEditor();
    const range = editor.getSelection();
    
    if (range && range.length > 0) {
      const selected = editor.getText(range.index, range.length);
      setSelectedScriptSegment(selected);
      setScriptSelection({ start: range.index, end: range.index + range.length });
      
      // Pre-fill shot description with selected text
      setCurrentShot(prev => ({
        ...prev,
        description: selected.substring(0, 150)
      }));
      
      setShowShotEditor(true);
    }
  };

  const addShot = () => {
    if (!storageReady) return;

    const newShot = {
      ...currentShot,
      id: editingShotId || Date.now().toString(),
      scriptSegment: selectedScriptSegment,
      scriptSelection: scriptSelection
    };
    
    if (editingShotId) {
      // Update existing shot
    setShots(prev => prev.map(shot => 
        shot.id === editingShotId ? newShot : shot
      ));
      setEditingShotId(null);
    } else {
      // Add new shot
    setShots(prev => [...prev, newShot]);
    }
    
    // Reset current shot
    setCurrentShot({
      id: Date.now().toString(),
      scene: currentScene,
      shotNumber: (shots.filter(s => s.scene === currentScene).length + 1).toString(),
      description: '',
      type: 'MS',
      angle: 'Eye Level',
      movement: 'Static',
      equipment: '',
      lens: '50mm',
      framing: 'Medium',
      notes: '',
      duration: '5s',
      frameRate: '24 fps'
    });
    
    setShowShotEditor(false);
    setSelectedScriptSegment('');
  };

  const editShot = (id) => {
    const shotToEdit = shots.find(shot => shot.id === id);
    if (shotToEdit) {
      setCurrentShot({ ...shotToEdit });
      setEditingShotId(id);
      setShowShotEditor(true);
      setSelectedScriptSegment(shotToEdit.scriptSegment || '');
    }
  };

  const deleteShot = (id) => {
    if (!storageReady) return;
    setShots(prev => prev.filter(shot => shot.id !== id));
  };

  const runAiShotSuggestions = async () => {
    if (!storageReady) return;
    if (!script.trim()) return;
    
    setLoading(true);
    setError(''); // Clear any previous errors
    
    try {
      const response = await geminiService.generateShotList(script);
      console.log("API Response:", response); // Debug logging
      
      if (response.success && response.shots && Array.isArray(response.shots)) {
        if (response.shots.length === 0) {
          setError('AI could not generate any shots from this script. Try adding more descriptive scene content.');
        } else {
          // Add scene numbers if missing
          const processedShots = response.shots.map(shot => ({
            ...shot,
            scene: shot.scene || currentScene,
            id: shot.id || Date.now() + Math.floor(Math.random() * 10000)
          }));
          
          setShots(prev => [...prev, ...processedShots.map(shot => ({
            ...shot,
            id: String(shot.id ?? Date.now())
          }))]);
          setActiveTab('shot-list');
        }
      } else {
        setError('Received invalid response format from AI service. Please try again.');
      }
    } catch (error) {
      console.error('Failed to generate shot list:', error);
      setError(`Shot list generation failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const exportShotList = () => {
    const element = document.createElement('a');
    
    // Format the shot list as CSV
    let csvContent = 'Scene,Shot,Description,Type,Angle,Movement,Equipment,Lens,Framing,Duration,Frame Rate,Notes\n';
    
    shots.forEach(shot => {
      csvContent += `${shot.scene},${shot.shotNumber},"${shot.description.replace(/"/g, '""')}",${shot.type},${shot.angle},${shot.movement},"${shot.equipment.replace(/"/g, '""')}",${shot.lens},${shot.framing},${shot.duration},${shot.frameRate},"${shot.notes.replace(/"/g, '""')}"\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    element.setAttribute('href', url);
    element.setAttribute('download', 'shot_list.csv');
    element.style.display = 'none';
    
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const importFountainScript = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setScript(content);
      
      // Extract scenes for scene numbers
      const sceneMatches = content.match(/^(INT|EXT|INT\/EXT|EXT\/INT|I\/E|E\/I).*?$/gm);
      if (sceneMatches && sceneMatches.length > 0) {
        setCurrentScene('1'); // Reset to scene 1
      }
    };
    reader.readAsText(file);
  };

  const modules = {
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      ['bold', 'italic', 'underline'],
      [{ 'align': [] }],
      ['clean']
    ]
  };

  const formats = [
    'header',
    'bold', 'italic', 'underline',
    'align'
  ];

  const getShotTypeThumbnail = (type) => {
    // Visual representation of each shot type
    const shotFramings = {
      'ECU': '👁️', // Extreme Close-Up
      'CU': '😐',  // Close-Up
      'MCU': '👤', // Medium Close-Up
      'MS': '👨‍💼', // Medium Shot
      'MLS': '🧍', // Medium Long Shot
      'LS': '🧍‍♂️🌳', // Long Shot
      'ELS': '🏞️', // Extreme Long Shot
      'WS': '🏙️', // Wide Shot
      'Two Shot': '👨‍👩‍', // Two Shot
      'OTS': '👤👥', // Over The Shoulder
      'POV': '👀', // Point of View
      'Insert': '📱', // Insert
      'Cutaway': '↗️', // Cutaway
      'Establishing': '🏢' // Establishing
    };
    
    return shotFramings[type] || '📹';
  };

  return (
    <div className="component shot-list-manager">
      <h2>🎬 Shot List Manager</h2>
      
      {error && <div className="error-message">{error}</div>}
      
      <div className="shot-list-tabs">
        <button 
          className={`tab-btn ${activeTab === 'script' ? 'active' : ''}`}
          onClick={() => setActiveTab('script')}
        >
          📝 Script View
        </button>
        <button 
          className={`tab-btn ${activeTab === 'shot-list' ? 'active' : ''}`}
          onClick={() => setActiveTab('shot-list')}
        >
          🎯 Shot List
        </button>
        <button 
          className={`tab-btn ${activeTab === 'storyboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('storyboard')}
        >
          🖼️ Storyboard View
        </button>
      </div>
      
      {activeTab === 'script' && (
        <div className="script-tab">
          <div className="script-controls">
            <div className="script-buttons">
              <label className="file-input-label">
                <span>Import Fountain Script</span>
                <input 
                  type="file" 
                  accept=".fountain,.txt" 
                  onChange={importFountainScript} 
                  style={{ display: 'none' }}
                />
              </label>
              <button 
                className="button"
                onClick={runAiShotSuggestions}
                disabled={loading || !script.trim()}
              >
                {loading ? 'Generating...' : '🤖 AI Shot Suggestions'}
              </button>
            </div>
            
            <div className="script-note">
              <p>Select text in the script to add a new shot</p>
            </div>
          </div>
          
          <div className="script-editor-container">
            <ReactQuill
              ref={quillRef}
              theme="snow"
              value={script}
              onChange={setScript}
              onBlur={handleScriptSelection}
              modules={modules}
              formats={formats}
              placeholder="Paste your screenplay or write directly here. Select text to add a shot..."
              className="script-textarea"
            />
          </div>
        </div>
      )}
      
      {activeTab === 'shot-list' && (
        <div className="shot-list-tab">
          <div className="shot-list-controls">
            <h3>Shot List ({shots.length} shots)</h3>
            <div className="shot-list-actions">
              <button className="button" onClick={exportShotList}>
                📥 Export Shot List
              </button>
              <label>
                Current Scene:
                <input 
                  type="text" 
                  value={currentScene} 
                  onChange={(e) => setCurrentScene(e.target.value)}
                  className="scene-input"
                />
              </label>
            </div>
          </div>
          
          <div className="shot-list-table-container" ref={shotListRef}>
            <table className="shot-list-table">
              <thead>
                <tr>
                  <th>Scene</th>
                  <th>Shot</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Angle</th>
                  <th>Movement</th>
                  <th>Equipment</th>
                  <th>Lens</th>
                  <th>Duration</th>
                  <th>Frame Rate</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shots.map(shot => (
                  <tr key={shot.id} className="shot-row">
                    <td>{shot.scene}</td>
                    <td>{shot.shotNumber}</td>
                    <td className="description-cell">{shot.description}</td>
                    <td>
                      <div className="shot-type">
                        <span className="shot-icon">{getShotTypeThumbnail(shot.type)}</span>
                        {shot.type}
                      </div>
                    </td>
                    <td>{shot.angle}</td>
                    <td>{shot.movement}</td>
                    <td>{shot.equipment}</td>
                    <td>{shot.lens}</td>
                    <td>{shot.duration}</td>
                    <td>{shot.frameRate}</td>
                    <td className="action-cell">
                      <button className="edit-btn" onClick={() => editShot(shot.id)}>Edit</button>
                      <button className="delete-btn" onClick={() => deleteShot(shot.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {activeTab === 'storyboard' && (
        <div className="storyboard-tab">
          <div className="storyboard-header">
            <h3>Storyboard View</h3>
            <p className="storyboard-note">Visualize your shot sequence</p>
          </div>
          
          <div className="storyboard-grid">
            {shots.map(shot => (
              <div key={shot.id} className="storyboard-card">
                <div className="storyboard-frame">
                  <div className="frame-representation">
                    <div className="frame-icon">{getShotTypeThumbnail(shot.type)}</div>
                    <div className="frame-type">{shot.type}</div>
                  </div>
                </div>
                <div className="storyboard-details">
                  <div className="storyboard-shot-info">
                    <span className="scene-shot">Scene {shot.scene}, Shot {shot.shotNumber}</span>
                  </div>
                  <p className="storyboard-description">{shot.description}</p>
                  <div className="storyboard-technical">
                    <span>{shot.movement}</span>
                    <span>{shot.lens}</span>
                    <span>{shot.frameRate}</span>
                  </div>
                  <div className="storyboard-actions">
                    <button className="edit-btn" onClick={() => editShot(shot.id)}>Edit</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {showShotEditor && (
        <div className="shot-editor-overlay">
          <div className="shot-editor">
            <h3>{editingShotId ? 'Edit Shot' : 'Add New Shot'}</h3>
            
            {selectedScriptSegment && (
              <div className="selected-script-segment">
                <h4>Selected Script:</h4>
                <p>{selectedScriptSegment}</p>
              </div>
            )}
            
            <div className="shot-form">
              <div className="form-row">
                <div className="form-group">
                  <label>Scene #</label>
                  <input 
                    type="text" 
                    value={currentShot.scene} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, scene: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Shot #</label>
                  <input 
                    type="text" 
                    value={currentShot.shotNumber} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, shotNumber: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="form-group">
                <label>Shot Description</label>
                <textarea 
                  value={currentShot.description} 
                  onChange={(e) => setCurrentShot(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                />
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Shot Type</label>
                  <select 
                    value={currentShot.type} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, type: e.target.value }))}
                  >
                    {shotTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Camera Angle</label>
                  <select 
                    value={currentShot.angle} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, angle: e.target.value }))}
                  >
                    {angles.map(angle => (
                      <option key={angle} value={angle}>{angle}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Camera Movement</label>
                  <select 
                    value={currentShot.movement} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, movement: e.target.value }))}
                  >
                    {movements.map(movement => (
                      <option key={movement} value={movement}>{movement}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Equipment</label>
                  <input 
                    type="text" 
                    value={currentShot.equipment} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, equipment: e.target.value }))}
                    placeholder="Tripod, Dolly, Gimbal, etc."
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Lens</label>
                  <select 
                    value={currentShot.lens} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, lens: e.target.value }))}
                  >
                    {lenses.map(lens => (
                      <option key={lens} value={lens}>{lens}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Framing</label>
                  <input 
                    type="text" 
                    value={currentShot.framing} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, framing: e.target.value }))}
                  />
                </div>
              </div>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Estimated Duration</label>
                  <input 
                    type="text" 
                    value={currentShot.duration} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, duration: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Frame Rate</label>
                  <select 
                    value={currentShot.frameRate} 
                    onChange={(e) => setCurrentShot(prev => ({ ...prev, frameRate: e.target.value }))}
                  >
                    {frameRates.map(rate => (
                      <option key={rate} value={rate}>{rate}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="form-group">
                <label>Notes</label>
                <textarea 
                  value={currentShot.notes} 
                  onChange={(e) => setCurrentShot(prev => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  placeholder="Special instructions, lighting notes, etc."
                />
              </div>
              
              <div className="form-actions">
                <button className="button" onClick={addShot} disabled={!storageReady}>
                  {editingShotId ? 'Update Shot' : 'Add Shot'}
                </button>
                <button 
                  className="button secondary" 
                  onClick={() => {
                    setShowShotEditor(false);
                    setEditingShotId(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShotListManager;
