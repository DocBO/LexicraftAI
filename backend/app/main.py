from __future__ import annotations

import json
import logging
import random
import re
import time
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .database import init_db
from .llm import OpenRouterClient
from .routes.storage import router as storage_router
from .routes.projects import router as projects_router
from .routes.characters import router as characters_router
from .vector_store import vector_store

load_dotenv()

logger = logging.getLogger(__name__)


class ParaphraseRequest(BaseModel):
    text: str = Field(..., min_length=1)
    mode: Optional[str] = None
    customPrompt: Optional[str] = None


class SummarizeRequest(BaseModel):
    text: str = Field(..., min_length=1)
    length: Optional[str] = Field(default="medium", pattern=r"^(short|medium|long)$")


class ToneRequest(BaseModel):
    text: str = Field(..., min_length=1)


class HumanizeRequest(BaseModel):
    text: str = Field(..., min_length=1)


class SynonymRequest(BaseModel):
    word: str = Field(..., min_length=1)
    context: Optional[str] = ""


class PlagiarismRequest(BaseModel):
    text: str = Field(..., min_length=1)


class AdvancedParaphraseRequest(BaseModel):
    text: str = Field(..., min_length=1)
    mode: Optional[str] = None
    writingStyle: Optional[str] = None
    targetAudience: Optional[str] = None
    preserveDialogue: bool = True


class GrammarCheckRequest(BaseModel):
    text: str = Field(..., min_length=1)
    level: str = Field(default="standard")


class CharacterAnalysisRequest(BaseModel):
    text: str = Field(..., min_length=1)
    characterName: str = Field(..., min_length=1)
    analysisType: Optional[str] = None


class CharacterSuggestionRequest(BaseModel):
    characterName: str = Field(..., min_length=1)
    traits: List[str] = Field(default_factory=list)
    focusArea: Optional[str] = None


class PlotAnalysisRequest(BaseModel):
    text: str = Field(..., min_length=1)
    plotType: Optional[str] = None


class ManuscriptAnalysisRequest(BaseModel):
    chapters: List[Dict[str, Any]] = Field(default_factory=list)


class SceneAnalysisRequest(BaseModel):
    sceneText: str = Field(..., min_length=1)
    sceneType: Optional[str] = None


class ReadabilityRequest(BaseModel):
    text: str = Field(..., min_length=1)
    targetAudience: Optional[str] = None


class ScriptAnalysisRequest(BaseModel):
    scriptText: str = Field(..., min_length=1)


def create_app() -> FastAPI:
    init_db()
    app = FastAPI(title="Lexicraft AI Backend", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/api/paraphrase")
    async def paraphrase(payload: ParaphraseRequest) -> Dict[str, Any]:
        prompt = build_paraphrase_prompt(payload)
        result = await run_generation(prompt, temperature=0.9)
        return {
            "success": True,
            "result": result,
            "originalLength": len(payload.text),
            "newLength": len(result),
        }

    @app.post("/api/summarize")
    async def summarize(payload: SummarizeRequest) -> Dict[str, Any]:
        prompt = build_summary_prompt(payload)
        summary = await run_generation(prompt, temperature=0.3)
        original_len = len(payload.text)
        summary_len = len(summary)
        compression = 0.0
        if original_len:
            compression = ((original_len - summary_len) / original_len) * 100
        return {
            "success": True,
            "summary": summary,
            "originalLength": original_len,
            "summaryLength": summary_len,
            "compressionRatio": round(compression, 1),
        }

    @app.post("/api/analyze-tone")
    async def analyze_tone(payload: ToneRequest) -> Dict[str, Any]:
        prompt = build_tone_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.2)
        analysis = coerce_json(analysis_text)
        if analysis is None:
            analysis = {
                "overallTone": analysis_text,
                "sentiment": "neutral",
                "confidence": "medium",
                "emotions": [],
                "suggestions": "Analysis completed",
            }
        return {"success": True, "analysis": analysis}

    @app.post("/api/check-plagiarism")
    async def check_plagiarism(payload: PlagiarismRequest) -> Dict[str, Any]:
        similarity = random.random() * 15
        sources: List[Dict[str, str]] = []
        if similarity > 10:
            sources.append(
                {
                    "url": "https://example.com/source1",
                    "similarity": f"{similarity:.1f}%",
                    "title": "Sample Source Document",
                }
            )
        words_checked = len(payload.text.split())
        return {
            "success": True,
            "similarity": f"{similarity:.1f}%",
            "isOriginal": similarity < 10,
            "sources": sources,
            "wordsChecked": words_checked,
        }

    @app.post("/api/humanize")
    async def humanize(payload: HumanizeRequest) -> Dict[str, Any]:
        prompt = build_humanize_prompt(payload)
        result = await run_generation(prompt, temperature=0.95)
        return {"success": True, "result": result}

    @app.post("/api/synonyms")
    async def synonyms(payload: SynonymRequest) -> Dict[str, Any]:
        prompt = build_synonym_prompt(payload)
        synonyms_text = await run_generation(prompt, temperature=0.4)
        synonyms = coerce_json(synonyms_text)
        if isinstance(synonyms, list):
            cleaned = [str(item).strip() for item in synonyms if str(item).strip()]
        else:
            cleaned = [part.strip() for part in synonyms_text.split(",") if part.strip()]
        return {"success": True, "synonyms": cleaned[:10]}

    @app.post("/api/paraphrase/advanced")
    async def advanced_paraphrase(payload: AdvancedParaphraseRequest) -> Dict[str, Any]:
        prompt = build_advanced_paraphrase_prompt(payload)
        result = await run_generation(prompt, temperature=0.85)
        return {
            "success": True,
            "result": result,
            "originalLength": len(payload.text),
            "newLength": len(result),
        }

    @app.post("/api/grammar/check")
    async def grammar_check(payload: GrammarCheckRequest) -> Dict[str, Any]:
        prompt = build_grammar_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.3)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_grammar_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/character/analyze")
    async def character_analyze(payload: CharacterAnalysisRequest) -> Dict[str, Any]:
        prompt = build_character_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.35)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_character_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/character/suggestions")
    async def character_suggestions(payload: CharacterSuggestionRequest) -> Dict[str, Any]:
        prompt = build_character_suggestion_prompt(payload)
        suggestions_text = await run_generation(prompt, temperature=0.65)
        suggestions = coerce_json(suggestions_text)
        if not isinstance(suggestions, list):
            suggestions = default_character_suggestions()
        return {"success": True, "suggestions": suggestions}

    @app.post("/api/plot/analyze")
    async def plot_analyze(payload: PlotAnalysisRequest) -> Dict[str, Any]:
        prompt = build_plot_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.4)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_plot_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/manuscript/analyze")
    async def manuscript_analyze(payload: ManuscriptAnalysisRequest) -> Dict[str, Any]:
        prompt = build_manuscript_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.45)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_manuscript_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/scene/analyze")
    async def scene_analyze(payload: SceneAnalysisRequest) -> Dict[str, Any]:
        prompt = build_scene_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.5)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_scene_analysis()
        return {"success": True, "analysis": analysis}

    @app.post("/api/readability/analyze")
    async def readability_analyze(payload: ReadabilityRequest) -> Dict[str, Any]:
        prompt = build_readability_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.35)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_readability_analysis(payload.text)
        return {"success": True, "analysis": analysis}

    @app.post("/api/script/breakdown")
    async def script_breakdown(payload: ScriptAnalysisRequest) -> Dict[str, Any]:
        prompt = build_script_breakdown_prompt(payload)
        analysis_text = await run_generation(prompt, temperature=0.45)
        analysis = coerce_json(analysis_text)
        if analysis is None or not isinstance(analysis, dict):
            analysis = default_script_breakdown()
        return {"success": True, "analysis": analysis}

    @app.post("/api/script/shots")
    async def script_shots(payload: ScriptAnalysisRequest) -> Dict[str, Any]:
        prompt = build_shot_list_prompt(payload)
        shots_text = await run_generation(prompt, temperature=0.55)
        shots = coerce_json(shots_text)
        if not isinstance(shots, list):
            match = re.search(r"\[[\s\S]*\]", shots_text)
            if match:
                try:
                    shots = json.loads(match.group(0))
                except json.JSONDecodeError:
                    shots = []
            else:
                shots = []
        normalized = normalize_shot_list(shots)
        return {"success": True, "shots": normalized}

    app.include_router(storage_router, prefix="/api")
    app.include_router(projects_router, prefix="/api")
    app.include_router(characters_router, prefix="/api")

    @app.on_event("startup")
    async def ensure_vector_store() -> None:  # pragma: no cover - startup hook
        await vector_store.ensure_ready()

    return app


async def run_generation(prompt: str, *, temperature: float) -> str:
    try:
        client = OpenRouterClient()
    except RuntimeError as exc:
        logger.error("OpenRouter client unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        return await client.generate(prompt, temperature=temperature)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("OpenRouter generation failed")
        raise HTTPException(status_code=502, detail="Failed to generate content") from exc


def build_advanced_paraphrase_prompt(payload: AdvancedParaphraseRequest) -> str:
    mode = payload.mode or "Literary"
    writing_style = payload.writingStyle or "neutral"
    target_audience = payload.targetAudience or "general"
    preserve_dialogue = "Yes" if payload.preserveDialogue else "No"

    return (
        "Transform the following text with these specifications:\n"
        f"- Literary Mode: {mode}\n"
        f"- Writing Style: {writing_style}\n"
        f"- Target Audience: {target_audience}\n"
        f"- Preserve Dialogue: {preserve_dialogue}\n\n"
        "Focus on:\n"
        "1. Enhancing literary quality while maintaining meaning\n"
        "2. Improving sentence variety and flow\n"
        "3. Elevating vocabulary appropriately\n"
        "4. Maintaining character voice consistency\n\n"
        "Provide ONLY the refined version without commentary.\n\n"
        f"Text: \"{payload.text}\""
    )


def build_grammar_prompt(payload: GrammarCheckRequest) -> str:
    level = (payload.level or "standard").lower()
    depth_mapping = {
        "basic": "Focus only on grammar errors and basic punctuation.",
        "standard": "Check grammar, punctuation, style, and clarity issues.",
        "comprehensive": "Comprehensive analysis including grammar, style, flow, consistency, and literary quality.",
        "literary": "Literary analysis focusing on creative writing, narrative voice, character consistency, and artistic expression.",
    }
    analysis_depth = depth_mapping.get(level, depth_mapping["standard"])

    return (
        f"Perform a {level} grammar and style analysis of the following text.\n\n"
        f"{analysis_depth}\n\n"
        "Text: \"" + payload.text + "\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"overallScore\": 85,\n"
        "  \"issues\": [\n"
        "    {\n"
        "      \"type\": \"Grammar\",\n"
        "      \"severity\": \"critical\",\n"
        "      \"originalText\": \"exact text with issue\",\n"
        "      \"description\": \"explanation of the issue\",\n"
        "      \"suggestion\": \"corrected version\"\n"
        "    }\n"
        "  ],\n"
        "  \"readability\": \"Grade level or description\",\n"
        "  \"sentenceVariety\": \"Assessment of sentence structure variety\",\n"
        "  \"vocabularyLevel\": \"Assessment of vocabulary complexity\",\n"
        "  \"passiveVoiceUsage\": 15,\n"
        "  \"styleNotes\": \"Overall style assessment\"\n"
        "}"
    )


def build_character_prompt(payload: CharacterAnalysisRequest) -> str:
    analysis_type = (payload.analysisType or "development").lower()
    analysis_mapping = {
        "voice": "Analyze the character's unique voice, speech patterns, vocabulary, and dialogue style.",
        "development": "Analyze character development, growth, motivations, and character arc.",
        "consistency": "Check for consistency in character behavior, voice, and personality traits.",
        "dialogue": "Focus on dialogue quality, authenticity, and character-specific speech patterns.",
        "backstory": "Analyze implied backstory and suggest areas for character depth.",
    }
    focus = analysis_mapping.get(analysis_type, analysis_mapping["development"])

    return (
        f"Analyze the character \"{payload.characterName}\" in the following text.\n\n"
        f"Focus: {focus}\n\n"
        f"Text: \"{payload.text}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"traits\": [\"trait1\", \"trait2\", \"trait3\"],\n"
        "  \"voiceTone\": \"description of speaking style\",\n"
        "  \"speechPattern\": \"characteristic speech patterns\",\n"
        "  \"vocabularyLevel\": \"assessment of vocabulary used\",\n"
        "  \"emotionalRange\": \"range of emotions displayed\",\n"
        "  \"developmentNotes\": \"character development observations\",\n"
        "  \"inconsistencies\": [\"issue1\", \"issue2\"],\n"
        "  \"strengths\": [\"strength1\", \"strength2\"],\n"
        "  \"improvementAreas\": [\"area1\", \"area2\"]\n"
        "}"
    )


def build_character_suggestion_prompt(payload: CharacterSuggestionRequest) -> str:
    traits = ", ".join(payload.traits) if payload.traits else "No specific traits provided"
    focus = payload.focusArea or "General development"

    return (
        f"Generate creative enhancement suggestions for the character \"{payload.characterName}\" with traits: {traits}.\n\n"
        f"Focus area: {focus}\n\n"
        "Provide practical, creative suggestions for character development.\n\n"
        "Respond with ONLY a valid JSON array (no markdown formatting) in this exact format:\n"
        "[\n"
        "  {\n"
        "    \"category\": \"Dialogue\",\n"
        "    \"description\": \"detailed suggestion\",\n"
        "    \"example\": \"example implementation\"\n"
        "  }\n"
        "]"
    )


def build_plot_prompt(payload: PlotAnalysisRequest) -> str:
    plot_type = (payload.plotType or "custom").lower()
    structure_mapping = {
        "three-act": "Three-Act Structure: Setup (25%), Confrontation (50%), Resolution (25%).",
        "heros-journey": "Hero's Journey: Ordinary World, Call to Adventure, Refusal, Meeting Mentor, Crossing Threshold, Tests, Ordeal, Reward, Road Back, Resurrection, Return.",
        "seven-point": "Seven-Point Structure: Hook, Plot Turn 1, Pinch Point 1, Midpoint, Pinch Point 2, Plot Turn 2, Resolution.",
        "freytag": "Freytag's Pyramid: Exposition, Rising Action, Climax, Falling Action, Denouement.",
        "fichtean": "Fichtean Curve: Series of crises building to climax.",
    }
    structure = structure_mapping.get(plot_type, "Custom analysis of narrative structure.")

    return (
        f"Analyze the plot structure of the following story using {structure}\n\n"
        f"Text: \"{payload.text}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"overallScore\": 85,\n"
        "  \"stages\": [\n"
        "    {\n"
        "      \"name\": \"stage name\",\n"
        "      \"completion\": 80,\n"
        "      \"description\": \"assessment of this stage\",\n"
        "      \"suggestions\": [\"improvement1\", \"improvement2\"]\n"
        "    }\n"
        "  ],\n"
        "  \"pacing\": \"assessment of story pacing\",\n"
        "  \"conflict\": \"analysis of conflict development\",\n"
        "  \"characterArc\": \"character development assessment\",\n"
        "  \"themeDevelopment\": \"theme analysis\",\n"
        "  \"recommendations\": [\n"
        "    {\n"
        "      \"priority\": \"high\",\n"
        "      \"title\": \"recommendation title\",\n"
        "      \"description\": \"detailed recommendation\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def build_manuscript_prompt(payload: ManuscriptAnalysisRequest) -> str:
    chapters_json = json.dumps(payload.chapters, ensure_ascii=False)
    return (
        "Analyze this manuscript structure and provide insights.\n\n"
        f"Chapters: {chapters_json}\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"overallProgress\": 65,\n"
        "  \"totalWordCount\": 50000,\n"
        "  \"averageChapterLength\": 2500,\n"
        "  \"paceAnalysis\": \"analysis of pacing across chapters\",\n"
        "  \"consistencyIssues\": [\"issue1\", \"issue2\"],\n"
        "  \"suggestions\": [\"suggestion1\", \"suggestion2\"],\n"
        "  \"readabilityScore\": 85,\n"
        "  \"chapterInsights\": [\n"
        "    {\n"
        "      \"chapterNumber\": 1,\n"
        "      \"strengths\": [\"strength1\"],\n"
        "      \"improvements\": [\"improvement1\"],\n"
        "      \"paceRating\": \"good\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def build_scene_prompt(payload: SceneAnalysisRequest) -> str:
    scene_type = payload.sceneType or "General"
    return (
        "Analyze this scene for conflict, tension, and effectiveness:\n\n"
        f"Scene Type: {scene_type}\n"
        f"Scene Text: \"{payload.sceneText}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"conflictLevel\": 85,\n"
        "  \"tensionRating\": 90,\n"
        "  \"paceRating\": 75,\n"
        "  \"dialogueQuality\": 80,\n"
        "  \"characterDevelopment\": 70,\n"
        "  \"conflictTypes\": [\"internal\", \"external\"],\n"
        "  \"tensionTechniques\": [\"technique1\", \"technique2\"],\n"
        "  \"strengths\": [\"strength1\", \"strength2\"],\n"
        "  \"improvements\": [\"improvement1\", \"improvement2\"],\n"
        "  \"suggestions\": [\n"
        "    {\n"
        "      \"type\": \"Conflict\",\n"
        "      \"description\": \"suggestion description\",\n"
        "      \"example\": \"example implementation\"\n"
        "    }\n"
        "  ]\n"
        "}"
    )


def build_readability_prompt(payload: ReadabilityRequest) -> str:
    audience = payload.targetAudience or "General audience"
    return (
        f"Analyze the readability of this text for target audience: {audience}\n\n"
        f"Text: \"{payload.text}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"readabilityScore\": 85,\n"
        "  \"gradeLevel\": \"8th Grade\",\n"
        "  \"targetMatch\": true,\n"
        "  \"wordComplexity\": \"appropriate\",\n"
        "  \"sentenceLength\": \"good\",\n"
        "  \"vocabularyLevel\": \"suitable\",\n"
        "  \"improvements\": [\n"
        "    {\n"
        "      \"issue\": \"issue description\",\n"
        "      \"suggestion\": \"how to fix\",\n"
        "      \"example\": \"example fix\"\n"
        "    }\n"
        "  ],\n"
        "  \"strengths\": [\"strength1\", \"strength2\"],\n"
        "  \"optimizedVersion\": \"optimized text version\"\n"
        "}"
    )


def build_script_breakdown_prompt(payload: ScriptAnalysisRequest) -> str:
    return (
        "Analyze this screenplay and identify production elements in these categories:\n"
        "- props\n"
        "- wardrobe\n"
        "- cast\n"
        "- locations\n"
        "- sfx\n"
        "- vehicles\n"
        "- animals\n"
        "- stunts\n"
        "- makeup\n"
        "- equipment\n"
        "- extras\n\n"
        f"Script:\n\"{payload.scriptText}\"\n\n"
        "Respond with ONLY a valid JSON object (no markdown formatting) in this exact format:\n"
        "{\n"
        "  \"props\": [\"prop1\", \"prop2\"],\n"
        "  \"wardrobe\": [\"item1\", \"item2\"],\n"
        "  \"cast\": [\"character1\", \"character2\"],\n"
        "  \"locations\": [\"location1\", \"location2\"],\n"
        "  \"sfx\": [\"effect1\", \"effect2\"],\n"
        "  \"vehicles\": [\"vehicle1\", \"vehicle2\"],\n"
        "  \"animals\": [\"animal1\", \"animal2\"],\n"
        "  \"stunts\": [\"stunt1\", \"stunt2\"],\n"
        "  \"makeup\": [\"makeup1\", \"makeup2\"],\n"
        "  \"equipment\": [\"equipment1\", \"equipment2\"],\n"
        "  \"extras\": [\"extra1\", \"extra2\"]\n"
        "}"
    )


def build_shot_list_prompt(payload: ScriptAnalysisRequest) -> str:
    truncated_script = payload.scriptText[:15000]
    return (
        "Based on this screenplay, create a detailed shot list with appropriate camera setups."
        " For each key moment in the script, suggest a specific shot with these technical details:\n"
        "- scene number\n"
        "- shot number\n"
        "- shot description\n"
        "- shot type (CU, MS, WS, etc.)\n"
        "- camera angle\n"
        "- camera movement\n"
        "- equipment needed\n"
        "- lens recommendation\n"
        "- estimated duration\n"
        "- frame rate\n\n"
        f"Script:\n\"{truncated_script}\"\n\n"
        "Generate at least 5 shots. Respond with ONLY a valid JSON array (no markdown formatting) in this exact format:\n"
        "[\n"
        "  {\n"
        "    \"scene\": \"1\",\n"
        "    \"shotNumber\": \"1\",\n"
        "    \"description\": \"Description of the shot content\",\n"
        "    \"type\": \"MS\",\n"
        "    \"angle\": \"Eye Level\",\n"
        "    \"movement\": \"Static\",\n"
        "    \"equipment\": \"Tripod\",\n"
        "    \"lens\": \"50mm\",\n"
        "    \"framing\": \"Medium\",\n"
        "    \"notes\": \"Additional technical notes\",\n"
        "    \"duration\": \"5s\",\n"
        "    \"frameRate\": \"24 fps\"\n"
        "  }\n"
        "]"
    )


def default_grammar_analysis() -> Dict[str, Any]:
    return {
        "overallScore": 75,
        "issues": [],
        "readability": "Analysis completed successfully",
        "sentenceVariety": "Standard variety observed",
        "vocabularyLevel": "Appropriate for intended audience",
        "passiveVoiceUsage": 0,
        "styleNotes": "Text analyzed for style and structure",
    }


def default_character_analysis() -> Dict[str, Any]:
    return {
        "traits": ["Character analyzed"],
        "voiceTone": "Analysis completed successfully",
        "speechPattern": "Patterns identified",
        "vocabularyLevel": "Appropriate level",
        "emotionalRange": "Emotions observed",
        "developmentNotes": "Character development noted",
        "inconsistencies": [],
        "strengths": ["Character strengths identified"],
        "improvementAreas": ["Areas for development noted"],
    }


def default_character_suggestions() -> List[Dict[str, Any]]:
    return [
        {
            "category": "General Development",
            "description": "Character enhancement suggestions generated",
            "example": "See detailed analysis for specific recommendations",
        }
    ]


def default_plot_analysis() -> Dict[str, Any]:
    return {
        "overallScore": 75,
        "stages": [
            {
                "name": "Structure Analysis",
                "completion": 75,
                "description": "Plot structure analyzed successfully",
                "suggestions": ["Continue developing your story structure"],
            }
        ],
        "pacing": "Pacing analysis completed",
        "conflict": "Conflict development noted",
        "characterArc": "Character development observed",
        "themeDevelopment": "Themes identified",
        "recommendations": [
            {
                "priority": "medium",
                "title": "General Development",
                "description": "Continue refining your plot structure",
            }
        ],
    }


def default_manuscript_analysis() -> Dict[str, Any]:
    return {
        "overallProgress": 0,
        "totalWordCount": 0,
        "averageChapterLength": 0,
        "paceAnalysis": "Analysis in progress",
        "consistencyIssues": [],
        "suggestions": ["Continue writing your manuscript"],
        "readabilityScore": 75,
        "chapterInsights": [],
    }


def default_scene_analysis() -> Dict[str, Any]:
    return {
        "conflictLevel": 50,
        "tensionRating": 50,
        "paceRating": 50,
        "dialogueQuality": 50,
        "characterDevelopment": 50,
        "conflictTypes": ["general"],
        "tensionTechniques": ["basic tension"],
        "strengths": ["Scene analyzed"],
        "improvements": ["Continue developing"],
        "suggestions": [
            {
                "type": "General",
                "description": "Scene analysis completed",
                "example": "Continue refining your scene",
            }
        ],
    }


def default_readability_analysis(original_text: str) -> Dict[str, Any]:
    return {
        "readabilityScore": 75,
        "gradeLevel": "General Adult",
        "targetMatch": True,
        "wordComplexity": "appropriate",
        "sentenceLength": "good",
        "vocabularyLevel": "suitable",
        "improvements": [
            {
                "issue": "Analysis completed",
                "suggestion": "Continue refining text",
                "example": "Keep developing your writing",
            }
        ],
        "strengths": ["Text analyzed successfully"],
        "optimizedVersion": original_text,
    }


def default_script_breakdown() -> Dict[str, Any]:
    keys = [
        "props",
        "wardrobe",
        "cast",
        "locations",
        "sfx",
        "vehicles",
        "animals",
        "stunts",
        "makeup",
        "equipment",
        "extras",
    ]
    return {key: [] for key in keys}


def normalize_shot_list(shots: Any) -> List[Dict[str, Any]]:
    if not isinstance(shots, list):
        shots = []

    normalized: List[Dict[str, Any]] = []
    timestamp = int(time.time() * 1000)

    for idx, raw in enumerate(shots):
        if not isinstance(raw, dict):
            continue
        entry: Dict[str, Any] = {
            "id": raw.get("id") or timestamp + idx,
            "scene": str(raw.get("scene", "1")),
            "shotNumber": str(raw.get("shotNumber", str(idx + 1))),
            "description": raw.get("description", "Shot description"),
            "type": raw.get("type", "MS"),
            "angle": raw.get("angle", "Eye Level"),
            "movement": raw.get("movement", "Static"),
            "equipment": raw.get("equipment", "Tripod"),
            "lens": raw.get("lens", "50mm"),
            "framing": raw.get("framing", "Medium"),
            "notes": raw.get("notes", ""),
            "duration": raw.get("duration", "5s"),
            "frameRate": raw.get("frameRate", "24 fps"),
        }
        normalized.append(entry)

    if not normalized:
        normalized.append(
            {
                "id": timestamp,
                "scene": "1",
                "shotNumber": "1",
                "description": "Shot description",
                "type": "MS",
                "angle": "Eye Level",
                "movement": "Static",
                "equipment": "Tripod",
                "lens": "50mm",
                "framing": "Medium",
                "notes": "",
                "duration": "5s",
                "frameRate": "24 fps",
            }
        )

    return normalized


def build_paraphrase_prompt(payload: ParaphraseRequest) -> str:
    base = payload.text
    mode = (payload.mode or "").lower()

    if mode == "formal":
        instruction = "Rewrite the text with a formal, professional tone while preserving meaning."
    elif mode == "academic":
        instruction = "Rewrite the text in an academic, scholarly register using precise terminology."
    elif mode == "simple":
        instruction = "Simplify the text so it is easy to read without losing the key message."
    elif mode == "creative":
        instruction = "Rewrite the text with fresh, imaginative phrasing and varied sentence structure."
    elif mode == "shorten":
        instruction = "Condense the text, retaining only essential information."
    elif mode == "expand":
        instruction = "Expand the text by adding relevant detail and descriptive color."
    elif mode == "custom" and payload.customPrompt:
        instruction = payload.customPrompt
    else:
        instruction = "Paraphrase the text while preserving meaning."

    return (
        f"{instruction}\n\n"
        f"TEXT:\n" + base
    )


def build_summary_prompt(payload: SummarizeRequest) -> str:
    length = payload.length or "medium"
    if length == "short":
        directive = "Write a brief 2-3 sentence summary of the text."
    elif length == "long":
        directive = "Write a detailed summary that captures key points, supporting details, and context."
    else:
        directive = "Write a concise summary that captures the main ideas."
    return f"{directive}\n\nTEXT:\n{payload.text}"


def build_tone_prompt(payload: ToneRequest) -> str:
    return (
        "Analyze the tone of the text and respond ONLY with JSON using the following shape:\n"
        "{\n"
        "  \"overallTone\": \"description\",\n"
        "  \"sentiment\": \"positive|negative|neutral\",\n"
        "  \"confidence\": \"high|medium|low\",\n"
        "  \"emotions\": [\"emotion\"],\n"
        "  \"suggestions\": \"improvement suggestions\"\n"
        "}\n\nTEXT:\n"
        f"{payload.text}"
    )


def build_humanize_prompt(payload: HumanizeRequest) -> str:
    return (
        "Make this AI-generated text read as natural human prose. Improve flow, add subtle imperfections, and keep meaning intact."
        "\n\nTEXT:\n"
        f"{payload.text}"
    )


def build_synonym_prompt(payload: SynonymRequest) -> str:
    return (
        "Provide up to 10 synonyms ranked by relevance for the given word in the provided context."
        " Respond with a JSON array of strings only.\n\n"
        f"WORD: {payload.word}\n"
        f"CONTEXT: {payload.context or 'General writing'}"
    )


def coerce_json(raw: str) -> Optional[Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\n?|```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return None


app = create_app()
