# AI Writing Assistant: Your All-in-One Creative Writing Partner

An open-source, AI-powered writing suite designed for authors, screenwriters, and creators. This tool goes beyond simple grammar checks, offering a comprehensive toolkit for every stage of the writing process—from initial brainstorming to final manuscript analysis. Built as a free, powerful alternative to paid platforms like QuillBot, it leverages the Google Gemini API to provide nuanced and context-aware assistance.

## ✨ Key Features

This application is structured as a suite of specialized tools, each targeting a specific aspect of the writing craft.

### Core Writing Suite

-   **✍️ Enhanced Paraphraser** ([`EnhancedParaphraser.js`](src/components/EnhancedParaphraser.js)): Transform your text with various literary modes and styles. Whether you need a formal tone, a creative flourish, or a specific author's voice, this tool provides sophisticated rewriting capabilities.
-   **🔍 Advanced Grammar & Style Checker** ([`GrammarChecker.js`](src/components/GrammarChecker.js)): Get in-depth analysis of your text, identifying issues from critical grammar errors to subtle style inconsistencies. It provides an overall score, detailed issue breakdowns, and actionable suggestions.
-   **📊 Readability Optimizer** ([`ReadabilityOptimizer.js`](src/components/ReadabilityOptimizer.js)): Tailor your writing to your intended audience. This tool analyzes readability scores, sentence complexity, and vocabulary, providing an optimized version of your text to ensure it resonates perfectly with readers.
-   **🎭 Tone Analyzer** ([`ToneAnalyzer.js`](src/components/ToneAnalyzer.js)): Understand the emotional undercurrent of your writing. It detects the primary tone, sentiment, and confidence level, offering suggestions to align the tone with your creative vision.
-   **📄 Smart Summarizer** ([`Summarizer.js`](src/components/Summarizer.js)): Quickly condense long passages of text into short, medium, or detailed summaries, complete with compression statistics.

### Creative Writing Toolkit for Novelists & Screenwriters

-   **📖 Manuscript Manager** ([`ManuscriptManager.js`](src/components/ManuscriptManager.js)): Organize your novel or screenplay chapter by chapter. This feature allows you to write, edit, and reorder chapters while providing high-level analytics on your entire manuscript, including word counts, pacing analysis, and consistency checks.
-   **🎪 Interactive Scene Builder** ([`SceneBuilder.js`](src/components/SceneBuilder.js)): Craft and analyze individual scenes with precision. Write your scene and get instant feedback on conflict levels, tension, pacing, and dialogue quality. It provides actionable suggestions to make every scene impactful.
-   **📊 Plot Structure Analyzer** ([`PlotAnalyzer.js`](src/components/PlotAnalyzer.js)): Deconstruct your narrative against proven storytelling frameworks like the **Three-Act Structure**, **Hero's Journey**, and **Seven-Point Story Structure**. It visualizes your plot's progression and provides insights to strengthen its foundation.
-   **👥 Character Development Assistant** ([`CharacterAssistant.js`](src/components/CharacterAssistant.js)): Breathe life into your characters. Analyze their voice, traits, and emotional range. The assistant checks for consistency across your manuscript and generates creative suggestions for dialogue, backstory, and development.

## 🧭 Workflow Notes & New Capabilities

The latest release tightens the loop between plot analysis, chapter planning, and scene execution. If you have an older database, drop the `manuscriptchapter` table once so the new metadata column can be created automatically on startup.

### Plot ➜ Chapter ➜ Scene Continuity

- **Character metadata travels automatically.** Plot analysis now returns `metadata` for each suggested chapter, including `mainCharacters` and `supportingCharacters` (name + short descriptor). When you sync chapters to the Manuscript Manager, those rosters are stored with the outline, ensuring downstream tools know exactly who belongs in the scene.
- **Manuscript Manager character capture.** Add or edit chapters with dedicated fields for main and supporting characters. The inputs accept one character per line (`Name - short description`) and render a preview in the chapter card for quick reference.
- **Scene Builder awareness.** Whenever you open a chapter in the Scene Builder the metadata is normalized and attached to the chapter. Scene planning, chapter drafting, and scene expand/tighten prompts all include a character brief so the LLM stays grounded in your cast instead of hallucinating new names.

### Scene Builder Enhancements

- **Plan Scenes:** Beside “Add Scene” you’ll find “Plan Scenes”. It sends the current chapter outline (plus character roster and action prompt) to the LLM and replaces/creates scene cards with pre-filled summaries and notes.
- **Action Prompt:** The drawer on the right lets you set per-chapter directives (e.g., “Keep tension ratcheting up”); the prompt travels with plan/draft/refine actions.
- **Expand/Tighten:** In the scene footer you can expand or tighten the active scene. Results arrive in the main text field, existing notes are appended with guidance, and any returned beats are stored.
- **Prompt Debug:** Each action shows a collapsible prompt/response preview for troubleshooting without cluttering the primary workflow.
- **Spellcheck Off:** Scene text and note areas have spellcheck disabled by default to avoid red underlines during drafting.

### Prompt Plugs & Fallback Behaviour

- **Gemini requests via `geminiService.generateScenePlan/RefineSceneText/GenerateChapterDraft`** now send character metadata and return the full prompt/response preview to the UI. When the backend is offline, the client generates a fallback prompt that still includes the character brief, keeping the experience consistent.
- **Defaults stored locally.** Chapter metadata is normalized and persisted in both local storage and the backend (new `metadata_json` column). If you work offline the rosters remain intact and sync back once the backend is available.

### Quick Reference

- Drop the `manuscriptchapter` table once after pulling these changes to add the `metadata_json` column.
- Populate character fields in Manuscript Manager to get the most accurate scene plans.
- Use “Plan Scenes” before expanding/tightening to seed the scene cards with LLM suggestions.
- Expand the “Prompt Debug” details if you ever need to inspect the exact prompt/response sent to Gemini.

## 🛠️ Technology Stack

-   **Frontend**: React, React Router
-   **AI Integration**: Google Gemini API via [`geminiAPI.js`](src/services/geminiAPI.js)
-   **Styling**: Plain CSS with a responsive, modern design in [`main.css`](src/styles/main.css)

## 🚀 Getting Started

### Prerequisites

-   Node.js and npm installed on your machine.
-   A Google Gemini API Key.

### Installation & Setup

1.  **Clone the repository:**
    ````sh
    git clone https://github.com/euclidstellar/elstefano.git
    cd elstefano
    ````

2.  **Install dependencies:**
    ````sh
    npm install
    ````

3.  **Set up your API Key:**
    The application requires a Google Gemini API key to function. You can set it in one of two ways:
    -   **Recommended**: Run the application and use the "API Key" button in the UI. The key is stored securely in your browser's local storage and is never exposed.
    -   **Alternative**: Create a `.env` file in the root directory and add `REACT_APP_GEMINI_API_KEY=YOUR_API_KEY_HERE`.

### Running the Application

1.  **Start the development server:**
    ````sh
    npm start
    ````

2.  Open your browser and navigate to `http://localhost:3000` to begin writing.

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Please feel free to submit a pull request or open an issue for any enhancements, bug fixes, or feature suggestions.

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
